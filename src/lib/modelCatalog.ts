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

/** Verified-live 4-org council (anthropic / openai / google / deepseek). */
export const NEXUS_MODEL_COUNCIL = [
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-5.1-codex-max',
  'google/gemini-2.5-pro',
  'deepseek/deepseek-v3.2',
] as const;

/** Named presets accepted in the mission `models` field. */
export const MODEL_PRESETS: Record<string, readonly string[]> = {
  'auto-coding': NEXUS_MODEL_COUNCIL,
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
