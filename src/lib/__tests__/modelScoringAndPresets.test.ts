import { describe, it, expect } from 'vitest';
import {
  pickBestFromCatalog,
  pricingIsFree,
  isUsableCatalogModel,
  catalogHasFreeModels,
} from '../modelScoring';
import {
  MODEL_PRESETS,
  applyPreset,
  updatePresetsFromFetchedModels,
  presetTierFor,
} from '../presets';
import { allocateCouncilSeats } from '../serverModelAllocator';
import type { RawOpenRouterModel, Persona } from '../../types';

/** Synthetic live catalog (2026-era mix: current frontier, cheap workhorses, free tier). */
const LIVE_CATALOG: RawOpenRouterModel[] = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', created: 1759000000, context_length: 1000000, pricing: { request: '0', prompt: '0.000003', completion: '0.000015' } } as any,
  { id: 'openai/gpt-5.1', name: 'GPT-5.1', created: 1763000000, context_length: 400000, pricing: { request: '0', prompt: '0.00000125', completion: '0.00001' } } as any,
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', created: 1750000000, context_length: 1048576, pricing: { request: '0', prompt: '0.0000003', completion: '0.0000025' } } as any,
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', created: 1735000000, context_length: 128000, pricing: { request: '0', prompt: '0.00000025', completion: '0.000001' } } as any,
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra (Free)', created: 1755000000, context_length: 1000000, pricing: { request: '0', prompt: '0', completion: '0' } } as any,
  { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (Free)', created: 1755000000, context_length: 131072, pricing: { request: '0', prompt: '0', completion: '0' } } as any,
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Free)', created: 1755000000, context_length: 262144, pricing: { request: '0', prompt: '0', completion: '0' } } as any,
  { id: 'openrouter/free', name: 'Free Router', created: 1769000000, context_length: 200000, pricing: { request: '0', prompt: '0', completion: '0' } } as any,
  { id: 'openrouter/auto', name: 'Auto Router', created: 1699000000, context_length: 200000, pricing: { request: '0.0000003', prompt: '0.0000003', completion: '0.0000003' } } as any,
  { id: 'local/llama', name: 'Local Llama', created: 1700000000, context_length: 8000, pricing: { request: '0', prompt: '0', completion: '0' } } as any,
];

const NO_FREE_CATALOG: RawOpenRouterModel[] = LIVE_CATALOG.filter((m) => !m.id.endsWith(':free') && !m.id.startsWith('openrouter/'));

describe('modelScoring', () => {
  it('classifies exact-zero pricing as free only', () => {
    expect(pricingIsFree({ pricing: { request: '0', prompt: '0', completion: '0' } })).toBe(true);
    expect(pricingIsFree({ pricing: { request: '0', prompt: '0', completion: '0.0000001' } })).toBe(false);
    expect(pricingIsFree({ pricing: undefined })).toBe(false);
  });

  it('excludes routers and local models from seat candidates', () => {
    expect(isUsableCatalogModel(LIVE_CATALOG.find((m) => m.id === 'openrouter/free'))).toBe(false);
    expect(isUsableCatalogModel(LIVE_CATALOG.find((m) => m.id === 'openrouter/auto'))).toBe(false);
    expect(isUsableCatalogModel(LIVE_CATALOG.find((m) => m.id === 'local/llama'))).toBe(false);
    expect(isUsableCatalogModel(LIVE_CATALOG.find((m) => m.id === 'openai/gpt-5.1'))).toBe(true);
  });

  it('picks only zero-cost models for the free tier', () => {
    const pick = pickBestFromCatalog(LIVE_CATALOG, 'free');
    expect(pick).toBeDefined();
    expect(pick!.id.endsWith(':free')).toBe(true);
    // Routers and local models must never be seated.
    expect(pick!.id).not.toMatch(/^(openrouter|local)\//);
  });

  it('picks the cheapest usable model for the cheap tier', () => {
    const pick = pickBestFromCatalog(LIVE_CATALOG, 'cheap');
    expect(pick).toBeDefined();
    expect(pricingIsFree(pick!)).toBe(false);
  });

  it('honors usedIds to keep seats distinct', () => {
    const used = new Set(['nvidia/nemotron-3-ultra-550b-a55b:free']);
    const pick = pickBestFromCatalog(LIVE_CATALOG, 'free', undefined, used);
    expect(pick!.id.toLowerCase()).not.toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
  });

  it('returns undefined when a tier pool is empty', () => {
    expect(catalogHasFreeModels(NO_FREE_CATALOG)).toBe(false);
    expect(pickBestFromCatalog(NO_FREE_CATALOG, 'free')).toBeUndefined();
    expect(catalogHasFreeModels(LIVE_CATALOG)).toBe(true);
  });
});

describe('dynamic preset resolution', () => {
  it('maps preset ids to scoring tiers', () => {
    expect(presetTierFor('fast_and_free')).toBe('free');
    expect(presetTierFor('highest_quality')).toBe('quality');
    expect(presetTierFor('cheapest_viable')).toBe('cheap');
    expect(presetTierFor('balanced_quality')).toBe('balanced');
  });

  it('replaces vanished free models with live zero-cost catalog models', () => {
    // Snapshot the preset so the test can restore it afterwards.
    const preset = MODEL_PRESETS.find((p) => p.id === 'fast_and_free')!;
    const before = JSON.parse(JSON.stringify(preset.assignments));

    // Simulate the free models being delisted.
    Object.values(preset.assignments).forEach((a) => (a.model = 'delisted/model-x:free'));
    updatePresetsFromFetchedModels(LIVE_CATALOG);

    // Every seat must be a live catalog model (no dead ids survive).
    Object.values(preset.assignments).forEach((a) => {
      expect(LIVE_CATALOG.some((m) => m.id === a.model)).toBe(true);
    });
    // The catalog has exactly 3 free models for 4 free slots: at least the
    // 3 free seats stay free; the 4th is honestly downgraded to cheap paid.
    const freeSeatCount = Object.values(preset.assignments).filter((a) => a.model.endsWith(':free')).length;
    expect(freeSeatCount).toBe(3);
    expect(preset.freeTierAvailable).toBe(true);

    // Restore.
    preset.assignments = before;
  });

  it('honestly downgrades the free preset when no free models are live', () => {
    const preset = MODEL_PRESETS.find((p) => p.id === 'fast_and_free')!;
    const before = JSON.parse(JSON.stringify(preset));

    updatePresetsFromFetchedModels(NO_FREE_CATALOG);

    expect(preset.freeTierAvailable).toBe(false);
    Object.values(preset.assignments).forEach((a) => {
      // Downgraded seats are real catalog models and none of them are free.
      expect(NO_FREE_CATALOG.some((m) => m.id === a.model)).toBe(true);
      expect(a.isFree).toBe(false);
    });

    // Restore.
    Object.assign(preset, before);
  });

  it('reseats budget presets onto unique live labs', () => {
    const preset = MODEL_PRESETS.find((p) => p.id === 'balanced_quality')!;
    const before = JSON.parse(JSON.stringify(preset.assignments));
    updatePresetsFromFetchedModels(LIVE_CATALOG);
    const models = Object.values(preset.assignments).map((a) => a.model);
    models.forEach((id) => {
      expect(LIVE_CATALOG.some((m) => m.id === id)).toBe(true);
    });
    const labs = models.map((id) => id.split('/')[0]);
    expect(new Set(labs).size).toBe(labs.length);
    preset.assignments = before;
  });

  it('applyPreset never seats a model missing from the provided catalog', () => {
    const personas: Persona[] = [
      { id: 'skeptic', name: 'Skeptic', role: 'Critic', avatar: '🛡️', systemPrompt: '', model: 'x/y:free', color: '', enabled: true } as any,
      { id: 'visionary', name: 'Visionary', role: 'Visionary', avatar: '🔮', systemPrompt: '', model: 'x/y', color: '', enabled: true } as any,
    ];
    const synthesizer = { id: 'synthesizer', name: 'Chair', role: 'Chair', avatar: '⚖️', systemPrompt: '', model: 'x/y', color: '' } as any;

    const result = applyPreset('fast_and_free', personas, synthesizer, LIVE_CATALOG);
    [...result.updatedPersonas, result.updatedSynthesizer].forEach((p) => {
      expect(LIVE_CATALOG.some((m) => m.id === p.model)).toBe(true);
    });

    // Offline (no catalog): curated preferences are trusted.
    const offline = applyPreset('cheapest_viable', personas, synthesizer, []);
    const curated = MODEL_PRESETS.find((p) => p.id === 'cheapest_viable')!;
    expect(offline.updatedPersonas[0].model).toBe(curated.assignments['skeptic'].model);
  });
});

describe('server allocator live validation', () => {
  const personas = [
    { id: 'skeptic', name: 'Skeptic', role: 'Critic' },
    { id: 'pragmatist', name: 'Pragmatist', role: 'Engineer' },
  ];
  const synthesizer = { id: 'synthesizer', name: 'Chair', role: 'Chair' };

  it('dynamically re-resolves vanished free candidates to live free models', () => {
    const plan = allocateCouncilSeats({
      domain: 'general',
      budgetTier: 'free',
      personas,
      synthesizer,
      catalog: LIVE_CATALOG,
    });

    [...Object.values(plan.seats), plan.synthesizer].forEach((seat) => {
      const live = LIVE_CATALOG.some((m) => m.id === seat.assignedModel);
      expect(live).toBe(true);
    });
  });

  it('downgrades free seats to cheap paid models when the free tier is empty', () => {
    const plan = allocateCouncilSeats({
      domain: 'general',
      budgetTier: 'free',
      personas,
      synthesizer,
      catalog: NO_FREE_CATALOG,
    });

    [...Object.values(plan.seats), plan.synthesizer].forEach((seat) => {
      const live = NO_FREE_CATALOG.some((m) => m.id === seat.assignedModel);
      expect(live).toBe(true);
    });
  });

  it('still honors explicit human overrides', () => {
    const plan = allocateCouncilSeats({
      domain: 'general',
      budgetTier: 'quality',
      personas,
      synthesizer,
      catalog: LIVE_CATALOG,
      humanOverrides: { skeptic: 'openai/gpt-5.1' },
    });
    expect(plan.seats['skeptic'].assignedModel).toBe('openai/gpt-5.1');
    expect(plan.seats['skeptic'].source).toBe('explicit_override');
  });
});
