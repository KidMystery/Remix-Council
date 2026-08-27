import { describe, it, expect } from 'vitest';
import { ORACLE_VOICES, pickVoice, resolveVoiceModel } from '../oracleVoices';

/**
 * Regression tests for the Auto-Rotate error storm (Aug 2026):
 *
 * Bug: with "model per voice" enabled, each turn was sent to the voice's
 * HARDCODED model id with NO live-catalog check. Delisted ids (e.g.
 * openai/gpt-4o, meta-llama/llama-3.3-70b-instruct) returned provider 404s —
 * and because turnCount only advanced on SUCCESS, every retry re-picked the
 * same dead voice model. Errors out the ying yang, and it didn't fix.
 *
 * Contract now: a voice model must be validated against the live catalog when
 * one is available. Delisted → quietly use the thread's own model for the
 * turn and SAY SO in a note. Catalog unavailable → previous behavior
 * (trust the voice model). Free-tier threads never use per-voice models.
 */

// Simulated live catalog: some classic voice models still exist, two are gone.
const LIVE_IDS = new Set([
  'deepseek/deepseek-chat',
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
]);
const isLive = (id: string) => LIVE_IDS.has(id.toLowerCase());

const THREAD_MODEL = 'anthropic/claude-fable-5';
const strategist = ORACLE_VOICES.find((v) => v.id === 'strategist')!; // openai/gpt-4o (delisted)
const visionary = ORACLE_VOICES.find((v) => v.id === 'visionary')!; // google/gemini-2.5-flash (live)

describe('pickVoice', () => {
  it('cycles deterministically through all six voices', () => {
    expect(ORACLE_VOICES.length).toBe(6);
    expect(pickVoice(0).id).toBe('skeptic');
    expect(pickVoice(5).id).toBe('teacher');
    expect(pickVoice(6).id).toBe('skeptic'); // wraps
    expect(pickVoice(13).id).toBe('visionary');
  });
});

describe('resolveVoiceModel', () => {
  const base = {
    threadModel: THREAD_MODEL,
    modelPerVoice: true,
    threadModelIsFree: false,
  };

  it('uses a LIVE voice model as-is (no note)', () => {
    const r = resolveVoiceModel(visionary, { ...base, isLive });
    expect(r.model).toBe('google/gemini-2.5-flash');
    expect(r.note).toBeUndefined();
  });

  it('DELISTED voice model → thread model + visible note (the ying-yang fix)', () => {
    const r = resolveVoiceModel(strategist, { ...base, isLive });
    expect(r.model).toBe(THREAD_MODEL);
    expect(r.note).toBeTruthy();
    expect(r.note).toMatch(/strategist/i);
    expect(r.note).toMatch(/gpt-4o/);
  });

  it('catalog offline (no isLive) → keeps legacy behavior: trust the voice model', () => {
    const r = resolveVoiceModel(strategist, base);
    expect(r.model).toBe('openai/gpt-4o');
    expect(r.note).toBeUndefined();
  });

  it('model-per-voice disabled → thread model, always', () => {
    const r = resolveVoiceModel(visionary, { ...base, modelPerVoice: false, isLive });
    expect(r.model).toBe(THREAD_MODEL);
  });

  it('free-tier thread → thread model (never upscale a free thread)', () => {
    const r = resolveVoiceModel(visionary, {
      ...base,
      threadModel: 'deepseek/deepseek-chat:free',
      threadModelIsFree: true,
      isLive,
    });
    expect(r.model).toBe('deepseek/deepseek-chat:free');
  });

  it('no voice (rotation voices off) → thread model', () => {
    const r = resolveVoiceModel(null, { ...base, isLive });
    expect(r.model).toBe(THREAD_MODEL);
  });

  it('voice without a model → thread model', () => {
    const r = resolveVoiceModel({ ...visionary, model: undefined }, { ...base, isLive });
    expect(r.model).toBe(THREAD_MODEL);
  });
});
