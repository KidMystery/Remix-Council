import { describe, it, expect } from 'vitest';
import {
  OPENROUTER_AUTO,
  buildAutoRouterPlugin,
  costTierForBudget,
  extractRoutedModelFromSSE,
  familyFilterFromModel,
  preloadPersonaFilters,
  shouldUseOpenRouterAuto,
} from '../autoRouter';

describe('shouldUseOpenRouterAuto', () => {
  it('is off when the operator turned auto-select off', () => {
    expect(shouldUseOpenRouterAuto({ autoSelect: false, budget: 'cheap' })).toBe(false);
  });
  it('never uses Auto on a free preset — Auto routes to paid models', () => {
    expect(shouldUseOpenRouterAuto({ autoSelect: true, budget: 'free' })).toBe(false);
  });
  it('is on for cheap/quality when auto-select is on', () => {
    expect(shouldUseOpenRouterAuto({ autoSelect: true, budget: 'cheap' })).toBe(true);
    expect(shouldUseOpenRouterAuto({ autoSelect: true, budget: 'quality' })).toBe(true);
  });
});

describe('filters from parked personalities', () => {
  it('turns a parked Claude into an Anthropic family filter', () => {
    expect(familyFilterFromModel('anthropic/claude-sonnet-4.5')).toBe('anthropic/*');
  });
  it('drops router slugs and empty ids', () => {
    expect(familyFilterFromModel(OPENROUTER_AUTO)).toBeNull();
    expect(familyFilterFromModel('')).toBeNull();
  });
  it('preloads per-persona filters and drops orgs missing from the live catalog', () => {
    const filters = preloadPersonaFilters(
      [
        { id: 'skeptic', model: 'anthropic/claude-sonnet-4.5' },
        { id: 'visionary', model: 'openai/gpt-5.1' },
        { id: 'ghost', model: 'missinglab/whatever' },
      ],
      [{ id: 'anthropic/claude-sonnet-4.5' }, { id: 'openai/gpt-5.1' }]
    );
    expect(filters.skeptic).toEqual(['anthropic/*']);
    expect(filters.visionary).toEqual(['openai/*']);
    expect(filters.ghost).toBeUndefined();
  });
});

describe('plugin + cost band', () => {
  it('maps quality → high, cheap → low', () => {
    expect(costTierForBudget('quality')).toBe('high');
    expect(costTierForBudget('cheap')).toBe('low');
  });
  it('builds the auto-router plugin the docs describe', () => {
    const plugin = buildAutoRouterPlugin({
      allowedModels: ['anthropic/*'],
      costTier: 'low',
    });
    expect(plugin.id).toBe('auto-router');
    expect(plugin.allowed_models).toEqual(['anthropic/*']);
    expect(plugin.cost_tier).toBe('low');
  });
});

describe('extractRoutedModelFromSSE', () => {
  it('returns the seated model, not the auto slug', () => {
    const tail =
      'data: {"model":"openrouter/auto","choices":[]}\n' +
      'data: {"model":"anthropic/claude-sonnet-4.5","usage":{"prompt_tokens":1}}';
    expect(extractRoutedModelFromSSE(tail)).toBe('anthropic/claude-sonnet-4.5');
  });
});
