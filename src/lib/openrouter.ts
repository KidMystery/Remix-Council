/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
import { GroundingData } from '../types';
import { retryWithExponentialBackoff, isTransientError } from './retryUtils';
import { getAuthHeaders } from './authHeader';

function parseOpenRouterError(status: number, errorText: string): string {
  try {
    const data = JSON.parse(errorText);
    if (data.error) {
      if (typeof data.error === 'string') {
        try {
          const innerError = JSON.parse(data.error);
          if (innerError.error && innerError.error.message) {
            return `OpenRouter API Error (${status}): ${innerError.error.message}`;
          }
        } catch (e) {
          return `OpenRouter API Error (${status}): ${data.error}`;
        }
      } else if (data.error.message) {
        return `OpenRouter API Error (${status}): ${data.error.message}`;
      }
    }
  } catch (e) {
    // ignore
  }
  return `OpenRouter API Error (${status}): ${errorText}`;
}

export async function* streamOpenRouter(
  messages: { role: 'system' | 'user' | 'assistant'; content: any }[],
  model: string,
  _apiKey?: string,
  signal?: AbortSignal,
  budget?: 'free' | 'cheap' | 'quality',
): AsyncGenerator<string, void, unknown> {
  if (!model || typeof model !== 'string' || !model.trim()) {
    throw new Error('No model selected.');
  }

  const targetModel = model.trim();
  const response = await fetch('/api/council', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: targetModel,
      messages: messages,
      stream: true,
      budget: budget === 'free' ? 'free' : 'quality',
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(parseOpenRouterError(response.status, errorText));
  }

  if (!response.body) {
    throw new Error('No response body stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the incomplete line in the buffer

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

        if (trimmedLine.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmedLine.slice(6));
            if (data.error) {
              throw new Error(data.error.message || JSON.stringify(data.error));
            }
            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              yield data.choices[0].delta.content;
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('Unexpected token')) {
              throw e;
            }
            console.warn('Failed to parse SSE message:', trimmedLine);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function buildOptimizedContext(
  systemPrompt: string,
  userQuery: string,
  priorSyntheses: string[] = []
) {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt }
  ];

  if (priorSyntheses && priorSyntheses.length > 0) {
    messages.push({
      role: 'user',
      content: `[Previous Council Consensuses]:\n${priorSyntheses.map((s, i) => `Round ${i + 1}:\n${s}`).join('\n\n')}\n\n[Current Question]:\n${userQuery}`
    });
  } else {
    messages.push({
      role: 'user',
      content: userQuery
    });
  }

  return messages;
}

export interface OpenRouterCompletionResult {
  content: string;
  actualModel: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  grounding?: GroundingData;
  finishReason?: string;
}

export async function streamOpenRouterCompletion(options: {
  apiKey?: string;
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: any }[];
  temperature?: number;
  maxTokens?: number;
  budget?: 'free' | 'cheap' | 'quality';
  query?: string;
  signal?: AbortSignal;
  disableFallback?: boolean;
  webSearch?: boolean;
  onToken?: (chunk: string) => void;
  onGrounding?: (grounding: GroundingData) => void;
}): Promise<OpenRouterCompletionResult> {
  const {
    apiKey,
    messages,
    temperature,
    maxTokens,
    budget,
    query,
    signal,
    disableFallback,
    webSearch,
    onToken,
    onGrounding,
  } = options;

  if (!options.model || typeof options.model !== 'string' || !options.model.trim()) {
    throw new Error('No model selected.');
  }

  const targetModel = options.model.trim();
  let actualModel = targetModel;

  const makeRequest = async (modelToUse: string) => {
    const body: any = {
      model: modelToUse,
      messages: messages,
      stream: true,
      query,
      disableFallback,
      webSearch,
      apiKey,
      budget: budget === 'free' ? 'free' : 'quality',
      stream_options: { include_usage: true },
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

    const baseAuthHeaders = await getAuthHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...baseAuthHeaders,
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (disableFallback) {
      headers['X-Disable-Fallback'] = 'true';
    }

    return fetch('/api/council', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  };

  let response: Response;
  try {
    response = await retryWithExponentialBackoff(
      async () => {
        const res = await makeRequest(targetModel);
        if (!res.ok && isTransientError({ status: res.status })) {
          const errText = await res.text().catch(() => '');
          throw Object.assign(new Error(parseOpenRouterError(res.status, errText)), { status: res.status });
        }
        return res;
      },
      {
        maxRetries: 2,
        initialDelayMs: 1000,
        maxDelayMs: 4000,
        signal,
        retryIf: isTransientError,
      }
    );
  } catch (err: any) {
    if (err.message === 'Failed to fetch' || err.message.includes('fetch failed')) {
      throw new Error('Network error: Could not connect to the backend server. The server might be restarting or down.');
    }
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(parseOpenRouterError(response.status, errorText));
  }

  if (!response.body) {
    throw new Error('No response body stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined = undefined;
  let groundingData: GroundingData | undefined = undefined;
  let finishReason: string | undefined = undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

        if (trimmedLine.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmedLine.slice(6));
            if (data.error) {
              throw new Error(data.error.message || JSON.stringify(data.error));
            }
            if (data.model) {
              const returnedModel = data.model;
              actualModel = returnedModel.includes('/') || !returnedModel.includes('gemini')
                ? returnedModel
                : `google/${returnedModel}`;
            }
            if (data.usage) {
              usage = {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              };
            }
            if (data.choices && data.choices[0]) {
              if (data.choices[0].finish_reason) {
                finishReason = data.choices[0].finish_reason;
              }
              const delta = data.choices[0].delta;
              if (delta) {
                if (delta.grounding) {
                  groundingData = delta.grounding;
                  if (onGrounding) onGrounding(delta.grounding);
                }
                if (delta.content) {
                  const chunk = delta.content;
                  fullText += chunk;
                  if (onToken) onToken(chunk);
                }
              }
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('Unexpected token') && !e.message.includes('Expected')) {
              throw e;
            }
            console.warn('Failed to parse SSE message:', trimmedLine);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: fullText, actualModel, usage, grounding: groundingData, finishReason };
}
