import type { RawOpenRouterModel } from '../types';

/**
 * Model tier used for dynamic seat allocation.
 * - free:     zero-cost models (live-verified from the catalog)
 * - cheap:    low-cost paid workhorses
 * - balanced: mid-tier mix
 * - quality:  frontier models
 */
export type ModelTier = 'free' | 'cheap' | 'balanced' | 'quality';

/** Router aliases are not real endpoint models — never seat them as candidates. */
const ROUTER_IDS = new Set([
  'openrouter/auto',
  'openrouter/auto-beta',
  'openrouter/free',
  'openrouter/validated',
]);

/** True when a (normalized, lowercase) model id is an OpenRouter router alias. */
export function isOpenRouterRouterId(id: string): boolean {
  return ROUTER_IDS.has(String(id || '').trim().toLowerCase());
}

export function parsePrice(v: unknown): number {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * True when a catalog model's pricing is EXACTLY zero across request/prompt/completion.
 * OpenRouter reports zero-cost models with exact "0" prices; any positive value
 * — even a fraction of a cent per 1M tokens — is a paid model. Models missing
 * pricing data are NOT considered free (unknown ≠ free).
 */
export function pricingIsFree(m: { pricing?: Record<string, any> } | null | undefined): boolean {
  const p = m?.pricing;
  if (!p) return false;
  return parsePrice(p.request) === 0 && parsePrice(p.prompt) === 0 && parsePrice(p.completion) === 0;
}

export function modelContextLength(m: RawOpenRouterModel): number {
  return Number(m.context_length) || Number((m as any)?.top_provider?.context_length) || 0;
}

/** Combined prompt+completion price in USD per 1M tokens. */
export function modelPricePerM(m: RawOpenRouterModel): number {
  return parsePrice(m.pricing?.prompt) + parsePrice(m.pricing?.completion);
}

/**
 * A catalog entry is a usable seat candidate only when it is a routable,
 * provider-backed model (no routers, no local/ollama ids, no malformed entries).
 */
export function isUsableCatalogModel(m: RawOpenRouterModel | null | undefined): m is RawOpenRouterModel {
  if (!m || !m.id) return false;
  const id = String(m.id).toLowerCase();
  if (isOpenRouterRouterId(id)) return false;
  if (!id.includes('/')) return false;
  if (id.startsWith('local/') || id.startsWith('ollama/') || id.startsWith('lmstudio/')) return false;
  return true;
}

/**
 * Scores a live catalog model for a given tier. Higher = better seat.
 * Signals (deliberately simple and explainable):
 *  - context window (bigger is safer for council rounds),
 *  - recency (models added in the last ~6 months are far less likely to be
 *    deprecated than ones from a year ago),
 *  - tier-appropriate cost signal (cheap = cheap; quality = strong/pricier),
 *  - same-provider bonus when replacing a vanished model (keeps UX predictable).
 */
export function scoreCandidateForTier(
  m: RawOpenRouterModel,
  tier: ModelTier,
  preferOrg?: string
): number {
  const ctxM = Math.min(modelContextLength(m) / 1_000_000, 2);
  const created = Number(m.created) || 0;
  const ageDays = (Date.now() - created * 1000) / 86_400_000;
  const recency = Number.isFinite(ageDays) && ageDays >= 0 && ageDays < 180 ? 1.5 : 0;
  const orgBonus =
    preferOrg && String(m.id).toLowerCase().startsWith(`${preferOrg}/`) ? 1.5 : 0;

  switch (tier) {
    case 'free':
      return ctxM * 3 + recency + orgBonus;
    case 'quality':
      return ctxM * 3 + Math.min(modelPricePerM(m), 30) / 5 + recency + orgBonus;
    case 'balanced':
      return ctxM * 2 + recency + orgBonus - (modelPricePerM(m) > 4 ? modelPricePerM(m) / 2 : 0);
    case 'cheap':
    default:
      return ctxM * 2 + recency + orgBonus - modelPricePerM(m) * 1.5;
  }
}

/** True when the catalog model accepts image input (per OpenRouter architecture data). */
export function modelHasVision(m: RawOpenRouterModel | null | undefined): boolean {
  if (!m) return false;
  const arch = (m as any)?.architecture;
  const inputModalities: string[] = Array.isArray(arch?.input_modalities) ? arch.input_modalities : [];
  if (inputModalities.includes('image')) return true;
  const modality: string = arch?.modality || '';
  return /image/.test(modality);
}

/**
 * Picks the best live catalog model for a tier.
 * `usedIds` excludes models already assigned to other seats (diversity).
 * `requireVision` restricts candidates to image-capable models (used when the
 * user attached an image — no point seating a model that can't see it).
 * Returns undefined when the (possibly filtered) tier pool is empty.
 */
export function pickBestFromCatalog(
  catalog: RawOpenRouterModel[],
  tier: ModelTier,
  preferOrg?: string,
  usedIds?: Iterable<string>,
  requireVision?: boolean
): RawOpenRouterModel | undefined {
  if (!Array.isArray(catalog) || catalog.length === 0) return undefined;
  const used = new Set(Array.from(usedIds || []).map((id) => String(id).toLowerCase()));

  let pool = catalog.filter(isUsableCatalogModel);
  pool = pool.filter((m) => (tier === 'free' ? pricingIsFree(m) : !pricingIsFree(m)));
  if (requireVision) {
    const visionPool = pool.filter((m) => modelHasVision(m));
    if (visionPool.length === 0) return undefined;
    pool = visionPool;
  }
  if (pool.length === 0) return undefined;

  let best: RawOpenRouterModel | undefined;
  let bestScore = -Infinity;
  for (const m of pool) {
    const id = m.id.toLowerCase();
    if (used.has(id)) continue;
    const s = scoreCandidateForTier(m, tier, preferOrg);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

/** True when the catalog contains at least one live zero-cost model. */
export function catalogHasFreeModels(catalog: RawOpenRouterModel[] | null | undefined): boolean {
  if (!Array.isArray(catalog)) return false;
  return catalog.some((m) => isUsableCatalogModel(m) && pricingIsFree(m));
}
