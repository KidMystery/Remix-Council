import type { RawOpenRouterModel } from './presets';
import { isFreeModel } from './modelMapper';

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

export function policyForPreset(
  presetId: string
): ExecutionPolicy {
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
  catalog?: RawOpenRouterModel[]
): boolean {
  if (!modelId) return false;

  const normalized = modelId.trim().toLowerCase();

  if (
    normalized === 'openrouter/free' ||
    normalized === 'openrouter/auto'
  ) {
    return false;
  }

  const catalogModel = catalog?.find(
    (m) => m.id.toLowerCase() === normalized
  );

  if (catalogModel) {
    return isFreeModel(catalogModel);
  }

  return normalized.endsWith(':free');
}

export function assertPolicyModel(
  modelId: string,
  policy: ExecutionPolicy,
  catalog?: RawOpenRouterModel[]
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
