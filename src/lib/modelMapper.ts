import type { RawOpenRouterModel } from '../types';

export interface MappedModels {
  warnings: string[];
  mapped?: Record<string, any>;
  freeModelIds?: string[];
}

const EPS = 0.000001;

/**
 * Strict exact-zero free classification.
 * Requires request, prompt, and completion prices to each be exactly 0.
 * Rejects epsilons, NaN, negative prices, missing prices, and OpenRouter router aliases.
 */
export function isFreeModel(model: RawOpenRouterModel): boolean {
  if (!model || !model.id) return false;

  const normalized = model.id.trim().toLowerCase();
  if (
    normalized === 'openrouter/auto' ||
    normalized === 'openrouter/auto-beta' ||
    normalized === 'openrouter/free'
  ) {
    return false;
  }

  const pricing = model.pricing;
  if (!pricing) return false;

  const parse = (v: any): number => {
    if (v === undefined || v === null) return NaN;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : NaN;
  };

  const request = parse(pricing.request);
  const prompt = parse(pricing.prompt);
  const completion = parse(pricing.completion);

  if (Number.isNaN(request) || Number.isNaN(prompt) || Number.isNaN(completion)) return false;

  // Exact zero: any positive value, epsilon, or negative value fails.
  return request === 0 && prompt === 0 && completion === 0;
}

/** Extracts the author organization slug from a model id (e.g. "google/gemini-2.5-flash" -> "google"). */
export function getAuthorOrganization(modelId: string): string {
  if (!modelId) return 'unknown';
  const trimmed = modelId.trim();
  const org = trimmed.split('/')[0] || 'unknown';
  return org.toLowerCase();
}

/** Strips ":free" suffixes and experimental tags to get the canonical family id. */
export function getFamily(modelId: string): string {
  if (!modelId) return '';
  let family = modelId.trim().toLowerCase();
  family = family.replace(/:free$/i, '');
  family = family.replace(/-exp$/i, '');
  return family;
}

/** Estimates the per-query cost (USD) of a model using a 2000-input / 800-output token heuristic. */
export function estimatedCost(model: RawOpenRouterModel): number {
  if (!model?.pricing) return 0;
  const parse = (v: any): number => {
    if (v === undefined || v === null) return 0;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  };
  const prompt = parse(model.pricing.prompt);
  const completion = parse(model.pricing.completion);
  return 2000 * prompt + 800 * completion;
}

/**
 * Maps a raw OpenRouter catalog into the recommendation model shape consumed
 * by the UI, producing warnings when pricing data is missing.
 */
export function mapOpenRouterModels(models: RawOpenRouterModel[]): MappedModels {
  const warnings: string[] = [];
  if (!Array.isArray(models)) {
    return { warnings: ['Catalog is not an array.'], mapped: {}, freeModelIds: [] };
  }

  const freeModelIds: string[] = [];
  const mapped: Record<string, any> = {};

  models.forEach((m) => {
    if (!m || !m.id) return;
    if (isFreeModel(m)) freeModelIds.push(m.id);
    if (!m.pricing) {
      warnings.push(`Model "${m.id}" is missing pricing data.`);
    }
    mapped[m.id] = {
      id: m.id,
      name: m.name || m.id,
      isFree: isFreeModel(m),
      cost: estimatedCost(m),
      contextLength: m.context_length || m.top_provider?.context_length || 0,
    };
  });

  return { warnings, mapped, freeModelIds };
}

/**
 * Resolves a possibly aliased or malformed model id against the catalog,
 * preferring the exact id and falling back to the first catalog match.
 */
export function sanitizeAndResolveModel(modelId: string, catalog?: RawOpenRouterModel[]): string {
  if (!modelId) return '';
  const trimmed = modelId.trim();
  if (!catalog || catalog.length === 0) return trimmed;

  const exact = catalog.find((m) => m.id.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact.id;

  const family = getFamily(trimmed);
  const familyMatch = catalog.find((m) => getFamily(m.id) === family);
  return familyMatch?.id || trimmed;
}
