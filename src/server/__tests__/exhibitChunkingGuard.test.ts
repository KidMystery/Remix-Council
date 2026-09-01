import { describe, it, expect } from 'vitest';
import {
  AgentLoopRunner,
  newAgentJobId,
  sanitizeAgentSpec,
  type AgentJob,
  type AgentLoopDeps,
} from '../agentLoop';

const CATALOG = [
  { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
];

function makeRunner(handler: (callIndex: number, body: any) => any): { runner: AgentLoopRunner; calls: any[] } {
  const calls: any[] = [];
  let i = 0;
  const fetchFn = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const res = handler(i, body);
    i += 1;
    return { ok: true, status: 200, json: async () => res } as unknown as Response;
  }) as unknown as typeof fetch;
  const deps: AgentLoopDeps = {
    fetchFn,
    catalog: () => CATALOG,
    openRouterKey: () => 'sk-or-test',
    defaultModel: () => 'google/gemini-2.5-flash',
    defaultMaxJobCostUSD: () => 2.0,
  };
  return { runner: new AgentLoopRunner(deps, ''), calls };
}

function job(): AgentJob {
  return {
    id: newAgentJobId(),
    spec: {
      goal: 'Give a verdict on the attached financial CSV.',
      mode: 'nexus',
      budget: 'cheap',
      maxResearchQueries: 0,
      maxDeliberationPasses: 1,
      maxJobCostUSD: 2,
    },
    status: 'planning',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    plan: null,
    research: [],
    readings: [],
    passes: [],
    verdict: '',
    citations: [],
    usageUSD: 0,
    progress: { phase: 'planning', detail: '' },
  };
}

describe('empty-consensus guard', () => {
  it('retries an empty pass once and completes when the retry answers', async () => {
    let emptyFired = false;
    const { runner, calls } = makeRunner((i, body) => {
      if (body.messages.some((m: any) => /PLANNING phase/.test(m.content))) {
        return { choices: [{ message: { content: '```json\n{"summary":"s","steps":[],"research_queries":[]}\n```' } }], usage: {} };
      }
      if (body.messages.some((m: any) => /previous response was empty/.test(m.content))) {
        return { choices: [{ message: { content: 'Verdict: approve the loan at 6.2%.' } }], usage: {} };
      }
      if (body.messages.some((m: any) => /DELIBERATION phase/.test(m.content))) {
        emptyFired = true;
        return { choices: [{ message: { content: '' } }], usage: {} };
      }
      if (body.messages.some((m: any) => /FINALIZE phase/.test(m.content))) {
        return { choices: [{ message: { content: '## Verdict\nApprove.' } }], usage: {} };
      }
      return { choices: [{ message: { content: 'ok' } }], usage: {} };
    });
    const result = await runner.run(job());
    expect(emptyFired).toBe(true);
    expect(result.succeeded).toBe(true);
    expect(result.job.status).toBe('done');
    expect(result.job.passes[0].consensus).toBe('Verdict: approve the loan at 6.2%.');
    // exactly one retry was issued
    expect(calls.filter((c) => c.messages.some((m: any) => /previous response was empty/.test(m.content))).length).toBe(1);
  });

  it('fails the mission when the retry is also empty — never marks it complete', async () => {
    const { runner } = makeRunner(() => ({ choices: [{ message: { content: '' } }], usage: {} }));
    const result = await runner.run(job());
    expect(result.succeeded).toBe(false);
    expect(result.job.status).toBe('failed');
    expect(result.job.error).toMatch(/Empty consensus/);
    expect(result.job.verdict).toBe('');
  });
});

describe('chunkStrategy plumbing', () => {
  it('sanitizeAgentSpec accepts auto/csv-rows/none and drops junk', () => {
    expect((sanitizeAgentSpec({ goal: 'g', chunkStrategy: 'csv-rows' }) as any).chunkStrategy).toBe('csv-rows');
    expect((sanitizeAgentSpec({ goal: 'g', chunkStrategy: 'none' }) as any).chunkStrategy).toBe('none');
    expect((sanitizeAgentSpec({ goal: 'g', chunkStrategy: 'weird' }) as any).chunkStrategy).toBeUndefined();
    // default (auto) needs no field — chunking is on unless 'none'
  });
});
