import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordEvent,
  recordError,
  recordWarn,
  recordInfo,
  getEvents,
  clearEvents,
  exportEventsAsJSON,
  exportEventsAsText,
  subscribeToEvents,
} from '../eventLog';

describe('eventLog catalog service', () => {
  beforeEach(() => {
    clearEvents();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('records structured events and retrieves them newest-first', () => {
    recordInfo('oracle', 'Thread created', 'User started a new thread', { id: 't1' });
    recordWarn('network', 'Slow response', 'Latency > 2000ms', undefined, 'google/gemini-2.5-flash');
    recordError('oracle', 'Stream dropped', new Error('Connection reset'), undefined, 'meta-llama/llama-3.3-70b-instruct', 502);

    const events = getEvents();
    expect(events.length).toBe(3);
    expect(events[0].title).toBe('Stream dropped');
    expect(events[0].level).toBe('error');
    expect(events[0].status).toBe(502);
    expect(events[0].model).toBe('meta-llama/llama-3.3-70b-instruct');

    expect(events[1].title).toBe('Slow response');
    expect(events[1].level).toBe('warn');

    expect(events[2].title).toBe('Thread created');
    expect(events[2].level).toBe('info');
  });

  it('filters events by level, scope, and search term', () => {
    recordInfo('oracle', 'Direct query sent', 'Asking question');
    recordError('network', 'Gateway timeout', new Error('504 timeout'), undefined, 'deepseek/deepseek-r1', 504);
    recordWarn('chamber', 'Cost high', 'Approaching budget ceiling');

    // Filter by level
    const errorsOnly = getEvents({ level: 'error' });
    expect(errorsOnly.length).toBe(1);
    expect(errorsOnly[0].title).toBe('Gateway timeout');

    // Filter by scope
    const oracleOnly = getEvents({ scope: 'oracle' });
    expect(oracleOnly.length).toBe(1);
    expect(oracleOnly[0].title).toBe('Direct query sent');

    // Filter by search keyword
    const searched = getEvents({ search: 'deepseek' });
    expect(searched.length).toBe(1);
    expect(searched[0].model).toBe('deepseek/deepseek-r1');
  });

  it('exports logs as JSON and formatted text', () => {
    recordError('oracle', 'Network error', new Error('Failed to fetch'), { context: 'retry' });
    
    const jsonStr = exportEventsAsJSON();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.totalEvents).toBe(1);
    expect(parsed.events[0].title).toBe('Network error');

    const textStr = exportEventsAsText();
    expect(textStr).toContain('[ERROR]');
    expect(textStr).toContain('[oracle]');
    expect(textStr).toContain('Network error: Failed to fetch');
  });

  it('notifies subscribers on new event', () => {
    let callCount = 0;
    const unsub = subscribeToEvents(() => {
      callCount++;
    });

    recordInfo('system', 'Test 1', 'Testing subscriber');
    expect(callCount).toBe(1);

    recordWarn('system', 'Test 2', 'Testing subscriber again');
    expect(callCount).toBe(2);

    unsub();
    recordInfo('system', 'Test 3', 'Testing unsub');
    expect(callCount).toBe(2);
  });
});
