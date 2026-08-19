import type { Persona, RawOpenRouterModel } from '../types';

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
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'fast_and_free',
    name: 'Fast & Free',
    badge: '⚡ Zero Cost',
    description: 'Ultra-fast free-tier models for rapid, cost-free deliberations.',
    category: 'general',
    assignments: {
      skeptic: { model: 'meta-llama/llama-3.2-3b-instruct:free', provider: 'openrouter', isFree: true },
      visionary: { model: 'google/gemini-2.0-flash-exp:free', provider: 'openrouter', isFree: true },
      pragmatist: { model: 'deepseek/deepseek-r1:free', provider: 'openrouter', isFree: true },
      synthesizer: { model: 'qwen/qwen-2.5-72b-instruct:free', provider: 'openrouter', isFree: true },
    },
  },
  {
    id: 'highest_quality',
    name: 'Highest Quality',
    badge: '👑 Frontier',
    description: 'Frontier reasoning models for deep, high-stakes analysis.',
    category: 'general',
    assignments: {
      skeptic: { model: 'anthropic/claude-3.7-sonnet', provider: 'openrouter' },
      visionary: { model: 'openai/gpt-4o', provider: 'openrouter' },
      pragmatist: { model: 'deepseek/deepseek-r1', provider: 'openrouter' },
      synthesizer: { model: 'google/gemini-2.5-pro', provider: 'openrouter' },
    },
  },
  {
    id: 'balanced_quality',
    name: 'Balanced Quality',
    badge: '⚖️ Mixed',
    description: 'A balanced mix of capable paid and free models.',
    category: 'general',
    assignments: {
      skeptic: { model: 'anthropic/claude-3.5-haiku', provider: 'openrouter' },
      visionary: { model: 'meta-llama/llama-3.3-70b-instruct', provider: 'openrouter' },
      pragmatist: { model: 'openai/gpt-4o-mini', provider: 'openrouter' },
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

/** Applies a preset to the current personas + synthesizer, returning updated assignments. */
export function applyPreset(
  presetId: PresetId,
  personas: Persona[],
  synthesizer: Persona,
  rawModelsCatalog?: RawOpenRouterModel[]
): { updatedPersonas: Persona[]; updatedSynthesizer: Persona } {
  const preset = MODEL_PRESETS.find((p) => p.id === presetId) || MODEL_PRESETS[0];
  const catalog = rawModelsCatalog || [];

  const resolveModel = (slotId: string, fallback: string): string => {
    const assigned = preset.assignments[slotId]?.model;
    if (!assigned) return fallback;
    // Verify the model exists in the live catalog when available; otherwise keep the assignment.
    const catalogIds = new Set(catalog.map((m) => m.id.toLowerCase()));
    if (catalog.length > 0 && !catalogIds.has(assigned.toLowerCase())) {
      // Fall back to a catalog model that satisfies the same budget class if possible.
      const isFreeSlot = preset.assignments[slotId]?.isFree === true || isFreeId(assigned);
      const candidate = catalog.find((m) => {
        const isFreeCandidate =
          parseFloat(String(m.pricing?.request || '0')) <= 0.000001 &&
          parseFloat(String(m.pricing?.prompt || '0')) <= 0.000001 &&
          parseFloat(String(m.pricing?.completion || '0')) <= 0.000001;
        return isFreeSlot ? isFreeCandidate : !isFreeCandidate;
      });
      return candidate?.id || fallback;
    }
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
 */
export function updatePresetsFromFetchedModels(rawModels: RawOpenRouterModel[]): void {
  if (!rawModels || !Array.isArray(rawModels)) return;

  const byId = new Map(rawModels.map((m) => [m.id.toLowerCase(), m]));
  const freeModels = rawModels.filter(
    (m) =>
      parseFloat(String(m.pricing?.request || '0')) <= 0.000001 &&
      parseFloat(String(m.pricing?.prompt || '0')) <= 0.000001 &&
      parseFloat(String(m.pricing?.completion || '0')) <= 0.000001
  );

  MODEL_PRESETS.forEach((preset) => {
    Object.keys(preset.assignments).forEach((slotId) => {
      const assignment = preset.assignments[slotId];
      if (!assignment) return;
      const currentId = assignment.model?.toLowerCase();
      if (currentId && byId.has(currentId)) return; // still live — keep

      // Slot's current model vanished from the catalog; replace with a live candidate.
      const preferFree = assignment.isFree === true || isFreeId(assignment.model || '');
      const pool = preferFree ? freeModels : rawModels.filter((m) => !freeModels.includes(m));
      const replacement = pool[0];
      if (replacement) {
        assignment.model = replacement.id;
        assignment.isFree = preferFree;
      }
    });
  });
}
