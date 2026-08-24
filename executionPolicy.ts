import type { RawOpenRouterModel } from '../types';

export type BudgetPolicy = 'free' | 'cheap' | 'quality';

export interface ExecutionPolicy {
  budget: BudgetPolicy;
  allowProviderFallback: boolean;
  maxOutputTokens: number;
}

export const FREE_POLICY: ExecutionPolicy = {
  budget: 'free',
  allowProviderFallback: false,
  maxOutputTokens: 700,
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

  if (
    n === 'openrouter/free' ||
    n === 'openrouter/auto'
  ) {
    return false;
  }

  const found = catalog?.find(
    (m) => m?.id?.toLowerCase() === n
  );

  if (found?.pricing) {
    const parse = (v: any) => parseFloat(String(v || '0'));
    const EPS = 0.000001;
    return (
      parse(found.pricing.request) <= EPS &&
      parse(found.pricing.prompt) <= EPS &&
      parse(found.pricing.completion) <= EPS
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
