import { describe, it, expect } from 'vitest';
import {
  allocateChamberLabs,
  autoFiltersFromPlan,
  seatCouncilRoster,
  seatPickPriority,
  labsAreUnique,
} from '../chamberLabs';
import { applyPreset, updatePresetsFromFetchedModels, MODEL_PRESETS } from '../presets';
import { BUILTIN_COUNCIL_PRESETS } from '../councilPresets';
import type { Persona, RawOpenRouterModel } from '../../types';

function model(
  id: string,
  opts: { free?: boolean; created?: number; ctx?: number; prompt?: string } = {}
): RawOpenRouterModel {
  const prompt = opts.free ? '0' : opts.prompt || '0.000002';
  const completion = opts.free ? '0' : '0.000008';
  return {
    id,
    name: id,
    created: opts.created ?? 1760000000,
    context_length: opts.ctx ?? 200000,
    pricing: { request: '0', prompt, completion },
  } as any;
}

const MIXED_CATALOG: RawOpenRouterModel[] = [
  model('anthropic/claude-sonnet-4.5', { prompt: '0.000003', ctx: 1000000 }),
  model('openai/gpt-5.1', { prompt: '0.00000125', ctx: 400000 }),
  model('google/gemini-2.5-pro', { prompt: '0.00000125', ctx: 1000000 }),
  model('qwen/qwen3-max', { prompt: '0.0000016', ctx: 262144 }),
  model('meta-llama/llama-4-maverick', { prompt: '0.0000002', ctx: 1000000 }),
  model('deepseek/deepseek-chat', { prompt: '0.00000025', ctx: 128000 }),
  model('nvidia/nemotron-3-ultra-550b-a55b:free', { free: true, ctx: 1000000 }),
  model('openai/gpt-oss-120b:free', { free: true }),
  model('qwen/qwen3-next-80b-a3b-instruct:free', { free: true }),
  model('openrouter/auto', { prompt: '0.0000003' }),
];

const FOUR_SEATS = [
  {
    id: 'skeptic',
    name: 'The Skeptic',
    role: 'Risk & Vulnerability Auditor',
    systemPrompt: 'stress-test security',
  },
  {
    id: 'visionary',
    name: 'The Visionary',
    role: 'Innovation & Horizon Strategist',
    systemPrompt: 'creative horizon',
  },
  {
    id: 'pragmatist',
    name: 'The Pragmatist',
    role: 'Execution & Feasibility Lead',
    systemPrompt: 'cash and practical execution',
  },
  {
    id: 'synthesizer',
    name: 'The Chair',
    role: 'Consensus Builder',
    systemPrompt: 'synthesize',
  },
];

describe('allocateChamberLabs', () => {
  it('gives N enabled seats N distinct labs from the live catalog', () => {
    const plan = allocateChamberLabs({
      seats: FOUR_SEATS,
      catalog: MIXED_CATALOG,
      budget: 'quality',
      chairId: 'synthesizer',
    });
    expect(plan.uniqueness).toBe('lab');
    expect(plan.toast).toBeUndefined();
    const labs = Object.values(plan.seats).map((s) => s.lab);
    expect(labs).toHaveLength(4);
    expect(new Set(labs).size).toBe(4);
    expect(labs).not.toContain('openrouter');
    Object.values(plan.seats).forEach((s) => {
      expect(s.familyFilter).toBe(`${s.lab}/*`);
      expect(MIXED_CATALOG.some((m) => m.id === s.representativeModel)).toBe(true);
    });
  });

  it('does not reserve a brand — security-ish first pick takes the best leftover lab', () => {
    const qwenLeads: RawOpenRouterModel[] = [
      model('qwen/qwen3-max', { prompt: '0.00002', ctx: 2000000 }),
      model('anthropic/claude-sonnet-4.5', { prompt: '0.000003', ctx: 200000 }),
      model('openai/gpt-5.1', { prompt: '0.000001', ctx: 200000 }),
      model('google/gemini-2.5-pro', { prompt: '0.000001', ctx: 200000 }),
    ];
    const plan = allocateChamberLabs({
      seats: FOUR_SEATS,
      catalog: qwenLeads,
      budget: 'quality',
      chairId: 'synthesizer',
    });
    expect(plan.seats.skeptic.lab).toBe('qwen');
    expect(seatPickPriority(FOUR_SEATS[0], 'synthesizer')).toBeLessThan(
      seatPickPriority(FOUR_SEATS[3], 'synthesizer')
    );
  });

  it('can seat Qwen and Meta when they are live', () => {
    const qwenOnly: RawOpenRouterModel[] = [
      model('qwen/qwen3-max', { prompt: '0.00001', ctx: 1000000 }),
      model('meta-llama/llama-4-maverick', { prompt: '0.000009', ctx: 1000000 }),
      model('deepseek/deepseek-chat', { prompt: '0.000008', ctx: 1000000 }),
      model('google/gemini-2.5-flash', { prompt: '0.000007', ctx: 1000000 }),
    ];
    const plan = allocateChamberLabs({
      seats: FOUR_SEATS,
      catalog: qwenOnly,
      budget: 'quality',
      chairId: 'synthesizer',
    });
    const labs = new Set(Object.values(plan.seats).map((s) => s.lab));
    expect(labs.has('qwen')).toBe(true);
    expect(labs.has('meta-llama')).toBe(true);
    expect(plan.uniqueness).toBe('lab');
  });

  it('includes the Chair in uniqueness', () => {
    const plan = allocateChamberLabs({
      seats: FOUR_SEATS,
      catalog: MIXED_CATALOG,
      budget: 'quality',
      chairId: 'synthesizer',
    });
    const panelLabs = ['skeptic', 'visionary', 'pragmatist'].map((id) => plan.seats[id].lab);
    expect(panelLabs).not.toContain(plan.seats.synthesizer.lab);
  });

  it('toasts and still runs when the catalog is thinner than the panel', () => {
    const thin = [
      model('qwen/qwen3-max'),
      model('qwen/qwen3-plus', { prompt: '0.000001' }),
      model('qwen/qwen2.5-72b', { prompt: '0.0000005' }),
    ];
    const plan = allocateChamberLabs({
      seats: FOUR_SEATS,
      catalog: thin,
      budget: 'quality',
      chairId: 'synthesizer',
    });
    expect(plan.uniqueness).not.toBe('lab');
    expect(plan.toast).toMatch(/thin/i);
    expect(Object.keys(plan.seats)).toHaveLength(4);
  });

  it('honors a locked human override without stealing that lab from uniqueness', () => {
    const plan = allocateChamberLabs({
      seats: FOUR_SEATS,
      catalog: MIXED_CATALOG,
      budget: 'quality',
      chairId: 'synthesizer',
      lockedIds: { skeptic: 'qwen/qwen3-max' },
    });
    expect(plan.seats.skeptic.representativeModel).toBe('qwen/qwen3-max');
    expect(plan.seats.skeptic.lab).toBe('qwen');
    const others = ['visionary', 'pragmatist', 'synthesizer'].map((id) => plan.seats[id].lab);
    expect(others).not.toContain('qwen');
  });

  it('keeps parked models when the catalog is empty (offline)', () => {
    const parked = FOUR_SEATS.map((s, i) => ({ ...s, model: `parked/model-${i}` }));
    const plan = allocateChamberLabs({
      seats: parked,
      catalog: [],
      budget: 'quality',
      chairId: 'synthesizer',
    });
    expect(plan.seats.skeptic.representativeModel).toBe('parked/model-0');
    expect(plan.toast).toBeUndefined();
  });

  it('builds Auto family filters from the plan', () => {
    const plan = allocateChamberLabs({
      seats: FOUR_SEATS,
      catalog: MIXED_CATALOG,
      budget: 'quality',
      chairId: 'synthesizer',
    });
    const filters = autoFiltersFromPlan(plan);
    expect(Object.keys(filters)).toHaveLength(4);
    Object.values(filters).forEach((f) => {
      expect(f[0]).toMatch(/\/\*$/);
    });
  });
});

describe('seatCouncilRoster + saved councils', () => {
  const personas: Persona[] = [
    {
      id: 'skeptic',
      name: 'Skeptic',
      role: 'Risk Auditor',
      avatar: '',
      systemPrompt: 'audit',
      model: 'anthropic/claude-sonnet-4.5',
      color: '',
      enabled: true,
    },
    {
      id: 'visionary',
      name: 'Visionary',
      role: 'Horizon Strategist',
      avatar: '',
      systemPrompt: 'vision',
      model: 'openai/gpt-5.1',
      color: '',
      enabled: true,
    },
    {
      id: 'pragmatist',
      name: 'Pragmatist',
      role: 'Execution Lead',
      avatar: '',
      systemPrompt: 'do it',
      model: 'google/gemini-2.5-pro',
      color: '',
      enabled: true,
    },
  ];
  const chair: Persona = {
    id: 'synthesizer',
    name: 'Chair',
    role: 'Consensus Builder',
    avatar: '',
    systemPrompt: '',
    model: 'deepseek/deepseek-r1',
    color: '',
  };

  it('rewrites a baked Big Four snapshot onto unique live labs', () => {
    const seated = seatCouncilRoster({
      personas,
      synthesizer: chair,
      catalog: MIXED_CATALOG,
      budget: 'quality',
    });
    const models = [...seated.updatedPersonas.map((p) => p.model), seated.updatedSynthesizer.model];
    expect(labsAreUnique(models)).toBe(true);
    models.forEach((m) => expect(MIXED_CATALOG.some((c) => c.id === m)).toBe(true));
  });

  it('applyPreset with Auto on ignores frozen Highest Quality ids', () => {
    const result = applyPreset('highest_quality', personas, chair, MIXED_CATALOG, { autoSelect: true });
    const models = [...result.updatedPersonas.map((p) => p.model), result.updatedSynthesizer.model];
    expect(labsAreUnique(models)).toBe(true);
  });

  it('applyPreset with Auto off keeps the curated snapshot when those ids are live', () => {
    const result = applyPreset('highest_quality', personas, chair, MIXED_CATALOG, { autoSelect: false });
    expect(result.updatedPersonas.find((p) => p.id === 'skeptic')?.model).toBe(
      MODEL_PRESETS.find((p) => p.id === 'highest_quality')!.assignments.skeptic.model
    );
  });

  it('refreshes builtin council presets onto unique labs', () => {
    const snapshot = JSON.parse(JSON.stringify(BUILTIN_COUNCIL_PRESETS));
    const presetSnapshot = JSON.parse(JSON.stringify(MODEL_PRESETS.map((p) => p.assignments)));
    updatePresetsFromFetchedModels(MIXED_CATALOG);
    const after = BUILTIN_COUNCIL_PRESETS.find((p) => p.id === 'finance_council')!;
    const models = [...after.personas.map((p) => p.model), after.synthesizer.model];
    expect(labsAreUnique(models)).toBe(true);
    BUILTIN_COUNCIL_PRESETS.forEach((p, i) => {
      p.personas = snapshot[i].personas;
      p.synthesizer = snapshot[i].synthesizer;
    });
    MODEL_PRESETS.forEach((p, i) => {
      p.assignments = presetSnapshot[i];
    });
  });
});
