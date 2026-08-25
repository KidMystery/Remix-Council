/**
 * OpenRouter Auto — the honest auto-select.
 *
 * Settings personas are personalities + a family filter (the lab you parked).
 * The live model is chosen by OpenRouter's market router, not by our keyword
 * table. Free mode never uses this slug: it routes to paid models.
 *
 * Debug: the request model is always `openrouter/auto`. The card's
 * `actualModel` is whatever OpenRouter seated.
 */

import { isOpenRouterRouterId } from './modelScoring';

export const OPENROUTER_AUTO = 'openrouter/auto';
export const AUTO_ROUTER_PLUGIN = 'auto-router';

export type AutoCostTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AutoRouterPlugin {
  id: typeof AUTO_ROUTER_PLUGIN;
  allowed_models?: string[];
  excluded_models?: string[];
  cost_tier?: AutoCostTier;
}

export function isAutoRouterModel(id: string | undefined): boolean {
  const n = String(id || '').trim().toLowerCase();
  return n === OPENROUTER_AUTO || n === 'openrouter/auto-beta';
}

/** Free mode must keep seating concrete :free ids. Auto is a paid router. */
export function shouldUseOpenRouterAuto(opts: {
  autoSelect: boolean;
  budget?: string;
}): boolean {
  if (!opts.autoSelect) return false;
  return opts.budget !== 'free';
}

/** Map Chamber budget / preset tier → Auto cost band. Unset Auto defaults to `low`. */
export function costTierForBudget(budget?: string): AutoCostTier {
  if (budget === 'quality') return 'high';
  if (budget === 'balanced') return 'medium';
  if (budget === 'cheap') return 'low';
  return 'low';
}

/**
 * A parked model is a family filter, not a seat.
 * `anthropic/claude-sonnet-4.5` → `anthropic/*`
 */
export function familyFilterFromModel(modelId: string | undefined): string | null {
  const id = String(modelId || '').trim();
  if (!id || isOpenRouterRouterId(id) || isAutoRouterModel(id)) return null;
  const org = id.split('/')[0];
  if (!org || org === 'openrouter') return null;
  return `${org}/*`;
}

export function preloadPersonaFilters(
  personas: Array<{ id: string; model?: string }>,
  catalog?: Array<{ id?: string }>
): Record<string, string[]> {
  const liveOrgs = new Set(
    (catalog || [])
      .map((m) => String(m?.id || '').split('/')[0].toLowerCase())
      .filter(Boolean)
  );

  const out: Record<string, string[]> = {};
  for (const p of personas) {
    const family = familyFilterFromModel(p.model);
    if (!family) continue;
    const org = family.split('/')[0].toLowerCase();
    if (liveOrgs.size > 0 && !liveOrgs.has(org)) continue;
    out[p.id] = [family];
  }
  return out;
}

export function buildAutoRouterPlugin(opts: {
  allowedModels?: string[];
  excludedModels?: string[];
  costTier?: AutoCostTier;
}): AutoRouterPlugin {
  const plugin: AutoRouterPlugin = { id: AUTO_ROUTER_PLUGIN };
  if (opts.allowedModels && opts.allowedModels.length > 0) {
    plugin.allowed_models = [...new Set(opts.allowedModels)];
  }
  if (opts.excludedModels && opts.excludedModels.length > 0) {
    plugin.excluded_models = [...new Set(opts.excludedModels)];
  }
  if (opts.costTier) plugin.cost_tier = opts.costTier;
  return plugin;
}

/** Pull the seated model id out of an SSE tail (OpenRouter puts it on `model`). */
export function extractRoutedModelFromSSE(text: string): string | undefined {
  const matches = String(text || '').matchAll(/"model"\s*:\s*"([^"]+)"/g);
  let last: string | undefined;
  for (const m of matches) {
    const id = m[1];
    if (id && !isAutoRouterModel(id)) last = id;
  }
  return last;
}
