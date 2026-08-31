import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import http from 'http';

// Mock ONLY the agent runner — no real OpenRouter calls in these tests.
vi.mock('../../../src/server/agentLoop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/server/agentLoop')>();
  class FakeAgentLoopRunner {
    private jobs = new Map<string, any>();
    run(job: any) {
      const done = {
        ...job,
        status: 'done',
        finishedAt: Date.now(),
        passes: [
          { index: 1, label: 'Falsification pass 1', consensus: 'Mock consensus', agreementScore: 90 },
        ],
        verdict: 'Mock verdict',
        citations: [],
        usageUSD: 0.01,
      };
      this.jobs.set(job.id, done);
      return Promise.resolve({ job: done, succeeded: true });
    }
    cancel(id: string) {
      const job = this.jobs.get(id);
      if (!job) return false;
      job.status = 'cancelled';
      return true;
    }
    get(id: string) {
      return this.jobs.get(id);
    }
    list() {
      return Array.from(this.jobs.values());
    }
  }
  return { ...actual, AgentLoopRunner: FakeAgentLoopRunner };
});

const { startServer } = await import('../../../server');

const CSV = 'name,role\nAda,pilot\nGrace,admiral';

describe('Nexus missions API (Phase 3)', () => {
  let activeServer: http.Server | null = null;
  const prevKey = process.env.COUNCIL_ACCESS_KEY;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-nexus';
  });

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
    process.env.COUNCIL_ACCESS_KEY = prevKey;
    process.env.NODE_ENV = prevNodeEnv;
  });

  const boot = async (port: number) => {
    process.env.NODE_ENV = 'production';
    const started = await startServer(port);
    activeServer = started.server;
    return started.port;
  };

  const call = (
    port: number,
    method: string,
    urlPath: string,
    body?: unknown,
    key = 'test-key-nexus'
  ) =>
    fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-council-key': key },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('create with CSV → 201 mission created, then state is complete with CSV metadata', async () => {
    const port = await boot(4624);
    const res = await call(port, 'POST', '/api/nexus/missions', { goal: 'Analyze the roster', csv: CSV });
    expect(res.status).toBe(201);
    const { data: created } = await res.json();
    expect(created.missionId).toBeTruthy();
    expect(created.status).toBe('running');

    const stateRes = await call(port, 'GET', `/api/nexus/missions/${created.missionId}`);
    expect(stateRes.status).toBe(200);
    const { data: state } = await stateRes.json();
    expect(state.status).toBe('complete'); // fake runner resolves done instantly
    expect(state.csv).toEqual({ headers: ['name', 'role'], rowCount: 2 });
    expect(state.findings.length).toBe(1);
  });

  it('answers resume a paused mission (pause → awaiting_approval → answers → running/complete)', async () => {
    const port = await boot(4625);
    const { data: created } = (
      await (await call(port, 'POST', '/api/nexus/missions', { goal: 'Plan the launch', csv: CSV })).json()
    );
    const paused = await (
      await call(port, 'POST', `/api/nexus/missions/${created.missionId}/pause`, {
        pendingQuestions: ['Which launch window?'],
      })
    ).json();
    expect(paused.data.status).toBe('awaiting_approval');
    expect(paused.data.pendingQuestions).toEqual(['Which launch window?']);

    const answered = await (
      await call(port, 'POST', `/api/nexus/missions/${created.missionId}/answers`, {
        answers: { 'Which launch window?': 'Dawn, Tuesday.' },
      })
    ).json();
    expect(answered.data.answers['Which launch window?']).toBe('Dawn, Tuesday.');
    expect(['running', 'complete']).toContain(answered.data.status);
  });

  it('auth: bad key → 401, unconfigured key → 503 (fail closed)', async () => {
    const port = await boot(4626);
    expect((await call(port, 'POST', '/api/nexus/missions', { goal: 'g' }, 'wrong-key')).status).toBe(401);

    delete process.env.COUNCIL_ACCESS_KEY;
    const port2 = await boot(4627);
    expect((await call(port2, 'POST', '/api/nexus/missions', { goal: 'g' })).status).toBe(503);
  });

  it('bad CSV → 400 with a clear message', async () => {
    const port = await boot(4628);
    const res = await call(port, 'POST', '/api/nexus/missions', { goal: 'g', csv: '   \n \r\n' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/CSV could not be parsed/i);
  });

  it('unknown mission id → 404', async () => {
    const port = await boot(4629);
    expect((await call(port, 'GET', '/api/nexus/missions/nexus_nope')).status).toBe(404);
    expect((await call(port, 'POST', '/api/nexus/missions/nexus_nope/pause', {})).status).toBe(404);
    expect((await call(port, 'POST', '/api/nexus/missions/nexus_nope/answers', { answers: {} })).status).toBe(404);
  });

  it('list returns created missions', async () => {
    const port = await boot(4630);
    await call(port, 'POST', '/api/nexus/missions', { goal: 'Mission one' });
    const res = await call(port, 'GET', '/api/nexus/missions');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });
});
