import { describe, it, expect } from 'vitest';
import { modelHasVision, pickBestFromCatalog } from '../modelScoring';
import { allocateCouncilSeats } from '../serverModelAllocator';
import { getModelDetails } from '../modelDetails';
import type { RawOpenRouterModel } from '../../types';

const mk = (
  id: string,
  pricing: { prompt: string; completion: string },
  arch?: any,
  extra: Partial<RawOpenRouterModel> = {}
): RawOpenRouterModel =>
  ({
    id,
    name: id.split('/').pop(),
    created: 1750000000,
    context_length: 1000000,
    pricing: { request: '0', ...pricing },
    architecture: arch,
    ...extra,
  }) as any;

const GEMINI_FLASH = mk('google/gemini-2.5-flash', { prompt: '0.0000003', completion: '0.0000025' }, {
  modality: 'image+text->text',
  input_modalities: ['text', 'image'],
});
const GPT_51 = mk('openai/gpt-5.1', { prompt: '0.00000125', completion: '0.00001' }, {
  modality: 'text+image->text',
  input_modalities: ['text', 'image'],
});
const CLAUDE_TEXT = mk('anthropic/claude-sonnet-4.5', { prompt: '0.000003', completion: '0.000015' }, {
  modality: 'text->text',
  input_modalities: ['text'],
});
const DEEPSEEK_TEXT = mk('deepseek/deepseek-chat', { prompt: '0.00000025', completion: '0.000001' }, {
  modality: 'text->text',
  input_modalities: ['text'],
});
const GPT4O_MINI = mk('openai/gpt-4o-mini', { prompt: '0.00000015', completion: '0.0000006' }, {
  modality: 'text->text',
  input_modalities: ['text'],
});

describe('modelHasVision', () => {
  it('detects image input via architecture.input_modalities', () => {
    expect(modelHasVision(GEMINI_FLASH)).toBe(true);
  });

  it('detects image input via architecture.modality string', () => {
    expect(modelHasVision(mk('x/y', { prompt: '0.000001', completion: '0.000001' }, { modality: 'image+text->text' }))).toBe(true);
  });

  it('returns false for text-only models and missing data', () => {
    expect(modelHasVision(CLAUDE_TEXT)).toBe(false);
    expect(modelHasVision(mk('x/y', { prompt: '0', completion: '0' }))).toBe(false);
    expect(modelHasVision(null)).toBe(false);
    expect(modelHasVision(undefined)).toBe(false);
  });
});

describe('pickBestFromCatalog with requireVision', () => {
  const catalog = [GPT_51, GEMINI_FLASH, CLAUDE_TEXT, DEEPSEEK_TEXT];

  it('restricts candidates to vision-capable models when requested', () => {
    const best = pickBestFromCatalog(catalog, 'quality', undefined, undefined, true);
    expect(best).toBeDefined();
    expect(modelHasVision(best!)).toBe(true);
  });

  it('returns undefined when the tier pool has no vision models', () => {
    const textOnly = [CLAUDE_TEXT, DEEPSEEK_TEXT];
    expect(pickBestFromCatalog(textOnly, 'cheap', undefined, undefined, true)).toBeUndefined();
  });

  it('still allows text-only models when vision is not required', () => {
    const textOnly = [CLAUDE_TEXT, DEEPSEEK_TEXT];
    expect(pickBestFromCatalog(textOnly, 'cheap', undefined, undefined, false)).toBeDefined();
  });
});

describe('allocateCouncilSeats vision awareness', () => {
  const personas = [{ id: 'p1', name: 'Analyst', role: 'analyst' }];
  const synthesizer = { id: 'chair', name: 'Chair', role: 'synthesizer' };

  it('swaps a live text-only candidate for a live vision model when vision is required', () => {
    const catalog = [GEMINI_FLASH, DEEPSEEK_TEXT, GPT4O_MINI];
    // domain 'code' cheap → first candidate is deepseek/deepseek-chat (live, text-only)
    const plan = allocateCouncilSeats({
      domain: 'code',
      budgetTier: 'cheap',
      personas,
      synthesizer,
      humanOverrides: { chair: 'google/gemini-2.5-flash' },
      catalog,
      visionRequired: true,
    });
    expect(plan.seats.p1.assignedModel).toBe('google/gemini-2.5-flash');
    expect(plan.visionGap).toBe(false);
  });

  it('flags visionGap when no vision-capable model exists in the live catalog', () => {
    const catalog = [DEEPSEEK_TEXT, GPT4O_MINI];
    const plan = allocateCouncilSeats({
      domain: 'code',
      budgetTier: 'cheap',
      personas,
      synthesizer,
      humanOverrides: { chair: 'deepseek/deepseek-chat' },
      catalog,
      visionRequired: true,
    });
    // curated live candidate kept (no vision substitute exists) but flagged
    expect(plan.seats.p1.assignedModel).toBe('deepseek/deepseek-chat');
    expect(plan.visionGap).toBe(true);
  });

  it('keeps explicit human overrides but flags them when they cannot see images', () => {
    const catalog = [GEMINI_FLASH, DEEPSEEK_TEXT];
    const plan = allocateCouncilSeats({
      domain: 'code',
      budgetTier: 'cheap',
      personas,
      synthesizer,
      humanOverrides: { p1: 'deepseek/deepseek-chat', chair: 'google/gemini-2.5-flash' },
      catalog,
      visionRequired: true,
    });
    expect(plan.seats.p1.assignedModel).toBe('deepseek/deepseek-chat');
    expect(plan.seats.p1.source).toBe('explicit_override');
    expect(plan.visionGap).toBe(true);
  });

  it('does not change behavior when vision is not required', () => {
    const catalog = [GEMINI_FLASH, DEEPSEEK_TEXT, GPT4O_MINI];
    const plan = allocateCouncilSeats({
      domain: 'code',
      budgetTier: 'cheap',
      personas,
      synthesizer,
      catalog,
      visionRequired: false,
    });
    expect(plan.seats.p1.assignedModel).toBe('deepseek/deepseek-chat');
    expect(plan.visionGap).toBe(false);
  });
});

describe('getModelDetails health + vision (per-persona badges)', () => {
  const catalog = [GEMINI_FLASH, GPT_51];

  it('marks catalog models as Live with accurate vision data', () => {
    const d = getModelDetails('google/gemini-2.5-flash', undefined, catalog);
    expect(d.health).toBe('live');
    expect(d.hasVision).toBe(true);
  });

  it('marks unknown OpenRouter-form ids as Delisted', () => {
    const d = getModelDetails('openai/gpt-9-delisted', undefined, catalog);
    expect(d.health).toBe('delisted');
    expect(d.hasVision).toBe(null);
  });

  it('treats direct-provider ids (no slash) as unverifiable, not delisted', () => {
    const d = getModelDetails('gemini-2.5-flash', undefined, catalog);
    expect(d.health).toBe('unknown');
  });

  it('stays unknown without a live catalog', () => {
    const d = getModelDetails('google/gemini-2.5-flash', undefined, []);
    expect(d.health).toBe('unknown');
    expect(d.hasVision).toBe(null);
  });
});
