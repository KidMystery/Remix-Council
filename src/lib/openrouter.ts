import type { GroundingData } from '../types';
import { parseWebSearchAnnotations } from './webGrounding';
import { getAuthHeaders } from './apiClient';
import { refreshOwnerTokenSilently } from './drivePersistence';
import { isTransientError, sleep } from './retryUtils';
import { recordError, recordWarn, recordInfo } from './eventLog';

export class OwnerAuthError extends Error {
  isOwnerAuthError = true;
  constructor(message: string = 'Sign in required (owner gate).') {
    super(message);
    this.name = 'OwnerAuthError';
  }
}

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

  let currentHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
  };

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      let response = await fetch('/api/council', {
        method: 'POST',
        headers: currentHeaders,
        body: JSON.stringify(body),
        signal,
      });

      // Retry only on transient statuses; client errors (4xx below) fail fast.
      if ([408, 409, 429].includes(response.status) || response.status >= 500) {
        if (attempt < maxRetries) {
          attempt++;
          const backoffMs = attempt * 1500;
          console.warn(`[TalkEngine] HTTP ${response.status}. Retrying attempt ${attempt}/${maxRetries} in ${backoffMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
      }

      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        try {
          await refreshOwnerTokenSilently();
          currentHeaders = {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          };
          response = await fetch('/api/council', {
            method: 'POST',
            headers: currentHeaders,
            body: JSON.stringify(body),
            signal,
          });
        } catch {
          throw new OwnerAuthError(errorData.error || 'Sign in required (owner gate).');
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new OwnerAuthError(errorData.error || 'Sign in required (owner gate).');
        }
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

  const maxRetries = 2;
  let attempt = 0;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    // Combined abort: the caller's signal (user Stop) OR our stall watchdog.
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

    let attemptHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    };

    let accumulated = '';
    let buffer = '';
    let finishReason: string | undefined;
    let usage: StreamCompletionResult['usage'];
    let routedModel: string | undefined;
    let streamError: string | undefined;
    let streamErrorStatus: number | undefined;
    let streamErrorCode: string | number | undefined;
    let streamErrorMetadata: unknown;

    try {
      let response = await fetch('/api/council', {
        method: 'POST',
        headers: attemptHeaders,
        body: JSON.stringify(body),
        signal: combined.signal,
      });

      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        try {
          await refreshOwnerTokenSilently();
          attemptHeaders = {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          };
          response = await fetch('/api/council', {
            method: 'POST',
            headers: attemptHeaders,
            body: JSON.stringify(body),
            signal: combined.signal,
          });
        } catch {
          throw new OwnerAuthError(errorData.error || 'Sign in required (owner gate).');
        }
      }

      // Handle transient status codes (408/409 timeouts & conflicts, 429 rate limit, 5xx gateway errors)
      if (([408, 409, 429].includes(response.status) || response.status >= 500) && attempt < maxRetries) {
        const errorData = await response.json().catch(() => ({}));
        const retryDelay = (attempt + 1) * 1200 + Math.random() * 400;
        recordWarn(
          'network',
          `Transient HTTP ${response.status} from model stream`,
          `Model ${model} returned ${response.status} (${errorData.error || 'Gateway/Provider failure'}). Retrying attempt ${attempt + 1}/${maxRetries} in ${Math.round(retryDelay)}ms...`,
          { model, status: response.status, attempt, error: errorData.error },
          model
        );
        attempt++;
        await sleep(retryDelay, signal);
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.costCeilingExceeded) {
          throw new CostCeilingError(
            errorData.error || 'Round cost ceiling reached on the server.',
            errorData.roundCostUSD,
            errorData.ceilingUSD
          );
        }
        if (response.status === 401) {
          throw new OwnerAuthError(errorData.error || 'Sign in required (owner gate).');
        }
        // Client errors (400/402/403/404) are permanent — fail fast with a clear message.
        if ([400, 402, 403, 404].includes(response.status)) {
          const providerMsg = errorData.error || errorData.providerCode || `HTTP ${response.status}`;
          const rejectErr = new Error(
            `Model ${model} rejected the request (${response.status}): ${providerMsg}`
          ) as Error & { status?: number; providerCode?: unknown; providerMetadata?: unknown; model?: string };
          rejectErr.status = response.status;
          rejectErr.providerCode = errorData.providerCode ?? errorData.error?.code;
          rejectErr.providerMetadata = errorData.providerMetadata ?? errorData.error?.metadata;
          rejectErr.model = model.trim();
          throw rejectErr;
        }
        throw new Error(errorData.error || `HTTP ${response.status}: LLM streaming failure`);
      }

      if (!response.body) {
        throw new Error('ReadableStream is not supported on response.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

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
              // The server reports mid-stream upstream failures as an error frame
              if (json.error?.message) {
                streamError = String(json.error.message);
                streamErrorStatus = typeof json.status === 'number' ? json.status : undefined;
                streamErrorCode = json.error.code ?? json.providerCode;
                streamErrorMetadata = json.providerMetadata ?? json.error.metadata;
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
          await reader.cancel();
        } catch {
          // already closed
        }
      }

      if (streamError) {
        const providerErr = new Error(streamError) as Error & {
          status?: number;
          providerCode?: string | number;
          providerMetadata?: unknown;
          model?: string;
        };
        providerErr.status = streamErrorStatus;
        providerErr.providerCode = streamErrorCode;
        providerErr.providerMetadata = streamErrorMetadata;
        providerErr.model = model.trim();
        throw providerErr;
      }

      return {
        content: accumulated,
        actualModel: routedModel || model.trim(),
        usage,
        grounding,
        finishReason,
      };
    } catch (error: any) {
      if (stallTimer) clearTimeout(stallTimer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);

      lastError = error;

      if (stalled) {
        lastError = new Error(
          `No data from the model for ${Math.round(STALL_MS / 1000)}s — the stream stalled. Try again or switch models.`
        );
      }

      // If user aborted or error is not retryable or we've already output tokens, don't auto-retry
      if (error.name === 'AbortError' || (signal && signal.aborted) || error instanceof OwnerAuthError || (error as CostCeilingError).costCeilingExceeded) {
        recordError('network', 'Stream stopped / auth required', lastError, { model }, model);
        throw lastError;
      }

      // If tokens already started streaming to user, avoid duplicating chunks by re-fetching from zero
      if (accumulated.length > 0) {
        recordError('network', 'Stream interrupted mid-response', lastError, { model, bytesReceived: accumulated.length }, model);
        throw lastError;
      }

      // Check if transient network / connection error and retries remain
      if (attempt < maxRetries && (isTransientError(error) || error instanceof TypeError || stalled)) {
        attempt++;
        const retryDelay = attempt * 1200 + Math.random() * 400;
        recordWarn(
          'network',
          `Network connection dropped, retrying...`,
          `Connection to model ${model} failed (${lastError.message}). Retrying attempt ${attempt}/${maxRetries} in ${Math.round(retryDelay)}ms...`,
          { model, attempt, error: lastError.message },
          model
        );
        await sleep(retryDelay, signal);
        continue;
      }

      recordError('network', 'Model Stream Failed', lastError, { model, attempts: attempt + 1 }, model);
      throw lastError;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }

  throw lastError || new Error(`Failed completion streaming after ${maxRetries + 1} attempts.`);
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
