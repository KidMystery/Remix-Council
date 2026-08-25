import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentLoopRunner,
  sanitizeAgentSpec,
  newAgentJobId,
  type AgentJob,
  type AgentLoopDeps,
} from '../agentLoop';

/** Deterministic catalog entry for rate math. */
const CATALOG = [
  { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'deepseek/deepseek-v4-flash-0731', pricing: { prompt: '0.00000004', completion: '0.00000008' } },
  { id: 'free/free-model', pricing: { prompt: '0', completion: '0' } },
];

interface MockCall {
  url: string;
  body: any;
}

/** Builds a scripted OpenRouter chat-completions responder. */
function makeFetchMock(handler: (callIndex: number, body: any) => any) {
  let calls = 0;
  const log: MockCall[] = [];
  const fetchFn = (async (url: any, init: any) => {
    log.push({ url: String(url), body: JSON.parse(init.body) });
    const res = handler(calls, JSON.parse(init.body));
    calls += 1;
    if (res instanceof Error) {
      return { ok: false, status: 500, json: async () => ({ error: { message: res.message } }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => res } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, log };
}

function makeRunner(fetchFn: typeof fetch, extra: Partial<AgentLoopDeps> = {}, dir = ''): AgentLoopRunner {
  const deps: AgentLoopDeps = {
    fetchFn,
    catalog: () => CATALOG,
    openRouterKey: () => 'sk-or-test',
    defaultModel: () => 'google/gemini-2.5-flash',
    defaultMaxJobCostUSD: () => 2.0,
    ...extra,
  };
  return new AgentLoopRunner(deps, dir);
}

function job(overrides: Partial<AgentJob['spec']> = {}): AgentJob {
  return {
    id: newAgentJobId(),
    spec: {
      goal: 'Which estimate should I accept for this roof replacement?',
      mode: 'nexus',
      budget: 'cheap',
      maxResearchQueries: 2,
      maxDeliberationPasses: 2,
      maxJobCostUSD: 2,
      ...overrides,
    },
    status: 'planning',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    plan: null,
    research: [],
    passes: [],
    verdict: '',
    citations: [],
    usageUSD: 0,
    progress: { phase: 'planning', detail: '' },
  };
}

const planCall = {
  id: 'plan',
  choices: [{ message: { content: '```json\n{"summary": "Compare roof quotes", "steps": ["a", "b"], "research_queries": ["roof replacement costs 2026", "contractor quote fairness"]}\n```' } }],
  usage: { prompt_tokens: 500, completion_tokens: 100 },
};

const researchCall = (citations: any[]) => ({
  id: 'research',
  choices: [{ message: { content: 'Roof replacements average $12k–$18k in NJ in 2026.', annotations: citations } }],
  usage: { prompt_tokens: 800, completion_tokens: 200, web_search_cost: 0.02 },
});

const passCall = (score = 70) => ({
  id: 'pass',
  choices: [{ message: { content: `Current consensus: accept the $14k quote.\n\n\`\`\`json\n{"agreementScore": ${score}, "changedFromPrevious": ""}\n\`\`\`` } }],
  usage: { prompt_tokens: 1000, completion_tokens: 400 },
});

const finalCall = {
  id: 'final',
  choices: [{ message: { content: '## Verdict\nAccept the $14k quote.\n\n## What I verified\nPrices align with research.\n\n## What I could not verify\nContractor reputation.\n\n## Confidence\nModerate.\n\n## Sources\n- https://example.com/roof-costs' } }],
  usage: { prompt_tokens: 1200, completion_tokens: 500 },
};

describe('sanitizeAgentSpec', () => {
  it('accepts a valid spec and clamps bounds', () => {
    const spec = sanitizeAgentSpec({
      goal: '  plan my finances  ',
      mode: 'nexus',
      budget: 'free',
      maxResearchQueries: 99,
      maxDeliberationPasses: -5,
      pacedMinutes: 500,
      maxJobCostUSD: 999,
      model: 'meta/muse-spark-1.2',
    });
    expect(spec).not.toHaveProperty('error');
    const s = spec as AgentJob['spec'];
    expect(s.goal).toBe('plan my finances');
    expect(s.mode).toBe('nexus');
    expect(s.budget).toBe('free');
    expect(s.maxResearchQueries).toBe(6);
    expect(s.maxDeliberationPasses).toBe(1);
    expect(s.pacedMinutes).toBe(180);
    expect(s.maxJobCostUSD).toBe(50);
    expect(s.model).toBe('meta/muse-spark-1.2');
  });

  it('rejects missing goals and malformed model ids', () => {
    expect(sanitizeAgentSpec({})).toEqual({ error: 'A goal is required.' });
    const s = sanitizeAgentSpec({ goal: 'x', model: 'not-a-valid-model' }) as AgentJob['spec'];
    expect(s.model).toBeUndefined();
  });
});

describe('AgentLoopRunner happy path (nexus)', () => {
  it('plans, researches with tools, deliberates with falsification, and finalizes', async () => {
    const { fetchFn, log } = makeFetchMock((i) => {
      // 0 plan, 1-2 research, 3-4 passes, 5 final
      if (i === 0) return planCall;
      if (i === 1 || i === 2) return researchCall([{ type: 'url_citation', title: 'Roof Costs', url: 'https://example.com/roof-costs' }]);
      if (i === 3 || i === 4) return passCall(70 + i);
      return finalCall;
    });
    const runner = makeRunner(fetchFn);
    const result = await runner.run(job());

    expect(result.succeeded).toBe(true);
    expect(result.job.status).toBe('done');
    expect(result.job.plan?.researchQueries).toHaveLength(2);
    expect(result.job.research).toHaveLength(2);
    expect(result.job.citations).toEqual([{ title: 'Roof Costs', url: 'https://example.com/roof-costs' }]);
    expect(result.job.passes).toHaveLength(2);
    expect(result.job.passes[0].agreementScore).toBe(73);
    expect(result.job.verdict).toContain('## Verdict');
    expect(result.job.confidence).toContain('Moderate');

    // The second pass must falsify the first consensus.
    const pass2User = log.find((c) => JSON.stringify(c.body.messages?.[1]?.content || '').includes('Pass 2 of 2'))!;
    expect(pass2User.body.messages[1].content).toContain('[Self-falsification pass');
    // Research calls carry the web_search server tool.
    expect(log[1].body.tools).toEqual([expect.objectContaining({ type: 'openrouter:web_search' })]);
    // Cost ledger accumulates tokens + web search fees.
    expect(result.job.usageUSD).toBeGreaterThan(0.02);
  });

  it('skips research tools entirely under a strict free budget', async () => {
    const { fetchFn, log } = makeFetchMock((i) => (i === 0 ? planCall : finalCall));
    const runner = makeRunner(fetchFn);
    const result = await runner.run(job({ budget: 'free', maxDeliberationPasses: 1 }));
    expect(result.succeeded).toBe(true);
    expect(result.job.research).toEqual([]);
    expect(log.every((c) => !c.body.tools)).toBe(true);
  });

  it('survives a malformed plan JSON with a graceful default', async () => {
    const { fetchFn } = makeFetchMock((i) => {
      if (i === 0) return { ...planCall, choices: [{ message: { content: 'Just some prose, no JSON here.' } }], usage: planCall.usage };
      if (i < 3) return researchCall([]);
      return finalCall;
    });
    const runner = makeRunner(fetchFn);
    const result = await runner.run(job());
    expect(result.succeeded).toBe(true);
    expect(result.job.plan?.summary).toBe('Just some prose, no JSON here.');
  });
});

describe('AgentLoopRunner guardrails', () => {
  it('stops with stopped_budget once the cost cap is hit', async () => {
    // Tiny cap so even the planning call busts it.
    const { fetchFn } = makeFetchMock(() => planCall);
    const runner = makeRunner(fetchFn, { defaultMaxJobCostUSD: () => 0.00001 });
    const result = await runner.run(job({ maxJobCostUSD: 0.00001 }));
    expect(result.job.status).toBe('stopped_budget');
    expect(result.job.progress.detail).toContain('cost cap');
  });

  it('can be cancelled between phases', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    const { fetchFn } = makeFetchMock(async (i) => {
      if (i === 0) return planCall;
      await gate;
      return researchCall([]);
    });
    const runner = makeRunner(fetchFn);
    const j = job();
    const running = runner.run(j);
    // Give the loop time to reach the research phase, then cancel by id.
    await new Promise((r) => setTimeout(r, 10));
    runner.cancel(j.id);
    release();
    const result = await running;
    expect(result.job.status).toBe('cancelled');
  });

  it('does not stamp a verdict when every research query fails', async () => {
    const { fetchFn } = makeFetchMock((i) => {
      if (i === 0) return planCall;
      return new Error('search down');
    });
    const runner = makeRunner(fetchFn);
    const result = await runner.run(job({ maxDeliberationPasses: 1, maxResearchQueries: 2 }));
    expect(result.succeeded).toBe(false);
    expect(result.job.status).toBe('failed');
    expect(result.job.error).toMatch(/every query failed/i);
    expect(result.job.verdict).toBe('');
  });

  it('records honest failure when upstream errors', async () => {
    const { fetchFn } = makeFetchMock(() => new Error('upstream exploded'));
    const runner = makeRunner(fetchFn);
    const result = await runner.run(job());
    expect(result.succeeded).toBe(false);
    expect(result.job.status).toBe('failed');
    expect(result.job.error).toContain('upstream exploded');
  });
});
