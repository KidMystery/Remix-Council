import { Persona, PersonaId } from '../types';
import { registerModelPricing } from './archivist';
import { mapOpenRouterModels, AssignedModel, getAuthorOrganization } from './modelMapper';

export type PresetId = 'fastest_cheapest' | 'fast_and_free' | 'fast_and_cheap' | 'best_value' | 'highest_quality';

export interface ModelPresetAssignment {
  model: string;
  name: string;
  alsoInPresets?: string[];
}

export interface ModelPreset {
  id: PresetId;
  name: string;
  badge: string;
  description: string;
  assignments: Record<PersonaId, ModelPresetAssignment>;
}

export interface RawOpenRouterModel {
  id: string;
  name?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    request?: string | number;
  };
  description?: string;
  context_length?: number;
  created?: number;
  canonical_slug?: string;
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
    latency?: number;
    throughput?: number;
  };
  benchmarks?: {
    intelligence?: number;
    coding?: number;
    agentic?: number;
    design_arena_elo?: number;
    arena_elo?: number;
    elo?: number;
    weekly_popularity?: number;
    latency?: number;
    throughput?: number;
  };
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'fast_and_free',
    name: 'Fast & Free',
    badge: '⚡ $0 Speed & Efficiency',
    description: '$0 models optimized for speed',
    assignments: {
      skeptic: { model: 'nvidia/nemotron-3.5-content-safety:free', name: 'Nemotron 3.5 Content Safety (free)' },
      visionary: { model: 'poolside/laguna-xs-2.1:free', name: 'Laguna XS 2.1 (free)' },
      pragmatist: { model: 'inclusionai/ling-3.0-tiny:free', name: 'Ling 3.0 Tiny (free)' },
      synthesizer: { model: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)' },
    },
  },
  {
    id: 'fast_and_cheap',
    name: 'Fast & Cheap',
    badge: '🚀 Low-Cost Speed',
    description: 'Fast paid models at a low cost',
    assignments: {
      skeptic: { model: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
      visionary: { model: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct' },
      pragmatist: { model: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
      synthesizer: { model: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
    },
  },
  {
    id: 'best_value',
    name: 'Best Value',
    badge: '⚖️ Quality & Cost Balance',
    description: 'Best quality-to-cost balance',
    assignments: {
      skeptic: { model: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
      visionary: { model: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
      pragmatist: { model: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      synthesizer: { model: 'google/gemini-2.0-flash-thinking-exp:free', name: 'Gemini 2.0 Flash Thinking' },
    },
  },
  {
    id: 'highest_quality',
    name: 'Highest Quality',
    badge: '🏆 Top-Tier Performance',
    description: 'Top overall capability; price is secondary',
    assignments: {
      skeptic: { model: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
      visionary: { model: 'openai/gpt-4o', name: 'GPT-4o' },
      pragmatist: { model: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
      synthesizer: { model: 'google/gemini-2.0-pro-exp-02-05', name: 'Gemini 2.0 Pro' },
    },
  },
];

export function cleanModelName(id: string, rawName?: string): string {
  let clean = rawName || id;
  clean = clean.replace(/^[A-Za-z0-9-]+[:/]\s*/, '');
  return clean;
}

function updatePresetAssignments(
  presetObj: ModelPreset,
  assignedList: AssignedModel[]
) {
  if (!presetObj || !assignedList || assignedList.length === 0) return;
  const getRole = (role: PersonaId) => assignedList.find(m => m.personaId === role) || assignedList[0];

  const mapAssignment = (role: PersonaId) => {
    const item = getRole(role);
    return {
      model: item.model,
      name: item.name,
      alsoInPresets: item.alsoInPresets,
    };
  };

  presetObj.assignments = {
    skeptic: mapAssignment('skeptic'),
    visionary: mapAssignment('visionary'),
    pragmatist: mapAssignment('pragmatist'),
    synthesizer: mapAssignment('synthesizer'),
  };
}

export function updatePresetsFromFetchedModels(rawModels: RawOpenRouterModel[]): ModelPreset[] {
  if (!rawModels || !Array.isArray(rawModels) || rawModels.length === 0) {
    return MODEL_PRESETS;
  }

  // Register pricing info into archivist model rates table
  rawModels.forEach((m) => {
    if (m.id && m.pricing) {
      const promptVal = typeof m.pricing.prompt === 'string' ? parseFloat(m.pricing.prompt) : (m.pricing.prompt || 0);
      const completionVal = typeof m.pricing.completion === 'string' ? parseFloat(m.pricing.completion) : (m.pricing.completion || 0);
      registerModelPricing(m.id, promptVal * 1_000_000, completionVal * 1_000_000);
    }
  });

  const { fastAndFree, fastAndCheap, bestValue, highestQuality } = mapOpenRouterModels(rawModels);

  const freePreset = MODEL_PRESETS.find(p => p.id === 'fast_and_free');
  if (freePreset) updatePresetAssignments(freePreset, fastAndFree);

  const cheapPreset = MODEL_PRESETS.find(p => p.id === 'fast_and_cheap');
  if (cheapPreset) updatePresetAssignments(cheapPreset, fastAndCheap);

  const valPreset = MODEL_PRESETS.find(p => p.id === 'best_value');
  if (valPreset) updatePresetAssignments(valPreset, bestValue);

  const qualPreset = MODEL_PRESETS.find(p => p.id === 'highest_quality');
  if (qualPreset) updatePresetAssignments(qualPreset, highestQuality);

  return MODEL_PRESETS;
}

export function checkDuplicateModels(personas: Persona[], synthesizer: Persona): {
  hasDuplicates: boolean;
  duplicates: string[];
} {
  const activeModels: string[] = [];

  personas.forEach(p => {
    if (p.enabled !== false && p.model) {
      activeModels.push(p.model.trim().toLowerCase());
    }
  });

  if (synthesizer.model) {
    activeModels.push(synthesizer.model.trim().toLowerCase());
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();

  activeModels.forEach(m => {
    if (seen.has(m)) {
      duplicates.add(m);
    } else {
      seen.add(m);
    }
  });

  return {
    hasDuplicates: duplicates.size > 0,
    duplicates: Array.from(duplicates),
  };
}

export function checkDuplicateOrganizations(personas: Persona[], synthesizer: Persona): {
  hasDuplicates: boolean;
  duplicateOrgs: string[];
} {
  const activeOrgs: string[] = [];

  personas.forEach(p => {
    if (p.enabled !== false && p.model) {
      activeOrgs.push(getAuthorOrganization(p.model));
    }
  });

  if (synthesizer.model) {
    activeOrgs.push(getAuthorOrganization(synthesizer.model));
  }

  const seen = new Set<string>();
  const duplicateOrgs = new Set<string>();

  activeOrgs.forEach(org => {
    if (seen.has(org)) {
      duplicateOrgs.add(org);
    } else {
      seen.add(org);
    }
  });

  return {
    hasDuplicates: duplicateOrgs.size > 0,
    duplicateOrgs: Array.from(duplicateOrgs),
  };
}

export function applyPreset(
  presetId: PresetId,
  currentPersonas: Persona[],
  currentSynthesizer: Persona
): { updatedPersonas: Persona[]; updatedSynthesizer: Persona } {
  // Support legacy 'fastest_cheapest' alias for 'fast_and_free'
  const targetId = presetId === 'fastest_cheapest' ? 'fast_and_free' : presetId;
  const preset = MODEL_PRESETS.find(p => p.id === targetId);

  if (!preset) return { updatedPersonas: currentPersonas, updatedSynthesizer: currentSynthesizer };

  const updatedPersonas = currentPersonas.map(p => ({
    ...p,
    model: preset.assignments[p.id]?.model || p.model,
  }));

  const updatedSynthesizer = {
    ...currentSynthesizer,
    model: preset.assignments.synthesizer?.model || currentSynthesizer.model,
  };

  return { updatedPersonas, updatedSynthesizer };
}
