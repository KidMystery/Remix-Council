import { describe, it, expect } from 'vitest';
import {
  shouldAutoCreateInitialSession,
  reconcileFreePresetWithModels,
  FREE_TIER_PRESET_IDS,
  PAID_FALLBACK_PRESET_ID,
} from '../chamberGuards';

const PAID_CATALOG = [
  { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'openai/gpt-5.1', pricing: { prompt: '0.00000125', completion: '0.00001' } },
  { id: 'deepseek/deepseek-v4-flash-0731:free', pricing: { prompt: '0', completion: '0' } },
];

describe('shouldAutoCreateInitialSession (blank-thread race guard)', () => {
  it('never auto-creates while the session manager is still loading', () => {
    expect(
      shouldAutoCreateInitialSession({ isLoading: true, sessionCount: 0, hasActiveSessionId: false })
    ).toBe(false);
  });

  it('creates only after loading, with no sessions and no active id', () => {
    expect(
      shouldAutoCreateInitialSession({ isLoading: false, sessionCount: 0, hasActiveSessionId: false })
    ).toBe(true);
  });

  it('never creates when sessions already exist', () => {
    expect(
      shouldAutoCreateInitialSession({ isLoading: false, sessionCount: 3, hasActiveSessionId: false })
    ).toBe(false);
    expect(
      shouldAutoCreateInitialSession({ isLoading: false, sessionCount: 1, hasActiveSessionId: true })
    ).toBe(false);
  });
});

describe('reconcileFreePresetWithModels (manual picks win)', () => {
  it('leaves free mode when a hand-picked model is paid', () => {
    const result = reconcileFreePresetWithModels({
      activePresetId: 'fast_and_free',
      personaModels: ['google/gemini-2.5-flash'],
      catalog: PAID_CATALOG,
    });
    expect(result.switchToPresetId).toBe(PAID_FALLBACK_PRESET_ID);
    expect(result.reason).toContain('Balanced Quality');
  });

  it('stays in free mode when every model is verified zero-cost', () => {
    const result = reconcileFreePresetWithModels({
      activePresetId: 'fast_and_free',
      personaModels: ['deepseek/deepseek-v4-flash-0731:free'],
      synthesizerModel: 'deepseek/deepseek-v4-flash-0731:free',
      catalog: PAID_CATALOG,
    });
    expect(result.switchToPresetId).toBeNull();
  });

  it('treats the openrouter/free router as free-safe', () => {
    const result = reconcileFreePresetWithModels({
      activePresetId: 'fast_and_free',
      personaModels: ['openrouter/free'],
      catalog: PAID_CATALOG,
    });
    expect(result.switchToPresetId).toBeNull();
  });

  it('never switches for paid presets', () => {
    const result = reconcileFreePresetWithModels({
      activePresetId: 'highest_quality',
      personaModels: ['google/gemini-2.5-flash'],
      catalog: PAID_CATALOG,
    });
    expect(result.switchToPresetId).toBeNull();
  });

  it('never switches without a catalog (unknown ≠ paid)', () => {
    const result = reconcileFreePresetWithModels({
      activePresetId: 'fast_and_free',
      personaModels: ['google/gemini-2.5-flash'],
      catalog: [],
    });
    expect(result.switchToPresetId).toBeNull();
  });

  it('ignores empty model slots', () => {
    const result = reconcileFreePresetWithModels({
      activePresetId: 'fast_and_free',
      personaModels: [undefined, '', '  '],
      synthesizerModel: '',
      catalog: PAID_CATALOG,
    });
    expect(result.switchToPresetId).toBeNull();
  });

  it('does not undo a preset the owner just applied', () => {
    const result = reconcileFreePresetWithModels({
      activePresetId: 'fast_and_free',
      personaModels: ['google/gemini-2.5-flash'],
      catalog: PAID_CATALOG,
      presetJustAppliedUntil: Date.now() + 60_000,
    });
    expect(result.switchToPresetId).toBeNull();
  });

  it('covers both free-tier preset ids', () => {
    expect(FREE_TIER_PRESET_IDS.has('fast_and_free')).toBe(true);
    expect(FREE_TIER_PRESET_IDS.has('fastest_cheapest')).toBe(true);
    expect(FREE_TIER_PRESET_IDS.has('balanced_quality')).toBe(false);
  });
});
