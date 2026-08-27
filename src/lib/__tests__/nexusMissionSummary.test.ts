import { describe, it, expect } from 'vitest';
import { missionSummary, applyServerJobSummaryToMission, buildConsensusCopyText, type PersistedMission } from '../nexusMission';

/**
 * Regression tests for "Nexus threads commit on server but don't summarize
 * what they're about" (Aug 2026):
 *
 * 1. The mission list showed only title + status — no one-liner of what the
 *    mission concluded. missionSummary() now provides it (brief → verdict →
 *    goal fallback).
 * 2. Missions that finished server-side while the app was closed stayed
 *    'running' in the archive until clicked. applyServerJobSummaryToMission()
 *    lets a lightweight mount sweep fold a finished job's outcome into the
 *    archived mission without full hydration.
 */

function fixture(overrides: Partial<PersistedMission> = {}): PersistedMission {
  return {
    id: 'm1',
    goal: 'Review last night’s cashflow CSVs and tell me where I am leaking money',
    title: 'Cashflow leak review',
    presetId: 'fast_and_free',
    maxIterations: 5,
    currentIteration: 3,
    status: 'running',
    rounds: [],
    consensusMetrics: [],
    morningBrief: null,
    updatedAt: Date.now(),
    ...overrides,
  } as PersistedMission;
}

describe('missionSummary', () => {
  it('prefers the morning brief, stripped and clamped', () => {
    const m = fixture({
      morningBrief: '## Morning Brief\n\n- **Leaks found**: subscriptions\n- TQQQ constraint holds\n- UNKNOWN: brokerage balance',
    });
    const s = missionSummary(m);
    expect(s).toMatch(/Leaks found/);
    expect(s).toMatch(/UNKNOWN/);
    expect(s).not.toMatch(/##/);
    expect(s).not.toMatch(/\*\*/);
    expect(s.length).toBeLessThanOrEqual(140);
  });

  it('falls back to the last round verdict when there is no brief', () => {
    const m = fixture({
      morningBrief: null,
      rounds: [
        { synthesis: { content: 'old pass' } } as any,
        { synthesis: { content: 'Final: cut the subscriptions, keep TQQQ at 62.50/week.' } } as any,
      ],
    });
    expect(missionSummary(m)).toMatch(/Final: cut the subscriptions/);
  });

  it('falls back to the goal when there are no rounds either', () => {
    expect(missionSummary(fixture({ morningBrief: null }))).toMatch(/cashflow CSVs/i);
  });

  it('returns empty string when there is nothing to say', () => {
    expect(missionSummary(fixture({ goal: '', title: 'Nexus Mission', morningBrief: null }))).toBe('');
  });
});

describe('applyServerJobSummaryToMission', () => {
  const doneJob = {
    status: 'done',
    brief: 'Brief: three leaks plugged.',
    verdict: 'Plug the three leaks.',
    usageUSD: 0.42,
    passes: [{ index: 1, consensus: 'x', agreementScore: 88 }],
  } as any;

  it('folds a finished job into a running archived mission (status, brief, cost)', () => {
    const m = applyServerJobSummaryToMission(fixture(), doneJob);
    expect(m.status).toBe('converged'); // last agreement 88 ≥ 85
    expect(m.morningBrief).toBe('Brief: three leaks plugged.');
    expect(m.estimatedCost).toBe(0.42);
    expect(m.title).toBe('Cashflow leak review'); // identity preserved
    expect(m.updatedAt).toBeGreaterThan(0);
  });

  it('max_reached when agreement stays below 85', () => {
    const m = applyServerJobSummaryToMission(
      fixture(),
      { ...doneJob, passes: [{ index: 1, consensus: 'x', agreementScore: 61 }] } as any
    );
    expect(m.status).toBe('max_reached');
  });

  it('maps failed → error and cancelled/interrupted → paused', () => {
    expect(applyServerJobSummaryToMission(fixture(), { ...doneJob, status: 'failed' }).status).toBe('error');
    expect(applyServerJobSummaryToMission(fixture(), { ...doneJob, status: 'cancelled' }).status).toBe('paused');
    expect(applyServerJobSummaryToMission(fixture(), { ...doneJob, status: 'interrupted' }).status).toBe('paused');
  });

  it('stopped_budget keeps the brief but never reports converged', () => {
    const m = applyServerJobSummaryToMission(fixture(), { ...doneJob, status: 'stopped_budget' });
    expect(m.status).toBe('max_reached');
    expect(m.morningBrief).toBe('Brief: three leaks plugged.');
  });

  it('never touches a mission that is not running (already hydrated by hand)', () => {
    const hydrated = fixture({ status: 'converged', morningBrief: 'Hydrated in view.' });
    expect(applyServerJobSummaryToMission(hydrated, doneJob)).toBe(hydrated);
  });

  it('ignores non-terminal jobs', () => {
    expect(applyServerJobSummaryToMission(fixture(), { ...doneJob, status: 'running' })).toMatchObject({
      status: 'running',
      morningBrief: null,
    });
  });
});

describe('buildConsensusCopyText', () => {
  it('copies the FINAL verdict round, not earlier passes', () => {
    const rounds = [
      { synthesis: { content: 'Pass 1: preliminary read.' } } as any,
      { synthesis: { content: 'Final verdict: ship it, with four caveats.' } } as any,
    ];
    const text = buildConsensusCopyText(rounds, null);
    expect(text).toContain('Final verdict: ship it');
    expect(text).not.toContain('Pass 1');
  });

  it('appends the morning brief when present', () => {
    const rounds = [{ synthesis: { content: 'Verdict text.' } } as any];
    expect(buildConsensusCopyText(rounds, 'Brief: three leaks plugged.')).toContain('Brief: three leaks plugged.');
  });

  it('returns empty string for a mission with no verdicts yet', () => {
    expect(buildConsensusCopyText([], null)).toBe('');
    expect(buildConsensusCopyText([{ synthesis: {} } as any], undefined)).toBe('');
  });
});
