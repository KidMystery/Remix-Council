import { useCallback } from 'react';
import { PersonaId, GroundingData } from '../types';
import { streamOpenRouterCompletion } from '../lib/openrouter';

export interface PersonaStreamOptions {
  personaId: PersonaId;
  apiKey: string;
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: any }[];
  temperature?: number;
  maxTokens?: number;
  query?: string;
  signal?: AbortSignal;
  disableFallback?: boolean;
  onToken?: (chunk: string) => void;
  onGrounding?: (grounding: GroundingData) => void;
}

export function usePersonaStream() {
  const streamPersona = useCallback(async (options: PersonaStreamOptions): Promise<{ content: string; finalModel: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; grounding?: GroundingData }> => {
    const res = await streamOpenRouterCompletion({
      apiKey: options.apiKey,
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      query: options.query,
      signal: options.signal,
      disableFallback: options.disableFallback,
      onToken: options.onToken,
      onGrounding: options.onGrounding,
    });
    return {
      content: res.content,
      finalModel: res.actualModel || options.model,
      usage: res.usage,
      grounding: res.grounding,
    };
  }, []);

  return { streamPersona };
}
