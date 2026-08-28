import type { GroundingData } from '../types';
import { parseWebSearchAnnotations } from './webGrounding';
import { getAuthHeaders } from './apiClient';

export interface StreamOpenRouterOptions {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  budget?: 'free' | 'cheap' | 'quality';
  onToken?: (token: string) => void;
  signal?: AbortSignal;
  maxRetries?: number;
}

export async function streamOpenRouter({
  model,
  messages,
  temperature = 0.7,
  maxTokens,
  budget,
  onToken,
  signal,
  maxRetries = 2,
}: StreamOpenRouterOptions): Promise<{ content: string; cost?: number }> {
  if (!model || !model.trim()) {
    throw new Error('No model selected.');
  }

  const body: Record<string, any> = {
    model: model.trim(),
    messages,
    temperature,
    stream: true,
  };

  if (maxTokens) body.max_tokens = maxTokens;
  if (budget) body.budget = budget;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
  };

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const response = await fetch('/api/council', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });

      // Handle transient upstream rate limits or overload with backoff
      if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
        attempt++;
        const backoffMs = attempt * 1500;
        console.warn(`[TalkEngine] HTTP ${response.status}. Retrying attempt ${attempt}/${maxRetries} in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: LLM Deliberation streaming failure`);
      }

      if (!response.body) {
        throw new Error('ReadableStream is not supported on response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep partial line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          if (trimmed === 'data: [DONE]') break;

          try {
            const json = JSON.parse(trimmed.replace(/^data:\s*/, ''));
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              accumulated += delta;
              if (onToken) onToken(delta);
            }
          } catch {
            // Safe ignore of partial SSE frames
          }
        }
      }

      return { content: accumulated };
    } catch (error: any) {
      if (error.name === 'AbortError' || attempt >= maxRetries) {
        throw error;
      }
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw new Error(`Failed deliberation streaming after ${maxRetries + 1} attempts.`);
}

export interface StreamOpenRouterCompletionOptions {
  apiKey?: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>;
  temperature?: number;
  maxTokens?: number;
  budget?: 'free' | 'cheap' | 'quality';
  query?: string;
  signal?: AbortSignal;
  disableFallback?: boolean;
  webSearch?: boolean;
  onToken?: (chunk: string) => void;
  onGrounding?: (grounding: GroundingData) => void;
  /** Server cost governor: round identity + per-round USD ceiling. */
  roundKey?: string;
  costCeilingUSD?: number;
  /** OpenRouter Auto plugin + sticky session. */
  plugins?: unknown[];
  sessionId?: string;
}

/** Thrown when the server-side cost governor refuses a call (ceiling reached). */
export class CostCeilingError extends Error {
  readonly costCeilingExceeded = true;
  readonly roundCostUSD?: number;
  readonly ceilingUSD?: number;
  constructor(message: string, roundCostUSD?: number, ceilingUSD?: number) {
    super(message);
    this.name = 'CostCeilingError';
    this.roundCostUSD = roundCostUSD;
    this.ceilingUSD = ceilingUSD;
  }
}

export interface StreamCompletionResult {
  content: string;
  actualModel?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  grounding?: GroundingData;
  finishReason?: string;
  cost?: number;
}

/**
 * Streaming completion helper used by persona streamers, the chunk processor,
 * and the archivist. Routes through the server-side /api/council proxy.
 */
export async function streamOpenRouterCompletion(
  options: StreamOpenRouterCompletionOptions
): Promise<StreamCompletionResult> {
  const {
    model,
    messages,
    temperature = 0.7,
    maxTokens,
    budget,
    signal,
    webSearch = false,
    onToken,
    onGrounding,
    roundKey,
    costCeilingUSD,
    plugins,
    sessionId,
  } = options;

  if (!model || !model.trim()) {
    throw new Error('No model selected.');
  }

  const body: Record<string, any> = {
    model: model.trim(),
    messages,
    temperature,
    stream: true,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (budget) body.budget = budget;
  if (roundKey) body.roundKey = roundKey;
  if (costCeilingUSD) body.costCeilingUSD = costCeilingUSD;
  if (plugins && plugins.length > 0) body.plugins = plugins;
  if (sessionId) body.session_id = sessionId;
  if (webSearch) {
    body.tools = [
      {
        type: 'function',
        function: {
          name: 'openrouter:web_search',
          description: 'Search the live web for current, factual information.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query.' } },
            required: ['query'],
          },
        },
      },
    ];
  }

  let grounding: GroundingData | undefined;

  // Combined abort: the caller's signal (user Stop) OR our stall watchdog.
  // A stalled upstream must surface as a visible error, never a silent hang —
  // the reader loop below has no other way to unblock.
  const combined = new AbortController();
  const onOuterAbort = () => combined.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) combined.abort(signal.reason);
    else signal.addEventListener('abort', onOuterAbort);
  }
  const STALL_MS = 120_000; // server aborts upstream at 110s; this is the backstop
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      combined.abort(new DOMException('Stream stalled', 'AbortError'));
    }, STALL_MS);
  };

  try {
    const response = await fetch('/api/council', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(body),
      signal: combined.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (errorData.costCeilingExceeded) {
        throw new CostCeilingError(
          errorData.error || 'Round cost ceiling reached on the server.',
          errorData.roundCostUSD,
          errorData.ceilingUSD
        );
      }
      throw new Error(errorData.error || `HTTP ${response.status}: LLM streaming failure`);
    }

    if (!response.body) {
      throw new Error('ReadableStream is not supported on response.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulated = '';
    let buffer = '';
    let finishReason: string | undefined;
    let usage: StreamCompletionResult['usage'];
    let routedModel: string | undefined;

    let streamError: string | undefined;
    try {
      while (true) {
        armStallTimer();
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          if (trimmed === 'data: [DONE]') break;

          try {
            const json = JSON.parse(trimmed.replace(/^data:\s*/, ''));
            // The server reports mid-stream upstream failures as an error
            // frame — record it instead of treating the stream as complete.
            if (json.error?.message) {
              streamError = String(json.error.message);
            }
            const choice = json.choices?.[0];
          const delta = choice?.delta?.content || '';
          if (delta) {
            accumulated += delta;
            if (onToken) onToken(delta);
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (typeof json.model === 'string' && json.model && json.model !== model.trim()) {
            routedModel = json.model;
          }
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens,
            };
          }
          if (json.annotations || json.choices?.[0]?.message?.annotations || json.tool_calls) {
            const parsed = parseWebSearchAnnotations(json);
            if ((parsed.sources && parsed.sources.length > 0) || (parsed.queries && parsed.queries.length > 0)) {
              grounding = parsed;
              if (onGrounding) onGrounding(parsed);
            }
          }
        } catch {
          // Safe ignore of partial SSE frames
        }
          if (streamError) break;
        }
        if (streamError) break;
      }
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      try {
        // cancel() returns a promise; on an errored/aborted stream it REJECTS.
        // Await + swallow so the rejection can't surface as unhandled after
        // the caller has already received the visible "stalled" error.
        await reader.cancel();
      } catch {
        // already closed
      }
    }

    if (streamError) {
      throw new Error(streamError);
    }

    return {
      content: accumulated,
      actualModel: routedModel || model.trim(),
      usage,
      grounding,
      finishReason,
    };
  } catch (error: any) {
    // A watchdog abort (no bytes for STALL_MS) must surface as a visible
    // error — not an AbortError, which callers treat as a user stop.
    if (stalled) {
      throw new Error(
        `No data from the model for ${Math.round(STALL_MS / 1000)}s — the stream stalled. Try again or switch models.`
      );
    }
    throw error;
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

export async function fetchCouncilModels(): Promise<any[]> {
  const response = await fetch('/api/council/models', {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch catalog: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data || [];
}
