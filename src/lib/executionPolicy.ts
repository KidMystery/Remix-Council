import type { RawOpenRouterModel } from '../types';

export type BudgetPolicy = 'free' | 'cheap' | 'quality';

export interface ExecutionPolicy {
  budget: BudgetPolicy;
  allowProviderFallback: boolean;
  maxOutputTokens: number;
}

/**
 * Free-tier policy. Note: free models are verified against the live catalog at
 * run time; when the catalog has no zero-cost models the round is surfaced as
 * an honest cheap-tier substitute instead of silently failing.
 */
export const FREE_POLICY: ExecutionPolicy = {
  budget: 'free',
  allowProviderFallback: false,
  maxOutputTokens: 1500,
};

export const DEFAULT_POLICY: ExecutionPolicy = {
  budget: 'quality',
  allowProviderFallback: true,
  maxOutputTokens: 4000,
};

export function policyForPreset(presetId: string): ExecutionPolicy {
  if (
    presetId === 'fast_and_free' ||
    presetId === 'fastest_cheapest'
  ) {
    return FREE_POLICY;
  }
  return DEFAULT_POLICY;
}

export function isFreeModelId(
  modelId: string,
  catalog?: any[]
): boolean {
  if (!modelId) return false;

  const n = modelId.trim().toLowerCase();

  // openrouter/free is a structurally free-safe router: OpenRouter only
  // routes it to zero-cost models, so it satisfies the free budget even
  // though it has no pricing of its own. openrouter/auto may route to paid
  // models and stays excluded.
  if (n === 'openrouter/free') return true;
  if (n === 'openrouter/auto') return false;

  const found = catalog?.find(
    (m) => m?.id?.toLowerCase() === n
  );

  if (found?.pricing) {
    // Strict zero: OpenRouter reports free models with exact "0" prices.
    // Any positive value (even fractions of a cent per 1M tokens) is paid,
    // and missing pricing fields are not treated as free (unknown ≠ free).
    const fields = [found.pricing.request, found.pricing.prompt, found.pricing.completion];
    if (fields.some((v) => v === undefined || v === null)) return n.endsWith(':free');
    const parse = (v: any) => parseFloat(String(v));
    const ok = (v: any) => Number.isFinite(parse(v));
    return (
      ok(found.pricing.request) &&
      ok(found.pricing.prompt) &&
      ok(found.pricing.completion) &&
      parse(found.pricing.request) === 0 &&
      parse(found.pricing.prompt) === 0 &&
      parse(found.pricing.completion) === 0
    );
  }

  return n.endsWith(':free');
}

export function assertPolicyModel(
  modelId: string,
  policy: ExecutionPolicy,
  catalog?: any[]
): void {
  if (
    policy.budget === 'free' &&
    !isFreeModelId(modelId, catalog)
  ) {
    throw new Error(
      `Free policy violation: "${modelId}" is not a verified free model.`
    );
  }
}

export type { RawOpenRouterModel };
