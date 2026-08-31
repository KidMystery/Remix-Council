import { describe, it, expect } from 'vitest';
import { AgentLoopRunner, newAgentJobId, type AgentJob, type AgentLoopDeps } from '../agentLoop';

const COUNCIL = ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.1-codex-max', 'google/gemini-2.5-pro', 'deepseek/deepseek-v3.2'];
const CATALOG = COUNCIL.map((id) => ({ id, pricing: { prompt: '0.0000003', completion: '0.0000025' } }));

function makeFetchMock() {
  const bodies: any[] = [];
  const fetchFn = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'x',
        choices: [{ message: { content: '```json\n{"agreementScore": 80}\n```' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, bodies };
}

function makeRunner(fetchFn: typeof fetch): AgentLoopRunner {
  const deps: AgentLoopDeps = {
    fetchFn,
    catalog: () => CATALOG,
    openRouterKey: () => 'sk-or-test',
    defaultModel: () => 'google/gemini-2.5-flash',
    defaultMaxJobCostUSD: () => 2.0,
  };
  return new AgentLoopRunner(deps, '');
}

function job(spec: Partial<AgentJob['spec']>): AgentJob {
  return {
    id: newAgentJobId(),
    spec: { goal: 'g', mode: 'nexus', budget: 'cheap', maxResearchQueries: 0, maxDeliberationPasses: 2, ...spec },
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

describe('agent loop multi-model council', () => {
  it('runs one pass per council model (sequential, same context) then a chair synthesis pass', async () => {
    const { fetchFn, bodies } = makeFetchMock();
    const runner = makeRunner(fetchFn);
    const { job: done } = await runner.run(job({ models: [...COUNCIL] }));

    expect(done.status).toBe('done');
    expect(done.passes).toHaveLength(COUNCIL.length + 1);
    COUNCIL.forEach((m, i) => {
      expect(done.passes[i].label).toBe(`Council pass ${i + 1} · ${m}`);
    });
    expect(done.passes[COUNCIL.length].label).toBe(`Chair synthesis · ${COUNCIL[0]}`);

    // Each deliberation call hit its own model on OpenRouter.
    const deliberationModels = bodies
      .filter((b) => (b.messages?.[1]?.content || '').includes('Pass '))
      .map((b) => b.model);
    expect(deliberationModels).toEqual([...COUNCIL, COUNCIL[0]]);
  });

  it('default path unchanged: no models[] → maxDeliberationPasses on the single model', async () => {
    const { fetchFn, bodies } = makeFetchMock();
    const runner = makeRunner(fetchFn);
    const { job: done } = await runner.run(job({}));
    expect(done.status).toBe('done');
    expect(done.passes).toHaveLength(2);
    expect(done.passes.map((p) => p.label)).toEqual(['Falsification pass 1', 'Falsification pass 2']);
    expect(new Set(bodies.map((b) => b.model)).size).toBe(1);
  });

  it('liveness guard substitutes a vanished council model from the catalog', async () => {
    const { fetchFn, bodies } = makeFetchMock();
    const runner = makeRunner(fetchFn);
    const { job: done } = await runner.run(job({ models: [...COUNCIL.slice(0, 2), 'dead/dead-model'] }));
    expect(done.status).toBe('done');
    const models = bodies.map((b) => b.model);
    expect(models).toContain('google/gemini-2.5-pro'); // google/ fallback substituted
    expect(models).not.toContain('dead/dead-model');
  });
});
