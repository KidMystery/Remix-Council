import { describe, it, expect, vi } from 'vitest';
import { AgentLoopRunner, newAgentJobId, type AgentJob, type AgentLoopDeps } from '../agentLoop';
import { NexusMissionStore } from '../nexusMissions';

const FREE_MODEL = 'z-ai/glm-4.5-air:free';
const PAID_MODEL = 'anthropic/claude-sonnet-4.5';

function makeFetchMock(pricing: { prompt: string; completion: string }) {
  const bodies: any[] = [];
  const fetchFn = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'x',
        choices: [{ message: { content: 'verdict text ```json\n{"agreementScore": 80}\n```' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, bodies };
}

function makeRunner(fetchFn: typeof fetch, catalog: any[]): AgentLoopRunner {
  const deps: AgentLoopDeps = {
    fetchFn,
    catalog: () => catalog,
    openRouterKey: () => 'sk-or-test',
    defaultModel: () => FREE_MODEL,
    defaultMaxJobCostUSD: () => 2.0,
  };
  return new AgentLoopRunner(deps, '');
}

function job(spec: Partial<AgentJob['spec']>): AgentJob {
  return {
    id: newAgentJobId(),
    spec: { goal: 'g', mode: 'nexus', maxResearchQueries: 0, maxDeliberationPasses: 2, ...spec },
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

function makeStore(models: unknown, budget: unknown, defaultModel = PAID_MODEL) {
  const catalog = [
    { id: FREE_MODEL, pricing: { prompt: '0', completion: '0' } },
    { id: PAID_MODEL, pricing: { prompt: '0.000003', completion: '0.000015' } },
  ];
  return new NexusMissionStore(
    { run: vi.fn(), get: () => undefined, list: () => [], cancel: () => false } as any,
    '',
    undefined,
    () => catalog,
    () => defaultModel
  );
}

describe('free-budget missions API', () => {
  it("(a) budget:'free' + :free model → zero logged cost, passes run", async () => {
    // Free model carries paid-tier catalog pricing on purpose: the guard must
    // zero the cost, not rely on zero pricing.
    const catalog = [{ id: FREE_MODEL, pricing: { prompt: '0.000003', completion: '0.000015' } }];
    const { fetchFn } = makeFetchMock(catalog[0].pricing);
    const runner = makeRunner(fetchFn, catalog);
    const { job: done } = await runner.run(job({ budget: 'free', model: FREE_MODEL }));
    expect(done.status).toBe('done');
    expect(done.passes.length).toBeGreaterThanOrEqual(2);
    expect(done.usageUSD).toBe(0);
  });

  it("(b) budget:'free' + paid model → 400-style rejection at create", () => {
    const store = makeStore(PAID_MODEL, 'free');
    const res = store.create({ goal: 'audit the csv', models: [PAID_MODEL], budget: 'free' });
    expect('error' in res && res.error).toBe(
      `model ${PAID_MODEL} is not free-tier; use budget='paid' or pick a :free model`
    );
  });

  it("(b2) budget:'free' + paid DEFAULT model → rejected when no models[] given", () => {
    const store = makeStore(undefined, 'free');
    const res = store.create({ goal: 'audit the csv', budget: 'free' });
    expect('error' in res && res.error).toContain("is not free-tier; use budget='paid'");
  });

  it("(c) budget:'paid' + maxJobCostUSD → existing stop_budget behavior unchanged", async () => {
    const catalog = [
      { id: PAID_MODEL, pricing: { prompt: '0.000003', completion: '0.000015' } },
    ];
    const { fetchFn } = makeFetchMock(catalog[0].pricing);
    const runner = makeRunner(fetchFn, catalog);
    const { job: done } = await runner.run(
      job({ model: PAID_MODEL, maxJobCostUSD: 0.02 })
    );
    // 1000 * 0.000003 + 500 * 0.000015 = $0.0105/call → cap reached mid-run
    expect(done.status).toBe('stopped_budget');
    expect(done.usageUSD).toBeGreaterThanOrEqual(0.02);
  });

  it("(d) token counts still logged when cost is $0", async () => {
    const catalog = [{ id: FREE_MODEL, pricing: { prompt: '0', completion: '0' } }];
    const { fetchFn } = makeFetchMock(catalog[0].pricing);
    const runner = makeRunner(fetchFn, catalog);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { job: done } = await runner.run(job({ budget: 'free', model: FREE_MODEL }));
    expect(done.usageTokens).toBeDefined();
    expect(done.usageTokens!.prompt).toBeGreaterThanOrEqual(2000);
    expect(done.usageTokens!.completion).toBeGreaterThanOrEqual(1000);
    expect(done.usageUSD).toBe(0);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('free-budget'))).toBe(true);
    logSpy.mockRestore();
  });
});
