import { describe, it, expect } from 'vitest';
import { pruneStaleOracleErrors } from '../oracleStore';
import type { OracleMessage } from '../oracleStore';

/**
 * Regression tests for "dead errors hanging in the chat that won't leave"
 * (Aug 2026 Auto-Rotate error storm):
 *
 * Error bubbles had a manual × dismiss, but nothing ever cleared RESOLVED
 * errors — after a storm the thread kept every [Error: …] forever. Contract
 * now: the moment a turn succeeds in a thread, all error messages BEFORE the
 * last successful assistant message are stale litter and are pruned on commit.
 * Errors after the last success (the currently-broken tail) are kept — they
 * are live diagnostics.
 */

let n = 0;
const u = (content = 'hi') => ({ id: `m${n++}`, role: 'user', content, timestamp: 1 }) as OracleMessage;
const ok = (content = 'answer') =>
  ({ id: `m${n++}`, role: 'assistant', content, timestamp: 1 }) as OracleMessage;
const err = (model = 'openai/gpt-4o') =>
  ({ id: `m${n++}`, role: 'assistant', content: `[Error: 404 ${model}]`, timestamp: 1, error: true }) as OracleMessage;

describe('pruneStaleOracleErrors', () => {
  it('drops errors that precede a successful turn', () => {
    const thread = [u(), err(), err(), ok(), u()];
    const pruned = pruneStaleOracleErrors(thread);
    expect(pruned.filter((m) => m.error)).toHaveLength(0);
    expect(pruned).toHaveLength(3); // u, ok, u
  });

  it('keeps errors AFTER the last success (live diagnostics of the broken tail)', () => {
    const thread = [u(), err(), ok(), u(), err(), err()];
    const pruned = pruneStaleOracleErrors(thread);
    expect(pruned.filter((m) => m.error)).toHaveLength(2);
  });

  it('keeps everything when the thread never succeeded (all-errors thread unchanged)', () => {
    const thread = [u(), err(), err()];
    expect(pruneStaleOracleErrors(thread)).toEqual(thread);
  });

  it('never drops user or successful messages', () => {
    const thread = [u('a'), err(), ok('b'), u('c'), ok('d'), u('e')];
    const pruned = pruneStaleOracleErrors(thread);
    expect(pruned.map((m) => m.content)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('handles empty threads', () => {
    expect(pruneStaleOracleErrors([])).toEqual([]);
  });
});
