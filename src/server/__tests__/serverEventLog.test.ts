import { describe, it, expect } from 'vitest';
import { createServerEventLog } from '../../../server';

/**
 * "Where the logs live" (Aug 2026): the server event log is the shared
 * diagnostic surface for agents — GET /api/diagnostics/events returns exactly
 * what recent() produces. Contract: newest-first, bounded ring, clamped
 * limits, and recording NEVER throws (a broken logger must not kill requests).
 */
describe('createServerEventLog', () => {
  it('returns events newest-first', () => {
    const log = createServerEventLog({ filePath: '' });
    log.record('info', 'test', 'first');
    log.record('info', 'test', 'second');
    log.record('info', 'test', 'third');
    const events = log.recent(10);
    expect(events[0].message).toBe('third');
    expect(events[2].message).toBe('first');
  });

  it('caps the ring buffer at maxEvents', () => {
    const log = createServerEventLog({ maxEvents: 50, filePath: '' });
    for (let i = 0; i < 80; i++) log.record('info', 'test', `e${i}`);
    const events = log.recent(500);
    expect(events.length).toBe(50);
    expect(events[0].message).toBe('e79'); // newest kept
    expect(events[49].message).toBe('e30'); // oldest kept
  });

  it('clamps bogus limits to a sane default', () => {
    const log = createServerEventLog({ filePath: '' });
    log.record('info', 'test', 'only');
    expect(log.recent(0).length).toBe(1); // 0 → default, not empty
    expect(log.recent(-5).length).toBe(1);
    expect(log.recent(NaN).length).toBe(1);
  });

  it('carries level, scope, and meta', () => {
    const log = createServerEventLog({ filePath: '' });
    log.record('error', 'upstream', 'OpenRouter 404', { model: 'audit/probe', status: 404 });
    const e = log.recent(1)[0];
    expect(e.level).toBe('error');
    expect(e.scope).toBe('upstream');
    expect(e.meta).toMatchObject({ status: 404 });
    expect(typeof e.ts).toBe('string');
  });

  it('never throws on a broken file path', () => {
    const log = createServerEventLog({ filePath: 'Z:\\/definitely/not/a/path/events.jsonl' });
    expect(() => log.record('warn', 'test', 'boom')).not.toThrow();
    expect(log.recent(1)[0].message).toBe('boom');
  });

  it('rotates the jsonl file when it exceeds maxFileBytes', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-log-'));
    const file = path.join(dir, 'events.jsonl');
    const log = createServerEventLog({ filePath: file, maxFileBytes: 2048 });
    for (let i = 0; i < 60; i++) log.record('info', 'test', `line-${i}-padding-padding-padding-padding`);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.1`)).toBe(true); // previous generation
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
