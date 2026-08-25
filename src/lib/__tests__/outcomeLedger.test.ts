import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadOutcomeLedger,
  trackOutcome,
  setTrackedOutcome,
  untrackOutcome,
  getTrackedOutcome,
  buildLedgerStats,
  describeStat,
  classifyOutcomeDomain,
  MIN_RESOLVED_FOR_RATIO,
} from '../outcomeLedger';
import type { TrackedOutcome } from '../outcomeLedger';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

beforeEach(() => installLocalStorageMock());
afterEach(() => delete (globalThis as any).localStorage);

const entry = (id: string, overrides: Partial<TrackedOutcome> = {}): TrackedOutcome => ({
  id,
  query: 'Which construction estimate should I take?',
  domain: 'finance',
  recordedAt: 1,
  outcome: 'worked',
  personas: [{ id: 'pragmatist', name: 'Pragmatist', model: 'google/gemini-2.5-flash' }],
  models: ['google/gemini-2.5-flash', 'openai/gpt-5.1'],
  ...overrides,
});

describe('outcome tracking lifecycle', () => {
  it('tracks a round as pending, then records outcomes', () => {
    trackOutcome({
      id: 'round-1',
      query: 'Compare these two roof estimates',
      domain: 'finance',
      personas: [{ id: 'pragmatist', name: 'Pragmatist', model: 'google/gemini-2.5-flash' }],
      models: ['google/gemini-2.5-flash'],
    });
    expect(getTrackedOutcome('round-1')?.outcome).toBe('pending');

    setTrackedOutcome('round-1', 'worked');
    const tracked = getTrackedOutcome('round-1')!;
    expect(tracked.outcome).toBe('worked');
    expect(tracked.outcomeAt).toBeGreaterThan(0);
  });

  it('re-tracking a round replaces the previous entry instead of duplicating', () => {
    trackOutcome({ id: 'r', query: 'q', domain: 'general', personas: [], models: [] });
    trackOutcome({ id: 'r', query: 'q2', domain: 'general', personas: [], models: [] });
    expect(loadOutcomeLedger().filter((e) => e.id === 'r')).toHaveLength(1);
    expect(loadOutcomeLedger()[0].query).toBe('q2');
  });

  it('untracks a round', () => {
    trackOutcome({ id: 'r', query: 'q', domain: 'general', personas: [], models: [] });
    untrackOutcome('r');
    expect(loadOutcomeLedger()).toEqual([]);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('council_outcome_ledger_v1', '{oops');
    expect(loadOutcomeLedger()).toEqual([]);
  });
});

describe('buildLedgerStats', () => {
  it('aggregates per persona, per model, and per domain (worked/didnt only)', () => {
    const ledger = [
      entry('a', { outcome: 'worked', domain: 'finance' }),
      entry('b', { outcome: 'worked', domain: 'finance' }),
      entry('c', { outcome: 'didnt', domain: 'code', personas: [{ id: 'pragmatist', name: 'Pragmatist' }] }),
      entry('d', { outcome: 'ignored', domain: 'finance' }),
      entry('e', { outcome: 'pending', domain: 'finance' }),
    ];
    const stats = buildLedgerStats(ledger);
    expect(stats.total).toEqual({ tracked: 5, resolved: 3, correct: 2, wrong: 1 });
    expect(stats.byPersona['pragmatist']).toEqual({
      tracked: 5,
      resolved: 3,
      correct: 2,
      wrong: 1,
      name: 'Pragmatist',
    });
    expect(stats.byModel['google/gemini-2.5-flash'].tracked).toBe(5);
    expect(stats.byModel['openai/gpt-5.1'].tracked).toBe(5);
    expect(stats.byDomain['finance'].tracked).toBe(4);
    expect(stats.byDomain['code'].tracked).toBe(1);
  });
});

describe('describeStat (honest reporting)', () => {
  it('reports empty rows', () => {
    expect(describeStat(undefined)).toBe('no tracked verdicts yet');
    expect(describeStat({ tracked: 0, resolved: 0, correct: 0, wrong: 0 })).toBe(
      'no tracked verdicts yet'
    );
  });

  it('admits it is gathering evidence below the ratio threshold', () => {
    const row = { tracked: 2, resolved: 2, correct: 2, wrong: 0 };
    expect(describeStat(row)).toContain('gathering evidence');
    expect(describeStat(row)).not.toContain('%');
  });

  it('shows a ratio only once enough outcomes are resolved', () => {
    expect(MIN_RESOLVED_FOR_RATIO).toBe(3);
    const row = { tracked: 4, resolved: 3, correct: 2, wrong: 1 };
    expect(describeStat(row)).toContain('2/3 right (67%)');
  });
});

describe('classifyOutcomeDomain', () => {
  it('reuses the Chamber task-domain classifier', () => {
    expect(classifyOutcomeDomain('Compare these two roof estimates and the pricing')).toBe('finance');
    expect(classifyOutcomeDomain('Debug this React render loop')).toBe('code');
    expect(classifyOutcomeDomain('Write a poem about rain')).toBe('creative');
    expect(classifyOutcomeDomain('What should I cook tonight')).toBe('general');
  });

  it('never throws', () => {
    expect(classifyOutcomeDomain('')).toBe('general');
    expect(classifyOutcomeDomain(undefined as any)).toBe('general');
  });
});
