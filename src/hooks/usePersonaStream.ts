import { useCallback } from 'react';
import { PersonaId } from '../types';
import { streamOpenRouterCompletion } from '../lib/openrouter';

export interface PersonaStreamOptions {
  personaId: PersonaId;
  apiKey: string;
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: any }[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
}

export function usePersonaStream() {
  const streamPersona = useCallback(async (options: PersonaStreamOptions): Promise<{ content: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }> => {
    return streamOpenRouterCompletion({
      apiKey: options.apiKey,
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
      onToken: options.onToken,
    });
  }, []);

  return { streamPersona };
}
