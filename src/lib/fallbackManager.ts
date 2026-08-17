import { Persona, PersonaId, GroundingData } from '../types';
import { RawOpenRouterModel, cleanModelName } from './presets';
import { isFreeModel, getAuthorOrganization, getFamily, getCanonicalTarget } from './modelMapper';
import { streamOpenRouterCompletion } from './openrouter';
import { ExecutionPolicy, assertPolicyModel } from './executionPolicy';

export type TriggerReason = 
  | 'HTTP 429 (Rate Limit)'
  | 'Temporary Unavailability'
  | 'Provider Error'
  | 'Timeout'
  | 'Invalid Response';

export interface FallbackEvent {
  id: string;
  timestamp: number;
  roundId?: string;
  personaId: PersonaId;
  personaName: string;
  originalModel: string;
  failedModel: string;
  triggerReason: TriggerReason;
  errorMessage: string;
  replacementModel: string | null;
  replacementModelName?: string | null;
  status: 'fallback_success' | 'fallback_failed';
}

export interface BackupCandidate {
  model: string;
  name: string;
  org: string;
  family: string;
  isFree: boolean;
}

const FALLBACK_LOGS_STORAGE_KEY = 'council_chamber_fallback_logs_v1';

export function getStoredFallbackEvents(): FallbackEvent[] {
  try {
    const raw = localStorage.getItem(FALLBACK_LOGS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse stored fallback logs:', err);
    return [];
  }
}

export function saveFallbackEvent(event: FallbackEvent): FallbackEvent[] {
  const existing = getStoredFallbackEvents();
  const updated = [event, ...existing].slice(0, 100); // Keep last 100 entries
  try {
    localStorage.setItem(FALLBACK_LOGS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save fallback event to localStorage:', err);
  }
  return updated;
}

export function clearStoredFallbackEvents(): void {
  try {
    localStorage.removeItem(FALLBACK_LOGS_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear fallback logs:', err);
  }
}

/**
 * Classifies an error or response issue into one of the 5 required failure triggers:
 * 1. HTTP 429 (Rate Limit)
 * 2. Temporary Unavailability (500/502/503/504, network failure)
 * 3. Provider Error (OpenRouter provider error, model missing)
 * 4. Timeout (request or panelist timeout)
 * 5. Invalid Response (empty content or broken stream payload)
 */
export function classifyTriggerReason(error: any, responseText?: string): TriggerReason {
  const errStr = (error?.message || error?.toString() || '').toLowerCase();

  if (errStr.includes('429') || errStr.includes('rate limit') || errStr.includes('too many requests')) {
    return 'HTTP 429 (Rate Limit)';
  }

  if (
    errStr.includes('timeout') ||
    errStr.includes('timed out') ||
    errStr.includes('aborterror') ||
    errStr.includes('deadline_exceeded') ||
    errStr.includes('signal is timed out')
  ) {
    return 'Timeout';
  }

  if (
    errStr.includes('500') ||
    errStr.includes('502') ||
    errStr.includes('503') ||
    errStr.includes('504') ||
    errStr.includes('520') ||
    errStr.includes('522') ||
    errStr.includes('524') ||
    errStr.includes('temporarily unavailable') ||
    errStr.includes('service unavailable') ||
    errStr.includes('server error') ||
    errStr.includes('bad gateway') ||
    errStr.includes('gateway timeout') ||
    errStr.includes('overloaded') ||
    errStr.includes('failed to fetch') ||
    errStr.includes('network error')
  ) {
    return 'Temporary Unavailability';
  }

  if (
    errStr.includes('empty response') ||
    errStr.includes('invalid response') ||
    (responseText !== undefined && responseText.trim().length === 0)
  ) {
    return 'Invalid Response';
  }

  return 'Provider Error';
}

/**
 * Default fallback candidates when raw OpenRouter models are not dynamically fetched yet.
 */
const DEFAULT_FREE_BACKUPS: BackupCandidate[] = [
  { model: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (free)', org: 'google', family: 'gemini-2.0', isFree: true },
  { model: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', org: 'google', family: 'gemma-4', isFree: true },
  { model: 'poolside/laguna-xs-2.1:free', name: 'Laguna XS 2.1 (free)', org: 'poolside', family: 'laguna-xs', isFree: true },
  { model: 'inclusionai/ling-3.0-tiny:free', name: 'Ling 3.0 Tiny (free)', org: 'inclusionai', family: 'ling-3.0', isFree: true },
  { model: 'qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B (free)', org: 'qwen', family: 'qwen-2.5-coder', isFree: true },
  { model: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (free)', org: 'meta-llama', family: 'llama-3.3', isFree: true },
  { model: 'mistralai/mistral-small-24b-instruct-2501:free', name: 'Mistral Small 24B (free)', org: 'mistralai', family: 'mistral-small', isFree: true },
];

const DEFAULT_PAID_BACKUPS: BackupCandidate[] = [
  { model: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', org: 'openai', family: 'gpt-4o-mini', isFree: false },
  { model: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', org: 'anthropic', family: 'claude-3.5-haiku', isFree: false },
  { model: 'deepseek/deepseek-chat', name: 'DeepSeek V3', org: 'deepseek', family: 'deepseek-v3', isFree: false },
  { model: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', org: 'qwen', family: 'qwen-2.5', isFree: false },
  { model: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', org: 'meta-llama', family: 'llama-3.3', isFree: false },
  { model: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', org: 'google', family: 'gemini-2.5-flash', isFree: false },
  { model: 'mistralai/mistral-large-2411', name: 'Mistral Large', org: 'mistralai', family: 'mistral-large', isFree: false },
];

/**
 * Computes an ordered backup list for a selected council.
 * Constraints enforced for replacement:
 * - Unused Author Organization (must not belong to an author org used by other active council members)
 * - Unused Model Family (must not belong to a model family used by other active council members)
 * - Free/Paid requirement: Fast & Free fallback MUST use free models only
 */
export function computeOrderedBackupList(options: {
  activePersonas: Persona[];
  synthesizer?: Persona;
  failingPersonaId: PersonaId;
  rawModels?: RawOpenRouterModel[];
  policy: ExecutionPolicy;
  attemptedModels?: Set<string>;
}): BackupCandidate[] {
  const {
    activePersonas,
    synthesizer,
    failingPersonaId,
    rawModels,
    policy,
    attemptedModels = new Set<string>(),
  } = options;

  const isFreeOnlyPreset = policy.budget === 'free';

  // Determine currently used author orgs and model families by OTHER active council members
  const usedOrgs = new Set<string>();
  const usedFamilies = new Set<string>();
  const usedTargets = new Set<string>();

  activePersonas.forEach((p) => {
    if (p.enabled !== false && p.id !== failingPersonaId && p.model) {
      const modelId = p.model.trim();
      usedOrgs.add(getAuthorOrganization(modelId));
      usedFamilies.add(getFamily(modelId));
      usedTargets.add(getCanonicalTarget({ id: modelId } as any));
    }
  });

  if (synthesizer && synthesizer.id !== failingPersonaId && synthesizer.model) {
    const synthModel = synthesizer.model.trim();
    usedOrgs.add(getAuthorOrganization(synthModel));
    usedFamilies.add(getFamily(synthModel));
    usedTargets.add(getCanonicalTarget({ id: synthModel } as any));
  }

  // Also include the failing persona's original model in usedOrgs/usedFamilies to ensure a distinct provider/family is chosen
  const failingPersona = activePersonas.find((p) => p.id === failingPersonaId) || (synthesizer?.id === failingPersonaId ? synthesizer : null);
  if (failingPersona && failingPersona.model) {
    attemptedModels.add(failingPersona.model.trim());
  }

  // 1. Build candidates dynamically from rawModels (rawModelsCatalog) if valid and non-empty.
  // Hardcoded backup lists are strictly used as a last resort.
  let candidates: BackupCandidate[] = [];

  const isValidRawModels = Array.isArray(rawModels) && rawModels.length > 0;

  if (isValidRawModels) {
    candidates = rawModels
      .filter((m) => {
        if (!m || typeof m.id !== 'string' || !m.id.trim()) return false;

        const id = m.id.trim();
        // Skip meta / router aliases
        if (id === 'openrouter/auto' || id === 'openrouter/free' || id.includes('openrouter/auto') || id.includes('openrouter/free')) {
          return false;
        }

        // Fast & Free requirement: must be a verified free model
        const free = isFreeModel(m);
        if (isFreeOnlyPreset && !free) return false;

        return true;
      })
      .map((m) => ({
        model: m.id.trim(),
        name: cleanModelName(m.id.trim(), m.name),
        org: getAuthorOrganization(m.id.trim()),
        family: getFamily(m),
        isFree: isFreeModel(m),
      }));
  }

  // 2. Fall back to hardcoded defaults only if rawModels is empty, invalid, or produced no candidates
  if (candidates.length === 0) {
    const pool = isFreeOnlyPreset
      ? DEFAULT_FREE_BACKUPS
      : [...DEFAULT_FREE_BACKUPS, ...DEFAULT_PAID_BACKUPS];

    candidates = pool.filter((m) => {
      if (isFreeOnlyPreset && !m.isFree) return false;
      return true;
    });
  }

  // Filter candidates enforcing Unused Author Organization & Unused Model Family & Unattempted
  const filtered = candidates.filter((cand) => {
    if (attemptedModels.has(cand.model)) return false;
    if (usedOrgs.has(cand.org)) return false;
    if (usedFamilies.has(cand.family)) return false;
    if (usedTargets.has(getCanonicalTarget({ id: cand.model } as any))) return false;
    return true;
  });

  // If no strict candidate remains (e.g. org/family space exhausted), relax org/family uniqueness while preserving free/paid rule
  if (filtered.length === 0) {
    const relaxed = candidates.filter((cand) => !attemptedModels.has(cand.model));
    return relaxed;
  }

  return filtered;
}

export interface StreamPersonaWithFallbackOptions {
  personaId: PersonaId;
  personaName: string;
  roundId?: string;
  apiKey: string;
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
  activePersonas: Persona[];
  synthesizer?: Persona;
  rawModels?: RawOpenRouterModel[];
  policy: ExecutionPolicy;
  onFallbackTriggered?: (event: FallbackEvent) => void;
}

/**
 * Streams a persona completion with automatic fallback logic.
 * Triggers on: HTTP 429, Temporary Unavailability, Provider Error, Timeout, or Invalid Response.
 * Replacement MUST:
 * - Belong to an unused author organization
 * - Belong to an unused model family
 * - Satisfy free/paid preset requirement (Fast & Free → free models only)
 * - Log every fallback event.
 */
export async function streamPersonaWithFallback(
  options: StreamPersonaWithFallbackOptions
): Promise<{
  content: string;
  finalModel: string;
  fallbackOccurred: boolean;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  grounding?: GroundingData;
  finishReason?: string;
}> {
  const {
    personaId,
    personaName,
    roundId,
    apiKey,
    messages,
    temperature,
    maxTokens,
    budget,
    query,
    signal,
    onToken,
    onGrounding,
    activePersonas,
    synthesizer,
    rawModels,
    policy,
    disableFallback = false,
    onFallbackTriggered,
  } = options;

  let currentModel = options.model;
  const attemptedModels = new Set<string>();
  const MAX_FALLBACK_ATTEMPTS = disableFallback ? 1 : 3;

  let attempts = 0;
  let lastError: any = null;

  while (attempts <= MAX_FALLBACK_ATTEMPTS) {
    attempts++;
    assertPolicyModel(currentModel, policy, rawModels);
    attemptedModels.add(currentModel);

    let streamResult: { content: string; actualModel?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; grounding?: GroundingData; finishReason?: string } = { content: '' };
    let hasTokenStreamed = false;

    try {
      streamResult = await streamOpenRouterCompletion({
        apiKey,
        model: currentModel,
        messages,
        temperature,
        maxTokens,
        budget,
        query,
        signal,
        disableFallback,
        onToken: (chunk) => {
          if (chunk) hasTokenStreamed = true;
          if (onToken) onToken(chunk);
        },
        onGrounding,
      });

      let streamContent = streamResult.content;
      let finalFinishReason = streamResult.finishReason;
      let finalUsage = streamResult.usage;

      // Automatic token expansion on truncation detection
      if (finalFinishReason === 'length' || finalFinishReason === 'max_tokens') {
        let continuationCount = 0;
        const maxContinuations = 2; // Allow up to 2 auto-expansions
        let currentMessages = [...messages];
        let currentMaxTokens = maxTokens ? maxTokens * 1.5 : 4000;

        while ((finalFinishReason === 'length' || finalFinishReason === 'max_tokens') && continuationCount < maxContinuations) {
          continuationCount++;
          console.log(`[Token Expansion] Truncation detected for ${currentModel}. Auto-expanding tokens (Attempt ${continuationCount})...`);
          
          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: streamContent },
            { role: 'user', content: 'Continue exactly where you left off. Do not repeat anything from your previous response, just pick up from the exact last word.' }
          ];

          const contResult = await streamOpenRouterCompletion({
            apiKey,
            model: currentModel,
            messages: currentMessages,
            temperature,
            maxTokens: Math.floor(currentMaxTokens),
            budget,
            query,
            signal,
            disableFallback,
            onToken: (chunk) => {
              if (chunk) hasTokenStreamed = true;
              if (onToken) onToken(chunk);
            },
            onGrounding
          });

          streamContent += contResult.content;
          finalFinishReason = contResult.finishReason;
          if (contResult.usage && finalUsage) {
             finalUsage = {
                promptTokens: (finalUsage.promptTokens || 0) + (contResult.usage.promptTokens || 0),
                completionTokens: (finalUsage.completionTokens || 0) + (contResult.usage.completionTokens || 0),
                totalTokens: (finalUsage.totalTokens || 0) + (contResult.usage.totalTokens || 0)
             };
          } else {
             finalUsage = contResult.usage || finalUsage;
          }
          currentMaxTokens *= 1.5;
        }
      }

      // Verify response validity
      if (!streamContent || streamContent.trim().length === 0) {
        throw new Error('Invalid Response: Server returned empty output string.');
      }

      const actualExecutedModel = streamResult.actualModel || currentModel;

      // Successful completion!
      return {
        content: streamContent,
        finalModel: actualExecutedModel,
        fallbackOccurred: attempts > 1,
        usage: finalUsage,
        grounding: streamResult.grounding,
        finishReason: finalFinishReason,
      };
    } catch (err: any) {
      lastError = err;

      // Do not trigger fallback on user cancellation or explicit web grounding unavailabilities
      if (err.name === 'AbortError' && signal?.aborted) {
        throw err;
      }
      if (err.message && err.message.includes('WEB_GROUNDING_UNAVAILABLE')) {
        throw err;
      }

      const streamContent = streamResult.content;
      const triggerReason = classifyTriggerReason(err, streamContent);
      console.warn(
        `[Fallback Triggered] Persona "${personaName}" (${personaId}) with model "${currentModel}" failed attempt ${attempts}: ${triggerReason} - ${err.message}`
      );

      // If fallback is explicitly disabled by user, record event and fail fast
      if (disableFallback) {
        const fallbackEvent: FallbackEvent = {
          id: `fb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          timestamp: Date.now(),
          roundId,
          personaId,
          personaName,
          originalModel: options.model,
          failedModel: currentModel,
          triggerReason,
          errorMessage: err.message || String(err),
          replacementModel: null,
          replacementModelName: null,
          status: 'fallback_failed',
        };
        saveFallbackEvent(fallbackEvent);
        if (onFallbackTriggered) {
          onFallbackTriggered(fallbackEvent);
        }
        throw err;
      }

      // Compute backup list for replacement
      const backups = computeOrderedBackupList({
        activePersonas,
        synthesizer,
        failingPersonaId: personaId,
        rawModels,
        policy,
        attemptedModels,
      });

      const replacementCandidate = backups.length > 0 ? backups[0] : null;

      const fallbackEvent: FallbackEvent = {
        id: `fb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        timestamp: Date.now(),
        roundId,
        personaId,
        personaName,
        originalModel: options.model,
        failedModel: currentModel,
        triggerReason,
        errorMessage: err.message || String(err),
        replacementModel: replacementCandidate ? replacementCandidate.model : null,
        replacementModelName: replacementCandidate ? replacementCandidate.name : null,
        status: replacementCandidate ? 'fallback_success' : 'fallback_failed',
      };

      saveFallbackEvent(fallbackEvent);
      if (onFallbackTriggered) {
        onFallbackTriggered(fallbackEvent);
      }

      if (!replacementCandidate) {
        throw new Error(`No policy-compliant fallback is available for "${currentModel}".`);
      }

      // Switch to replacement model for next attempt loop
      currentModel = replacementCandidate.model;
    }
  }

  throw lastError || new Error(`Failed to complete persona streaming after ${MAX_FALLBACK_ATTEMPTS} fallback attempts.`);
}
