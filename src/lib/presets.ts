import type { Persona, RawOpenRouterModel } from '../types';
import {
  isUsableCatalogModel,
  pricingIsFree,
  pickBestFromCatalog,
  catalogHasFreeModels,
  type ModelTier,
} from './modelScoring';

export type { RawOpenRouterModel };

export type PresetId =
  | 'fast_and_free'
  | 'highest_quality'
  | 'balanced_quality'
  | 'cheapest_viable'
  | string;

export interface PresetAssignment {
  model: string;
  label?: string;
  provider?: string;
  isFree?: boolean;
  rationale?: string;
}

export interface ModelPreset {
  id: PresetId;
  name: string;
  badge: string;
  description: string;
  category: 'finance' | 'life' | 'tech' | 'product' | 'legal' | 'general' | 'custom';
  assignments: Record<string, PresetAssignment>;
  /**
   * Runtime flag set by updatePresetsFromFetchedModels: when the live catalog
   * contains no zero-cost models, free-tier presets are honestly downgraded to
   * the cheapest paid substitutes and this is set to false so the UI can say so.
   */
  freeTierAvailable?: boolean;
}

/**
 * The assignments below are PREFERENCES, not promises: every time a live
 * OpenRouter catalog is fetched, updatePresetsFromFetchedModels validates each
 * model against it and dynamically re-resolves anything that has vanished
 * (free endpoints and frontier models rotate constantly). When the catalog is
 * unavailable (offline / fetch failed) these live models are the fallback.
 */
export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'fast_and_free',
    name: 'Fast & Free',
    badge: '⚡ Zero Cost (live-verified)',
    description:
      'Current live-verified zero-cost models. If OpenRouter\'s free tier is empty at refresh time, slots are honestly downgraded to the cheapest paid models and flagged in Settings.',
    category: 'general',
    freeTierAvailable: true,
    assignments: {
      skeptic: { model: 'nvidia/nemotron-3-ultra-550b-a55b:free', provider: 'openrouter', isFree: true },
      visionary: { model: 'openai/gpt-oss-120b:free', provider: 'openrouter', isFree: true },
      pragmatist: { model: 'google/gemma-4-31b-it:free', provider: 'openrouter', isFree: true },
      synthesizer: { model: 'qwen/qwen3-next-80b-a3b-instruct:free', provider: 'openrouter', isFree: true },
    },
  },
  {
    id: 'highest_quality',
    name: 'Highest Quality',
    badge: '👑 Frontier',
    description: 'Frontier reasoning models for deep, high-stakes analysis.',
    category: 'general',
    assignments: {
      skeptic: { model: 'anthropic/claude-sonnet-4.5', provider: 'openrouter' },
      visionary: { model: 'openai/gpt-5.1', provider: 'openrouter' },
      pragmatist: { model: 'google/gemini-2.5-pro', provider: 'openrouter' },
      synthesizer: { model: 'deepseek/deepseek-r1', provider: 'openrouter' },
    },
  },
  {
    id: 'balanced_quality',
    name: 'Balanced Quality',
    badge: '⚖️ Mixed',
    description: 'A balanced mix of capable low-cost models — the sensible default.',
    category: 'general',
    assignments: {
      skeptic: { model: 'openai/gpt-5.1', provider: 'openrouter' },
      visionary: { model: 'deepseek/deepseek-r1', provider: 'openrouter' },
      pragmatist: { model: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter' },
      synthesizer: { model: 'google/gemini-2.5-flash', provider: 'openrouter' },
    },
  },
  {
    id: 'cheapest_viable',
    name: 'Cheapest Viable',
    badge: '🪙 Budget',
    description: 'The cheapest viable paid models when free tiers are unavailable.',
    category: 'general',
    assignments: {
      skeptic: { model: 'deepseek/deepseek-chat', provider: 'openrouter' },
      visionary: { model: 'google/gemini-2.5-flash', provider: 'openrouter' },
      pragmatist: { model: 'openai/gpt-4o-mini', provider: 'openrouter' },
      synthesizer: { model: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter' },
    },
  },
];

/** Maps a preset id to the scoring tier used when dynamically resolving seats. */
export function presetTierFor(presetId: PresetId): ModelTier {
  switch (presetId) {
    case 'fast_and_free':
    case 'fastest_cheapest':
      return 'free';
    case 'highest_quality':
      return 'quality';
    case 'cheapest_viable':
      return 'cheap';
    case 'balanced_quality':
    default:
      return 'balanced';
  }
}

/** Cleans a raw model id into a human-readable display name. */
export function cleanModelName(modelId: string, name?: string): string {
  if (!modelId) return 'Unknown Model';
  if (name && name.trim()) return name.trim();

  const trimmed = modelId.trim();
  const withoutOrg = trimmed.includes('/') ? trimmed.split('/').slice(1).join('/') : trimmed;
  const withoutSuffix = withoutOrg.replace(/:(free|beta|nightly|exp)$/i, '');
  const humanized = withoutSuffix
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
  return humanized || trimmed;
}

export interface DuplicateCheckResult {
  hasDuplicates: boolean;
  duplicates: string[];
}

export interface DuplicateOrgCheckResult {
  hasDuplicates: boolean;
  duplicateOrgs: string[];
}

/** Detects duplicate model ids across personas and the synthesizer. */
export function checkDuplicateModels(personas: Persona[], synthesizer: Persona): DuplicateCheckResult {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];

  const consider = (modelId: string | undefined, owner: string) => {
    if (!modelId) return;
    const key = modelId.trim().toLowerCase();
    if (seen.has(key)) {
      if (!duplicates.includes(key)) duplicates.push(key);
    } else {
      seen.set(key, owner);
    }
  };

  personas.forEach((p) => consider(p.model, p.id));
  if (synthesizer) consider(synthesizer.model, synthesizer.id);

  return { hasDuplicates: duplicates.length > 0, duplicates };
}

/** Detects duplicate author organizations across personas and the synthesizer. */
export function checkDuplicateOrganizations(
  personas: Persona[],
  synthesizer: Persona
): DuplicateOrgCheckResult {
  const seen = new Set<string>();
  const duplicateOrgs: string[] = [];

  const consider = (modelId: string | undefined) => {
    if (!modelId) return;
    const org = (modelId.trim().split('/')[0] || '').toLowerCase();
    if (!org) return;
    if (seen.has(org)) {
      if (!duplicateOrgs.includes(org)) duplicateOrgs.push(org);
    } else {
      seen.add(org);
    }
  };

  personas.forEach((p) => consider(p.model));
  if (synthesizer) consider(synthesizer.model);

  return { hasDuplicates: duplicateOrgs.length > 0, duplicateOrgs };
}

function isFreeId(modelId: string): boolean {
  const n = modelId.trim().toLowerCase();
  if (n === 'openrouter/free' || n === 'openrouter/auto') return false;
  return n.endsWith(':free');
}

/** Applies a preset to the current personas + synthesizer, returning updated assignments.
 *
 * Dynamic resolution: when a live catalog is provided, each preset model is
 * validated against it. Vanished models are replaced with the best live
 * candidate for the same tier (scored by context, recency, cost, and
 * same-provider affinity) — never "the first model in the list".
 */
export function applyPreset(
  presetId: PresetId,
  personas: Persona[],
  synthesizer: Persona,
  rawModelsCatalog?: RawOpenRouterModel[]
): { updatedPersonas: Persona[]; updatedSynthesizer: Persona } {
  const preset = MODEL_PRESETS.find((p) => p.id === presetId) || MODEL_PRESETS[0];
  const catalog = (rawModelsCatalog || []).filter(isUsableCatalogModel);
  const tier = presetTierFor(presetId);
  const used = new Set<string>();

  const resolveModel = (slotId: string, fallback: string): string => {
    const assigned = preset.assignments[slotId]?.model;
    if (!assigned) return fallback;
    const assignedLower = assigned.toLowerCase();

    if (catalog.length > 0) {
      const live = catalog.some((m) => m.id.toLowerCase() === assignedLower);
      if (live) {
        used.add(assignedLower);
        return assigned;
      }
      // Vanished from the live catalog — re-resolve dynamically.
      const preferOrg = assigned.split('/')[0];
      const wantsFree = preset.assignments[slotId]?.isFree === true || isFreeId(assigned);
      const replacement = wantsFree
        ? pickBestFromCatalog(catalog, 'free', preferOrg, used) ||
          pickBestFromCatalog(catalog, 'cheap', preferOrg, used)
        : pickBestFromCatalog(catalog, tier, preferOrg, used);
      if (replacement) {
        used.add(replacement.id.toLowerCase());
        return replacement.id;
      }
      return fallback;
    }

    // No catalog (offline): trust the curated preference.
    used.add(assignedLower);
    return assigned;
  };

  const updatedPersonas = personas.map((p) => ({
    ...p,
    model: resolveModel(p.id, p.model),
  }));

  const updatedSynthesizer = {
    ...synthesizer,
    model: resolveModel('synthesizer', synthesizer.model),
  };

  return { updatedPersonas, updatedSynthesizer };
}

/**
 * Recomputes preset assignments from a live OpenRouter catalog, preserving
 * preset structure and never throwing on malformed input.
 *
 * Free-tier honesty: if the live catalog contains no zero-cost models, free
 * preset slots are downgraded to cheap paid models and preset.freeTierAvailable
 * is set to false so the UI can tell the user instead of silently selling
 * "Free" that costs money.
 */
export function updatePresetsFromFetchedModels(rawModels: RawOpenRouterModel[]): void {
  if (!rawModels || !Array.isArray(rawModels)) return;

  const usable = rawModels.filter(isUsableCatalogModel);
  const byId = new Map(usable.map((m) => [m.id.toLowerCase(), m]));
  const anyFreeLive = catalogHasFreeModels(usable);

  MODEL_PRESETS.forEach((preset) => {
    const tier = presetTierFor(preset.id);
    const wantsFree = tier === 'free';
    const used = new Set<string>();
    preset.freeTierAvailable = wantsFree ? anyFreeLive : true;

    Object.keys(preset.assignments).forEach((slotId) => {
      const assignment = preset.assignments[slotId];
      if (!assignment) return;
      const currentId = assignment.model?.toLowerCase();
      if (currentId && byId.has(currentId)) {
        used.add(currentId);
        return; // still live — keep
      }

      // Slot's current model vanished from the catalog; replace with a live candidate.
      const preferOrg = currentId ? currentId.split('/')[0] : undefined;
      let replacement;
      if (wantsFree && anyFreeLive) {
        // If the live free pool is smaller than the number of free slots,
        // remaining seats honestly fall back to the cheapest paid models.
        replacement =
          pickBestFromCatalog(usable, 'free', preferOrg, used) ||
          pickBestFromCatalog(usable, 'cheap', preferOrg, used);
      } else if (wantsFree && !anyFreeLive) {
        // Honest downgrade: no live free models → cheapest paid substitute.
        replacement = pickBestFromCatalog(usable, 'cheap', preferOrg, used);
      } else {
        replacement = pickBestFromCatalog(usable, tier, preferOrg, used);
      }

      if (replacement) {
        assignment.model = replacement.id;
        assignment.isFree = pricingIsFree(replacement);
        used.add(replacement.id.toLowerCase());
      }
    });
  });
}
