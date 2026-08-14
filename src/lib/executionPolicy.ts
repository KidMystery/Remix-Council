/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
import type { RawOpenRouterModel } from './presets';
import { isFreeModel } from './modelMapper';

export type BudgetPolicy = 'free' | 'cheap' | 'quality';

export interface ExecutionPolicy {
  budget: BudgetPolicy;
  mode: 'quick_panel' | 'deep_council';
  maxPanelTokens: number;
  maxSynthesisTokens: number;
  enableArchivist: boolean;
  enablePeerReview: boolean;
  enableProCompare: boolean;
  requireFreeModels: boolean;
  allowProviderFallback: boolean;
}

export const FREE_POLICY: ExecutionPolicy = {
  budget: 'free',
  mode: 'quick_panel',
  maxPanelTokens: 350,
  maxSynthesisTokens: 500,
  enableArchivist: false,
  enablePeerReview: false,
  enableProCompare: false,
  requireFreeModels: true,
  allowProviderFallback: true,
};

export const DEFAULT_POLICY: ExecutionPolicy = {
  budget: 'quality',
  mode: 'deep_council',
  maxPanelTokens: 4000,
  maxSynthesisTokens: 8000,
  enableArchivist: true,
  enablePeerReview: true,
  enableProCompare: true,
  requireFreeModels: false,
  allowProviderFallback: true,
};

export function getExecutionPolicy(options: {
  budget: BudgetPolicy;
  requestedMode: 'auto' | 'quick_panel' | 'deep_council';
  query: string;
  useSingleModelForSimple?: boolean;
  attachedFiles?: { name: string; content: string }[];
}): ExecutionPolicy {
  const { budget, requestedMode, useSingleModelForSimple, query: _query, attachedFiles: _attachedFiles } = options;

  if (budget === 'free') return FREE_POLICY;

  // Single model for simple questions → quick panel, no peer review
  if (useSingleModelForSimple && requestedMode === 'quick_panel') {
    return {
      budget,
      mode: 'quick_panel',
      maxPanelTokens: 350,
      maxSynthesisTokens: 450,
      enableArchivist: false,
      enablePeerReview: false,
      enableProCompare: false,
      requireFreeModels: false,
      allowProviderFallback: true,
    };
  }

  return DEFAULT_POLICY;
}

export function isFreeModelId(modelId: string, catalog?: RawOpenRouterModel[]): boolean {
  if (!modelId) return false;
  const normalized = modelId.trim().toLowerCase();
  if (normalized === 'openrouter/free' || normalized === 'openrouter/auto') return false;

  const catalogModel = catalog?.find((m) => m.id.toLowerCase() === normalized);
  if (catalogModel) return isFreeModel(catalogModel);

  return (
    normalized.endsWith(':free') ||
    normalized.includes(':free') ||
    normalized.includes('gemma') ||
    normalized.includes('nemotron') ||
    normalized.includes('laguna') ||
    normalized.includes('ling') ||
    normalized.includes('qwen-2.5-coder-32b-instruct')
  );
}

export function assertPolicyModel(
  modelId: string,
  policy: ExecutionPolicy,
  catalog?: RawOpenRouterModel[]
): void {
  if (policy.requireFreeModels && !isFreeModelId(modelId, catalog)) {
    throw new Error(`Free policy violation: "${modelId}" is not a verified free model.`);
  }
}
