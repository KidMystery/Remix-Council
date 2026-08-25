import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractSignificantWords,
  isBriefingWorthyMessage,
  detectBriefingCandidates,
  filterBriefingCandidates,
  dismissBriefingTopic,
  recordBriefingConvened,
  updateBriefingSettings,
  loadBriefingStore,
  DEFAULT_BRIEFING_SETTINGS,
} from '../briefingDetector';
import type { OracleThread } from '../oracleStore';

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

const NOW = 1_800_000_000_000; // fixed clock

function thread(id: string, messages: Array<{ text: string; at: number }>): OracleThread {
  return {
    id,
    title: id,
    createdAt: NOW - 100000,
    updatedAt: NOW,
    model: 'google/gemini-2.5-flash',
    mode: 'direct',
    reflectEnabled: true,
    webEnabled: true,
    rotateVoices: true,
    rotateVoiceModels: false,
    turnCount: 0,
    messages: messages.map((m, i) => ({
      id: `${id}_m${i}`,
      role: 'user' as const,
      content: m.text,
      timestamp: m.at,
    })),
    bible: { content: '', updatedAt: NOW },
  };
}

describe('extractSignificantWords', () => {
  it('lowercases, strips stopwords, punctuation, and numeric-only tokens', () => {
    const words = extractSignificantWords(
      'Should I replace the ROOF now, or wait until 2026?'
    );
    expect(words).toEqual(expect.arrayContaining(['roof', 'replace', 'wait', 'now']));
    expect(words).not.toEqual(expect.arrayContaining(['the', 'should', 'or', 'until', '2026']));
  });
});

describe('isBriefingWorthyMessage', () => {
  it('accepts decision/lookup questions of reasonable length', () => {
    expect(isBriefingWorthyMessage('Which contractor quote should I take for the roof?')).toBe(true);
    expect(isBriefingWorthyMessage('Compare these two estimates for the siding job.')).toBe(true);
    expect(isBriefingWorthyMessage('How much should replacing a deck cost?')).toBe(true);
  });

  it('rejects chatter, short messages, and long pastes', () => {
    expect(isBriefingWorthyMessage('ok cool')).toBe(false);
    expect(isBriefingWorthyMessage('Had a nice walk today, weather was great')).toBe(false);
    expect(isBriefingWorthyMessage('?')).toBe(false);
    expect(isBriefingWorthyMessage('x'.repeat(600) + '?')).toBe(false);
  });
});

describe('detectBriefingCandidates', () => {
  it('clusters the same circled question across threads', () => {
    const threads = [
      thread('t1', [
        { text: 'Which contractor quote should I take for the roof replacement?', at: NOW - 50000 },
        { text: 'Is $14k a fair roof replacement estimate in New Jersey?', at: NOW - 40000 },
      ]),
      thread('t2', [
        { text: 'Compare these two roof estimates for me please.', at: NOW - 30000 },
      ]),
      thread('t3', [
        { text: 'What do you think about this deck stain color?', at: NOW - 20000 },
      ]),
    ];
    const candidates = detectBriefingCandidates(threads, { minMentions: 3, lookbackDays: 14, now: NOW });
    expect(candidates.length).toBe(1);
    expect(candidates[0].threads).toBe(2);
    expect(candidates[0].mentions).toBe(3);
    expect(candidates[0].label).toContain('roof');
    expect(candidates[0].sample).toContain('Compare these two roof estimates');
  });

  it('requires mentions in at least two distinct threads', () => {
    const threads = [
      thread('t1', [
        { text: 'Which generator should I buy for the house?', at: NOW - 50000 },
        { text: 'Is the Honda generator worth the extra cost?', at: NOW - 40000 },
        { text: 'Compare generator brands for me again.', at: NOW - 30000 },
      ]),
    ];
    const candidates = detectBriefingCandidates(threads, { minMentions: 3, lookbackDays: 14, now: NOW });
    expect(candidates).toEqual([]);
  });

  it('never convenes a council for personal topics', () => {
    const threads = [
      thread('t1', [
        { text: 'Should my son play football this fall or stick with soccer?', at: NOW - 50000 },
        { text: 'Which is better for my son, football or swimming?', at: NOW - 40000 },
      ]),
      thread('t2', [
        { text: 'Should my son try out for the travel soccer team?', at: NOW - 30000 },
      ]),
    ];
    const candidates = detectBriefingCandidates(threads, { minMentions: 3, lookbackDays: 14, now: NOW });
    expect(candidates).toEqual([]);
  });

  it('respects the lookback window', () => {
    const old = NOW - 30 * 86_400_000;
    const threads = [
      thread('t1', [
        { text: 'Which contractor quote should I take for the roof?', at: old - 1000 },
        { text: 'Is $14k a fair roof estimate?', at: old },
      ]),
      thread('t2', [{ text: 'Compare these roof estimates please.', at: old + 1000 }]),
    ];
    expect(detectBriefingCandidates(threads, { minMentions: 3, lookbackDays: 14, now: NOW })).toEqual([]);
    expect(
      detectBriefingCandidates(threads, { minMentions: 3, lookbackDays: 45, now: NOW }).length
    ).toBe(1);
  });

  it('respects the mention threshold', () => {
    const threads = [
      thread('t1', [{ text: 'Which roof quote should I take?', at: NOW - 1000 }]),
      thread('t2', [{ text: 'Compare these two roof estimates.', at: NOW }]),
    ];
    expect(detectBriefingCandidates(threads, { minMentions: 3, lookbackDays: 14, now: NOW })).toEqual([]);
    expect(detectBriefingCandidates(threads, { minMentions: 2, lookbackDays: 14, now: NOW }).length).toBe(1);
  });
});

describe('filterBriefingCandidates (owner preferences)', () => {
  const candidate = {
    key: 'roof+estimate+contractor',
    label: 'roof estimate contractor',
    mentions: 3,
    threads: 2,
    newestAt: NOW,
    sample: 'Compare these two roof estimates.',
  };

  it('returns nothing when suggestions are disabled', () => {
    const store = loadBriefingStore();
    store.settings.enabled = false;
    expect(filterBriefingCandidates([candidate], store)).toEqual([]);
  });

  it('keeps quiet after dismissal, but re-suggests on a NEW mention', () => {
    const pastCandidate = { ...candidate, newestAt: Date.now() - 1000 };
    dismissBriefingTopic(candidate.key);
    let store = loadBriefingStore();
    expect(filterBriefingCandidates([pastCandidate], store)).toEqual([]);

    const newer = { ...candidate, newestAt: Date.now() + 60000 };
    store = loadBriefingStore();
    expect(filterBriefingCandidates([newer], store)).toEqual([newer]);
  });

  it('never re-suggests a convened topic', () => {
    recordBriefingConvened(candidate.key);
    const store = loadBriefingStore();
    expect(filterBriefingCandidates([candidate], store)).toEqual([]);
  });
});

describe('briefing store persistence', () => {
  it('round-trips settings and records through localStorage', () => {
    updateBriefingSettings({ minMentions: 4, lookbackDays: 7 });
    dismissBriefingTopic('topic-a');
    recordBriefingConvened('topic-b');

    const store = loadBriefingStore();
    expect(store.settings.minMentions).toBe(4);
    expect(store.settings.lookbackDays).toBe(7);
    expect(store.settings.enabled).toBe(DEFAULT_BRIEFING_SETTINGS.enabled);
    expect(store.dismissed['topic-a']).toBeGreaterThan(0);
    expect(store.convened['topic-b']).toBeGreaterThan(0);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('council-oracle-briefings-v1', '{not json');
    const store = loadBriefingStore();
    expect(store.settings).toEqual(DEFAULT_BRIEFING_SETTINGS);
    expect(store.dismissed).toEqual({});
  });
});
