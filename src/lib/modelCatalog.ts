/**
 * Nexus model council — shared catalog constants + input resolution.
 *
 * A Nexus mission can run as a single-model loop (default) or as a
 * multi-model council: the caller supplies `models` either as an explicit
 * array of OpenRouter slugs or as a preset name (e.g. "auto-coding") that
 * expands to a curated cross-org list. Every entry is validated against the
 * cached OpenRouter catalog by the mission store (the same liveness guard
 * the agent loop applies at run time) so a dead id is refused up front
 * instead of failing mid-overnight.
 */

/**
 * Current-gen verified pool (swept live against the OpenRouter catalog,
 * 2026-08-31 — every id confirmed present, 395-model snapshot). One entry
 * per org, coding-stable variants preferred over experimental ones.
 */
export interface CurrentGenModel {
  id: string;
  org: string;
}

export const CURRENT_GEN_POOL: readonly CurrentGenModel[] = [
  { id: 'anthropic/claude-opus-5-fast', org: 'anthropic' },
  { id: 'openai/gpt-5.6-luna-pro', org: 'openai' },
  { id: 'google/gemini-3.7-flash', org: 'google' },
  { id: 'deepseek/deepseek-v4-pro-0813', org: 'deepseek' },
  { id: 'x-ai/grok-4.6', org: 'x-ai' },
  { id: 'qwen/qwen3.8-max', org: 'qwen' },
  { id: 'z-ai/glm-5.3-flash', org: 'z-ai' },
  { id: 'moonshotai/kimi-k3', org: 'moonshotai' },
  { id: 'meta/muse-spark-1.2-20260805', org: 'meta' },
] as const;

/** Convenience: just the slugs, pool order preserved. */
export const CURRENT_GEN_POOL_IDS: readonly string[] = CURRENT_GEN_POOL.map((m) => m.id);

/** 6-org auto-coding preset (no experimental seats). */
export const AUTO_CODING_COUNCIL = [
  'anthropic/claude-opus-5-fast',
  'openai/gpt-5.6-luna-pro',
  'google/gemini-3.7-flash',
  'deepseek/deepseek-v4-pro-0813',
  'x-ai/grok-4.6',
  'qwen/qwen3.8-max',
  'meta/muse-spark-1.2-20260805',
] as const;

/** Named presets accepted in the mission `models` field. */
export const MODEL_PRESETS: Record<string, readonly string[]> = {
  'auto-coding': AUTO_CODING_COUNCIL,
};

export const MAX_MISSION_MODELS = 8;

const MODEL_SLUG_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)?$/;

export type ModelsInputResult =
  | { models: string[] }
  | { error: string };

/**
 * Resolves the mission `models` input into a concrete array:
 *  - string preset name → preset list (unknown preset → error)
 *  - array of slugs → trimmed, capped at MAX_MISSION_MODELS
 * Catalog existence is checked separately (see validateModelsAgainstCatalog).
 */
export function expandModelsInput(raw: unknown): ModelsInputResult {
  if (raw === undefined || raw === null) return { models: [] };
  if (typeof raw === 'string') {
    const preset = MODEL_PRESETS[raw.trim()];
    if (!preset) {
      const known = Object.keys(MODEL_PRESETS).join(', ');
      return { error: `Unknown models preset "${raw}". Known presets: ${known}.` };
    }
    return { models: [...preset] };
  }
  if (!Array.isArray(raw)) {
    return { error: 'models must be an array of OpenRouter model slugs or a preset name.' };
  }
  if (raw.length === 0 || raw.length > MAX_MISSION_MODELS) {
    return { error: `models must contain between 1 and ${MAX_MISSION_MODELS} model slugs.` };
  }
  const models: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !MODEL_SLUG_RE.test(entry.trim())) {
      return { error: `Invalid model slug: ${JSON.stringify(entry ?? null)}.` };
    }
    models.push(entry.trim());
  }
  return { models };
}

/**
 * Catalog liveness guard for mission creation. When the cached catalog is
 * available, every requested model must exist in it (mirrors the agent
 * loop's run-time substitution guard, but honest at create time: 400, not a
 * silent swap). With no catalog cached, slug shape alone is enforced.
 */
export function validateModelsAgainstCatalog(models: string[], catalog: any[]): string | null {
  if (models.length === 0 || !Array.isArray(catalog) || catalog.length === 0) return null;
  const ids = new Set(catalog.map((m: any) => String(m?.id || '').toLowerCase()));
  for (const model of models) {
    if (!ids.has(model.toLowerCase())) {
      return `Model "${model}" is not in the cached OpenRouter catalog — refusing to seat a dead id.`;
    }
  }
  return null;
}
