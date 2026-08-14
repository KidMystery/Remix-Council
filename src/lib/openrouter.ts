/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
function parseOpenRouterError(status: number, errorText: string) {
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

export function normalizeModelId(model: string | undefined | null): string {
  if (!model || typeof model !== 'string') return 'google/gemini-3.7-flash';
  let trimmed = model.trim();
  if (!trimmed) return 'google/gemini-3.7-flash';

  const lower = trimmed.toLowerCase();
  if (lower === 'gemini 3.7 flash' || lower.includes('gemini-3.7-flash') || lower.includes('gemini 3.7')) return 'google/gemini-3.7-flash';
  if (lower === 'gemini 2.5 flash' || lower.includes('gemini-2.5-flash')) return 'google/gemini-2.5-flash';
  if (lower === 'gemini 2.0 flash' || lower.includes('gemini-2.0-flash')) return 'google/gemini-2.0-flash-001';
  if (lower === 'gemini 2.5 pro' || lower.includes('gemini-2.5-pro')) return 'google/gemini-2.5-pro';
  if (lower === 'claude 3.7 sonnet' || lower.includes('claude-3.7-sonnet')) return 'anthropic/claude-3.7-sonnet';
  if (lower === 'claude 3.5 sonnet' || lower.includes('claude-3.5-sonnet')) return 'anthropic/claude-3.5-sonnet';
  if (lower === 'claude 3.5 haiku' || lower.includes('claude-3.5-haiku')) return 'anthropic/claude-3.5-haiku';
  if (lower === 'gpt-4o' || lower === 'gpt 4o') return 'openai/gpt-4o';
  if (lower === 'gpt-4o mini' || lower === 'gpt 4o mini') return 'openai/gpt-4o-mini';
  if (lower === 'o3-mini' || lower.includes('o3-mini')) return 'openai/o3-mini';
  if (lower === 'deepseek r1' || lower.includes('deepseek-r1')) return 'deepseek/deepseek-r1';
  if (lower === 'deepseek v3' || lower.includes('deepseek-chat')) return 'deepseek/deepseek-chat';
  if (lower.includes('nemotron') && lower.includes('free')) return 'nvidia/nemotron-3.5-content-safety:free';

  if (trimmed.includes('(free)') && !trimmed.endsWith(':free')) {
    trimmed = trimmed.replace(/\s*\(free\)/i, ':free');
  } else {
    trimmed = trimmed.replace(/\s*\(paid\)/i, '');
  }

  trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
  return trimmed || 'google/gemini-3.7-flash';
}

export async function* streamOpenRouter(
  messages: { role: 'system' | 'user' | 'assistant'; content: any }[],
  model: string,
  apiKey: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const resolvedModel = normalizeModelId(model);
  const response = await fetch('/api/council', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-Api-Key-Override': apiKey } : {})
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: messages,
      stream: true,
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

import { GroundingData } from '../types';
import { retryWithExponentialBackoff, isTransientError } from './retryUtils';

export interface OpenRouterCompletionResult {
  content: string;
  actualModel: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  grounding?: GroundingData;
}

export async function streamOpenRouterCompletion(options: {
  apiKey: string;
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: any }[];
  temperature?: number;
  maxTokens?: number;
  enableSearchGrounding?: boolean;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
  onGrounding?: (grounding: GroundingData) => void;
}): Promise<OpenRouterCompletionResult> {
  const { apiKey, messages, temperature, maxTokens, enableSearchGrounding, signal, onToken, onGrounding } = options;
  let targetModel = normalizeModelId(options.model);

  let actualModel = targetModel;

  const makeRequest = async (modelToUse: string) => {
    const body: any = {
      model: modelToUse,
      messages: messages,
      stream: true,
      enableSearchGrounding,
      stream_options: { include_usage: true },
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) {
      let limit = maxTokens;
      if (modelToUse.includes('gemini')) {
        limit = Math.min(maxTokens, 8192);
      } else if (modelToUse.includes('claude-3.5-haiku') || modelToUse.includes('claude-3-5')) {
        limit = Math.min(maxTokens, 8192);
      } else if (modelToUse.includes('gpt-4o')) {
        limit = Math.min(maxTokens, 16384);
      }
      body.max_tokens = limit;
    }

    return fetch('/api/council', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Api-Key-Override': apiKey } : {})
      },
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
            if (data.choices && data.choices[0] && data.choices[0].delta) {
              const delta = data.choices[0].delta;
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

  return { content: fullText, actualModel, usage, grounding: groundingData };
}
