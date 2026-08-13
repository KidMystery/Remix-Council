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

export async function* streamOpenRouter(
  messages: { role: 'system' | 'user' | 'assistant'; content: any }[],
  model: string,
  apiKey: string,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const response = await fetch('/api/council', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-Api-Key-Override': apiKey } : {})
    },
    body: JSON.stringify({
      model: model,
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
  let targetModel = options.model;

  // Sanitize non-existent or legacy model strings
  if (!targetModel || targetModel.includes('gemini-2.0') || targetModel.includes('gemini-1.5')) {
    targetModel = 'google/gemini-2.5-flash';
  }

  let actualModel = targetModel;
  // If Search Grounding is requested on a non-Gemini model, the backend routes to Gemini
  if (enableSearchGrounding && !targetModel.toLowerCase().includes('gemini')) {
    actualModel = 'google/gemini-2.5-flash';
  }

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

  let response;
  try {
    response = await makeRequest(targetModel);
  } catch (err: any) {
    if (err.message === 'Failed to fetch' || err.message.includes('fetch failed')) {
      throw new Error('Network error: Could not connect to the backend server. The server might be restarting or down.');
    }
    throw err;
  }

  let firstErrorText = '';
  let firstStatus = 0;

  // Fallback 1: If 400/404 invalid model error, retry with google/gemini-2.5-flash
  if (!response.ok && (response.status === 400 || response.status === 404) && targetModel !== 'google/gemini-2.5-flash') {
    firstErrorText = await response.clone().text();
    firstStatus = response.status;
    const parsed = parseOpenRouterError(firstStatus, firstErrorText);
    if (!parsed.toLowerCase().includes('context length') && !parsed.toLowerCase().includes('tokens')) {
      console.warn(`Model "${targetModel}" failed (${response.status}). Retrying with google/gemini-2.5-flash...`);
      actualModel = 'google/gemini-2.5-flash';
      response = await makeRequest('google/gemini-2.5-flash');
    }
  }

  // Fallback 2: If still 400/404, retry with openai/gpt-4o-mini
  if (!response.ok && (response.status === 400 || response.status === 404) && targetModel !== 'openai/gpt-4o-mini') {
    const errText = await response.clone().text();
    const parsed = parseOpenRouterError(response.status, errText);
    if (!parsed.toLowerCase().includes('context length') && !parsed.toLowerCase().includes('tokens')) {
      console.warn(`Fallback model failed (${response.status}). Retrying with openai/gpt-4o-mini...`);
      actualModel = 'openai/gpt-4o-mini';
      response = await makeRequest('openai/gpt-4o-mini');
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    // If we have an original error that we preserved because of context length, throw it
    if (firstErrorText && (parseOpenRouterError(firstStatus, firstErrorText).toLowerCase().includes('context length') || parseOpenRouterError(firstStatus, firstErrorText).toLowerCase().includes('tokens'))) {
       throw new Error(parseOpenRouterError(firstStatus, firstErrorText));
    }
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
