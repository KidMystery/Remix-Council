import type { Persona, RawOpenRouterModel, GroundingData } from '../types';
import { type ExecutionPolicy, isFreeModelId } from './executionPolicy';
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

/**
 * Hardcoded backup pools are a LAST resort, used only when no live catalog is
 * available (offline / fetch failed). The live catalog always takes priority —
 * these ids are current (verified against OpenRouter in Aug 2026) and are
 * re-validated at run time against the catalog when one exists.
 */
const DEFAULT_PAID_BACKUPS: BackupCandidate[] = [
  { model: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', org: 'google' },
  { model: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', org: 'openai' },
  { model: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', org: 'google' },
  { model: 'deepseek/deepseek-chat', name: 'DeepSeek V3 Chat', org: 'deepseek' },
  { model: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', org: 'meta-llama' },
];

const DEFAULT_FREE_BACKUPS: BackupCandidate[] = [
  { model: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B (Free)', org: 'nvidia', isFree: true },
  { model: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (Free)', org: 'openai', isFree: true },
  { model: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Free)', org: 'google', isFree: true },
  { model: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B (Free)', org: 'qwen', isFree: true },
  // Last-resort router: OpenRouter picks a live free model for you.
  { model: 'openrouter/free', name: 'Free Models Router', org: 'openrouter', isFree: true },
];

/** Computes an ordered backup candidate list excluding failed/active models. */
export function computeOrderedBackupList(options: OrderedBackupOptions): BackupCandidate[] {
  const { activePersonas, failingPersonaId, rawModels, isFreeOnlyPreset = false } = options;

  const excluded = new Set<string>();
  const otherOrgs = new Set<string>();
  activePersonas.forEach((p) => {
    if (p.model) excluded.add(p.model.trim().toLowerCase());
    if (p.id !== failingPersonaId && p.model) {
      const org = p.model.split('/')[0]?.toLowerCase();
      if (org) otherOrgs.add(org);
    }
  });

  const isFreeOnly = isFreeOnlyPreset;

  const rank = (c: BackupCandidate): number => {
    const org = (c.org || c.model.split('/')[0] || '').toLowerCase();
    if (otherOrgs.has(org)) return 2;
    return 0;
  };

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
      .filter((c) => (isFreeOnly ? c.isFree === true : true))
      .sort((a, b) => rank(a) - rank(b));

    const unusedOrg = candidates.filter((c) => rank(c) === 0);
    if (unusedOrg.length > 0) return unusedOrg;
    if (candidates.length > 0) return candidates;
  }

  // Hardcoded default pool fallback.
  const defaults = (isFreeOnly ? DEFAULT_FREE_BACKUPS : DEFAULT_PAID_BACKUPS)
    .filter((c) => !excluded.has(c.model.trim().toLowerCase()))
    .sort((a, b) => rank(a) - rank(b));
  const unusedDefaults = defaults.filter((c) => rank(c) === 0);
  return unusedDefaults.length > 0 ? unusedDefaults : defaults;
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
  /** Strict no-fallback mode: surface raw errors instead of swapping models. */
  disableFallback?: boolean;
  /** Server cost governor: round identity + per-round USD ceiling. */
  roundKey?: string;
  costCeilingUSD?: number;
  plugins?: unknown[];
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
  const { persona, messages, policy, rawModels = [], sessionId, onToken, signal, maxTokens, temperature, budget, query, webSearch, onGrounding, disableFallback, roundKey, costCeilingUSD, plugins } = options;

  const isFreeOnlyPreset = policy.budget === 'free';
  const originalModel = persona.model;

  // Free mode: never abort just because the configured model isn't verified
  // free in the live catalog — auto-select a verified-free replacement instead
  // (that is the whole point of auto-select). Provider-fallback rules still
  // forbid paid upgrades; free→free swaps are always allowed.
  let startModel = originalModel;
  let policySubstituted = false;
  // Strict no-fallback mode: pin to the configured model and surface raw errors.
  if (disableFallback) {
    const strictRes = await streamOpenRouterCompletion({
      model: originalModel,
      messages,
      temperature,
      maxTokens,
      budget: budget || policy.budget,
      query,
      signal,
      webSearch,
      onToken,
      onGrounding,
      roundKey,
      costCeilingUSD,
      plugins,
      sessionId,
    });
    return { ...strictRes, actualModel: strictRes.actualModel || originalModel, fallbackOccurred: false };
  }
  if (isFreeOnlyPreset && !isFreeModelId(originalModel, rawModels)) {
    const freeCandidates = computeOrderedBackupList({
      activePersonas: [persona],
      failingPersonaId: persona.id,
      rawModels,
      isFreeOnlyPreset: true,
    });
    const replacement = freeCandidates[0]?.model;
    if (!replacement) {
      throw new Error(
        `Free mode: "${originalModel}" is not verified free right now and no free models are available in the catalog. Try again in a moment or switch to a paid preset.`
      );
    }
    policySubstituted = true;
    startModel = replacement;
    saveFallbackEvent({
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      personaId: persona.id,
      personaName: persona.name,
      originalModel,
      failedModel: originalModel,
      triggerReason: 'Policy: not free — auto-switched',
      errorMessage: `"${originalModel}" failed the verified-free check; free mode substituted a free model.`,
      replacementModel: replacement,
      replacementModelName: cleanName(replacement),
      status: 'fallback_success',
    });
    console.warn(
      `[FallbackManager] Free mode: "${originalModel}" is not verified free — auto-switching to "${replacement}".`
    );
  }

  // Free mode always allows free→free swaps even when provider fallback is
  // disabled; that ban exists to prevent silent paid upgrades.
  const backups: BackupCandidate[] = (policy.allowProviderFallback || isFreeOnlyPreset)
    ? computeOrderedBackupList({
        activePersonas: [{ ...persona, model: startModel }],
        failingPersonaId: persona.id,
        rawModels,
        isFreeOnlyPreset,
      })
    : [];

  const attemptChain: string[] = Array.from(
    new Set([startModel, ...backups.map((b) => b.model)])
  );

  let attempts = 0;
  let lastError: any = null;

  for (const currentModel of attemptChain) {
    // Enforce policy per attempt: in free mode, skip (don't abort on) any
    // candidate that isn't verified free in the live catalog.
    if (isFreeOnlyPreset && !isFreeModelId(currentModel, rawModels)) {
      console.warn(
        `[FallbackManager] Skipping "${currentModel}" — not verified free in the live catalog.`
      );
      continue;
    }

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
        disableFallback,
        roundKey,
        costCeilingUSD,
        plugins,
        sessionId,
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
        fallbackOccurred: attempts > 1 || policySubstituted,
        usage: streamResult.usage,
        grounding: streamResult.grounding,
        finishReason: streamResult.finishReason,
        cost: streamResult.cost,
      };
    } catch (error: any) {
      // A cost-governor refusal is a budget guard, not a model failure: never
      // try backup models, surface it to the run loop untouched. Same for owner gate
      // auth rejection: backup models cannot fix a 401.
      if (error?.costCeilingExceeded || error?.isOwnerAuthError) throw error;
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

  throw new Error(
    isFreeOnlyPreset
      ? `Every candidate for "${originalModel}" failed or lost free status. Last error: ${
          lastError?.message || 'unknown'
        }. Try again shortly or switch to a paid preset.`
      : `No policy-compliant fallback for "${originalModel}". Last error: ${
          lastError?.message || 'unknown'
        }.`
  );
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
