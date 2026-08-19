import type { RawOpenRouterModel } from '../types';

export function isFreeModel(model: RawOpenRouterModel): boolean {
  if (!model) return false;
  const promptPricing = parseFloat(String(model.pricing?.prompt ?? '1'));
  const completionPricing = parseFloat(String(model.pricing?.completion ?? '1'));
  return (
    (promptPricing === 0 && completionPricing === 0) ||
    model.id.toLowerCase().endsWith(':free')
  );
}

export function sanitizeAndResolveModel(modelId: string): string {
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('Invalid model identifier provided.');
  }
  return modelId.trim();
}
