import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import http from 'http';

// Mock ONLY the agent runner — no real OpenRouter calls in these tests.
vi.mock('../../../src/server/agentLoop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/server/agentLoop')>();
  class FakeAgentLoopRunner {
    run(job: any) {
      return Promise.resolve({
        job: {
          ...job,
          status: 'done',
          finishedAt: Date.now(),
          passes: [
            { index: 1, label: 'pass-1', consensus: 'Mock consensus pass 1', agreementScore: 0.9 },
            { index: 2, label: 'final', consensus: 'Mock final consensus', agreementScore: 0.95 },
          ],
          verdict: 'Mock verdict: the answer is yes.',
          citations: [{ title: 'Mock source', url: 'https://example.com/mock' }],
          confidence: 'high (mocked)',
          usageUSD: 0.0123,
        },
        succeeded: true,
      });
    }
    cancel() {
      return true;
    }
    get() {
      return undefined;
    }
    list() {
      return [];
    }
  }
  return { ...actual, AgentLoopRunner: FakeAgentLoopRunner };
});

const { startServer } = await import('../../../server');

describe('POST /api/council/deliberate (Hermes bridge)', () => {
  let activeServer: http.Server | null = null;
  const prevKey = process.env.COUNCIL_ACCESS_KEY;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-456';
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

  const post = (port: number, body: unknown, key = 'test-key-456') =>
    fetch(`http://127.0.0.1:${port}/api/council/deliberate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-council-key': key },
      body: JSON.stringify(body),
    });

  it('bad key → 401', async () => {
    const port = await boot(4594);
    const res = await post(port, { question: 'q' }, 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('missing question → 400', async () => {
    const port = await boot(4595);
    const res = await post(port, { participants: ['a'] });
    expect(res.status).toBe(400);
  });

  it('invalid participants type → 400', async () => {
    const port = await boot(4596);
    const res = await post(port, { question: 'q', participants: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('happy path (mocked agentLoop) → 200 with transcript + consensus', async () => {
    const port = await boot(4597);
    const res = await post(port, {
      question: 'Should we ship the bridge?',
      participants: ['Skeptic', 'Optimist'],
      rounds: 2,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobId).toBeTruthy();
    expect(Array.isArray(body.transcript)).toBe(true);
    expect(body.transcript.length).toBe(2);
    expect(body.consensus).toMatch(/Mock verdict/);
    expect(body.usageUSD).toBeCloseTo(0.0123, 6);
  });

  it('unconfigured key → 503 (fail closed)', async () => {
    delete process.env.COUNCIL_ACCESS_KEY;
    const port = await boot(4598);
    const res = await post(port, { question: 'q' });
    expect(res.status).toBe(503);
  });
});
