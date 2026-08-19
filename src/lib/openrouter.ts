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

  const councilAccessKey = (import.meta as any).env?.VITE_COUNCIL_ACCESS_KEY || '';

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
    'x-council-key': councilAccessKey,
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

export async function fetchCouncilModels(): Promise<any[]> {
  const councilAccessKey = (import.meta as any).env?.VITE_COUNCIL_ACCESS_KEY || '';

  const response = await fetch('/api/council/models', {
    headers: {
      'x-council-key': councilAccessKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch catalog: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.data || [];
}
