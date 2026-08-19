import type { Persona, RawOpenRouterModel, GroundingData } from '../types';
import { type ExecutionPolicy, assertPolicyModel, isFreeModelId } from './executionPolicy';
import { streamOpenRouterCompletion, type StreamOpenRouterCompletionOptions } from './openrouter';

export interface FallbackEvent {
  id: string;
  timestamp: number;
  personaId: string;
  personaName: string;
  originalModel: string;
  failedModel: string;
  triggerReason: string;
  errorMessage: string;
  replacementModel: string;
  replacementModelName: string;
  status: 'fallback_success' | 'fallback_failed' | 'no_fallback';
}

const FALLBACK_EVENTS_STORAGE_KEY = 'council_fallback_events_v1';

export function getStoredFallbackEvents(): FallbackEvent[] {
  try {
    const raw = localStorage.getItem(FALLBACK_EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load fallback events:', err);
    return [];
  }
}

export function saveFallbackEvent(event: FallbackEvent): FallbackEvent[] {
  const events = getStoredFallbackEvents();
  const updated = [event, ...events].slice(0, 100);
  try {
    localStorage.setItem(FALLBACK_EVENTS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save fallback event:', err);
  }
  return updated;
}

export function clearStoredFallbackEvents(): void {
  try {
    localStorage.removeItem(FALLBACK_EVENTS_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear fallback events:', err);
  }
}

/** Classifies the human-readable trigger reason for a failed model attempt. */
export function classifyTriggerReason(error: any, content?: string | null): string {
  if (!error && !content) return 'Invalid Response';

  const message = (error?.message || error?.toString?.() || '').toLowerCase();

  if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
    return 'HTTP 429 (Rate Limit)';
  }
  if (message.includes('timed out') || message.includes('timeout') || message.includes('aborterror')) {
    return 'Timeout';
  }
  if (
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('overloaded') ||
    message.includes('temporarily unavailable')
  ) {
    return 'Temporary Unavailability';
  }
  if (!content || content.trim().length === 0 || message.includes('invalid response')) {
    return 'Invalid Response';
  }
  return 'Unknown Error';
}

export interface BackupCandidate {
  model: string;
  name: string;
  org?: string;
  isFree?: boolean;
}

interface OrderedBackupOptions {
  activePersonas: Persona[];
  failingPersonaId: string;
  rawModels?: RawOpenRouterModel[];
  isFreeOnlyPreset?: boolean;
}

const DEFAULT_PAID_BACKUPS: BackupCandidate[] = [
  { model: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', org: 'anthropic' },
  { model: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', org: 'openai' },
  { model: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', org: 'google' },
  { model: 'deepseek/deepseek-chat', name: 'DeepSeek V3 Chat', org: 'deepseek' },
  { model: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', org: 'meta-llama' },
  { model: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct', org: 'qwen' },
];

const DEFAULT_FREE_BACKUPS: BackupCandidate[] = [
  { model: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', org: 'deepseek', isFree: true },
  { model: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B (Free)', org: 'meta-llama', isFree: true },
  { model: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Exp (Free)', org: 'google', isFree: true },
  { model: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B Instruct (Free)', org: 'qwen', isFree: true },
];

/** Computes an ordered backup candidate list excluding failed/active models. */
export function computeOrderedBackupList(options: OrderedBackupOptions): BackupCandidate[] {
  const { activePersonas, failingPersonaId, rawModels, isFreeOnlyPreset = false } = options;

  const excluded = new Set<string>();
  activePersonas.forEach((p) => {
    if (p.model) excluded.add(p.model.trim().toLowerCase());
  });

  const isFreeOnly = isFreeOnlyPreset;

  // Dynamic catalog prioritization when a valid rawModels list is provided.
  if (rawModels && Array.isArray(rawModels) && rawModels.length > 0 && rawModels.some((m) => m?.id)) {
    const candidates: BackupCandidate[] = rawModels
      .filter((m) => m && m.id)
      .map((m) => {
        const isFree = isFreeModelId(m.id, rawModels);
        return {
          model: m.id,
          name: m.name || m.id,
          org: m.id.split('/')[0] || 'unknown',
          isFree,
        };
      })
      .filter((c) => !excluded.has(c.model.trim().toLowerCase()))
      .filter((c) => (isFreeOnly ? c.isFree === true : true));

    if (candidates.length > 0) return candidates;
  }

  // Hardcoded default pool fallback.
  const defaults = isFreeOnly ? DEFAULT_FREE_BACKUPS : DEFAULT_PAID_BACKUPS;
  return defaults.filter((c) => !excluded.has(c.model.trim().toLowerCase()));
}

export interface StreamPersonaWithFallbackOptions {
  persona: Persona;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>;
  /** Execution policy governing budget constraints and provider fallback. */
  policy: ExecutionPolicy;
  rawModels?: RawOpenRouterModel[];
  sessionId?: string;
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  budget?: 'free' | 'cheap' | 'quality';
  query?: string;
  webSearch?: boolean;
  onGrounding?: (grounding: GroundingData) => void;
}

export interface StreamPersonaWithFallbackResult {
  content: string;
  actualModel: string;
  fallbackOccurred: boolean;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  grounding?: GroundingData;
  finishReason?: string;
  cost?: number;
}

/**
 * Streams a persona's response with policy-compliant provider fallback.
 * Every candidate model is validated against the execution policy before use.
 */
export async function streamPersonaWithFallback(
  options: StreamPersonaWithFallbackOptions
): Promise<StreamPersonaWithFallbackResult> {
  const { persona, messages, policy, rawModels = [], sessionId, onToken, signal, maxTokens, temperature, budget, query, webSearch, onGrounding } = options;

  const isFreeOnlyPreset = policy.budget === 'free';
  const originalModel = persona.model;
  const backups: BackupCandidate[] = policy.allowProviderFallback
    ? computeOrderedBackupList({
        activePersonas: [persona],
        failingPersonaId: persona.id,
        rawModels,
        isFreeOnlyPreset,
      })
    : [];

  const attemptChain: string[] = [originalModel, ...backups.map((b) => b.model)];

  let attempts = 0;
  let lastError: any = null;

  for (const currentModel of attemptChain) {
    // Enforce policy on every model attempt (free budget => verified free models only).
    assertPolicyModel(currentModel, policy, rawModels);

    attempts++;
    try {
      const streamOptions: StreamOpenRouterCompletionOptions = {
        model: currentModel,
        messages,
        temperature,
        maxTokens,
        budget: budget || policy.budget,
        query,
        signal,
        webSearch,
        onToken,
        onGrounding,
      };

      const streamResult = await streamOpenRouterCompletion(streamOptions);

      const streamContent = streamResult.content;

      // Verify response validity
      if (!streamContent || streamContent.trim().length === 0) {
        throw new Error('Invalid Response: Server returned empty output string.');
      }

      const actualExecutedModel = streamResult.actualModel || currentModel;

      // Successful completion!
      return {
        content: streamContent,
        actualModel: actualExecutedModel,
        fallbackOccurred: attempts > 1,
        usage: streamResult.usage,
        grounding: streamResult.grounding,
        finishReason: streamResult.finishReason,
        cost: streamResult.cost,
      };
    } catch (error: any) {
      lastError = error;
      const triggerReason = classifyTriggerReason(error, null);
      const nextModel = attemptChain[attempts] || '';
      saveFallbackEvent({
        id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        personaId: persona.id,
        personaName: persona.name,
        originalModel,
        failedModel: currentModel,
        triggerReason,
        errorMessage: error?.message || String(error),
        replacementModel: nextModel,
        replacementModelName: nextModel ? cleanName(nextModel) : 'None',
        status: nextModel ? 'fallback_success' : 'no_fallback',
      });
      console.warn(`[FallbackManager] Model "${currentModel}" failed (${triggerReason}). ${nextModel ? `Trying "${nextModel}"...` : 'No candidates remain.'}`);

      if (!policy.allowProviderFallback) {
        throw error;
      }
    }
  }

  throw new Error(`No policy-compliant fallback for "${originalModel}".`);
}

function cleanName(modelId: string): string {
  if (!modelId) return 'None';
  return modelId.split('/').pop() || modelId;
}

/** Backward-compatible singleton facade (audit logging kept in-memory). */
export const fallbackManager = {
  streamPersonaWithFallback,
  computeOrderedBackupList,
  classifyTriggerReason,
};
