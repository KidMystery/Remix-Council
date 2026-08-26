import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../openrouter', () => ({
  streamOpenRouterCompletion: vi.fn(),
}));

import { streamOpenRouterCompletion } from '../openrouter';
import { streamWithTokenGovernor } from '../tokenGovernor';

const mockStream = vi.mocked(streamOpenRouterCompletion);

describe('token governor', () => {
  beforeEach(() => {
    mockStream.mockReset();
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
  });

  it('does not shrink the budget after a short complete answer', async () => {
    mockStream.mockResolvedValue({
      content: 'hi',
      finishReason: 'stop',
      usage: { completionTokens: 10 },
    } as any);

    const res = await streamWithTokenGovernor({
      model: 'test/model',
      messages: [{ role: 'user', content: 'q' }],
      baseMaxTokens: 1600,
      governorKey: 'thread-raw',
    });

    expect(res.content).toBe('hi');
    expect(res.expansions).toBe(0);
    expect(res.learnedBudget).toBe(1600);
    expect(localStorage.getItem('council_token_governor_v1')).toBeNull();
  });

  it('continues when the first pass is truncated', async () => {
    mockStream
      .mockResolvedValueOnce({
        content: 'part1',
        finishReason: 'length',
        usage: { completionTokens: 1600 },
      } as any)
      .mockResolvedValueOnce({
        content: 'part2',
        finishReason: 'stop',
        usage: { completionTokens: 40 },
      } as any);

    const res = await streamWithTokenGovernor({
      model: 'test/model',
      messages: [{ role: 'user', content: 'q' }],
      baseMaxTokens: 1600,
      governorKey: 'thread-expand',
    });

    expect(res.content).toBe('part1part2');
    expect(res.expansions).toBe(1);
  });
});
