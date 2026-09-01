import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'http';
import { expandModelsInput, validateModelsAgainstCatalog, MODEL_PRESETS } from '../../lib/modelCatalog';
import { sanitizeAgentSpec } from '../agentLoop';

const COUNCIL = [...MODEL_PRESETS['auto-coding']];

describe('modelCatalog presets + validation', () => {
  it('expands "auto-coding" to the 7-org mission council', () => {
    const res = expandModelsInput('auto-coding');
    expect(res).toEqual({ models: COUNCIL });
    expect(COUNCIL).toHaveLength(7);
    const orgs = new Set(COUNCIL.map((m) => m.split('/')[0]));
    expect(orgs).toEqual(new Set(['anthropic', 'openai', 'google', 'deepseek', 'x-ai', 'qwen', 'meta']));
  });

  it('rejects unknown presets and malformed input', () => {
    expect(expandModelsInput('nope')).toHaveProperty('error');
    expect(expandModelsInput(42)).toHaveProperty('error');
    expect(expandModelsInput([])).toHaveProperty('error');
    expect(expandModelsInput(new Array(9).fill('a/b'))).toHaveProperty('error');
    expect(expandModelsInput(['not a slug!'])).toHaveProperty('error');
  });

  it('catalog liveness: refuses slugs that are not in the cached catalog', () => {
    const catalog = [{ id: COUNCIL[0] }, { id: COUNCIL[1] }];
    expect(validateModelsAgainstCatalog([COUNCIL[0]], catalog)).toBeNull();
    expect(validateModelsAgainstCatalog([COUNCIL[2]], catalog)).toMatch(/not in the cached OpenRouter catalog/);
    // No catalog cached → slug shape only (agent loop guard still applies at run time).
    expect(validateModelsAgainstCatalog([COUNCIL[2]], [])).toBeNull();
  });
});

describe('sanitizeAgentSpec models[]', () => {
  it('carries a valid models array and taskType onto the spec', () => {
    const spec = sanitizeAgentSpec({ goal: 'g', mode: 'nexus', models: COUNCIL, taskType: 'code' }) as any;
    expect(spec.models).toEqual(COUNCIL);
    expect(spec.taskType).toBe('code');
  });

  it('drops a malformed models array instead of poisoning the spec', () => {
    const spec = sanitizeAgentSpec({ goal: 'g', mode: 'nexus', models: ['bad slug', COUNCIL[0]] }) as any;
    expect(spec.models).toBeUndefined();
    const nine = sanitizeAgentSpec({ goal: 'g', mode: 'nexus', models: new Array(9).fill('a/b') }) as any;
    expect(nine.models).toBeUndefined();
  });

  it('default path is unchanged (no models field)', () => {
    const spec = sanitizeAgentSpec({ goal: 'g', mode: 'nexus' }) as any;
    expect(spec.models).toBeUndefined();
  });
});

// Route-level: mission create with a council → spec carries it; bad slug → 400.
vi.mock('../../../src/server/agentLoop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/server/agentLoop')>();
  class FakeAgentLoopRunner {
    private jobs = new Map<string, any>();
    run(job: any) {
      this.jobs.set(job.id, job);
      return Promise.resolve({ job, succeeded: true });
    }
    cancel(id: string) { return this.jobs.delete(id); }
    get(id: string) { return this.jobs.get(id); }
    list() { return Array.from(this.jobs.values()); }
  }
  return { ...actual, AgentLoopRunner: FakeAgentLoopRunner };
});

const { startServer } = await import('../../../server');

describe('Nexus missions model council (route)', () => {
  let activeServer: http.Server | null = null;
  const prevKey = process.env.COUNCIL_ACCESS_KEY;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
    process.env.COUNCIL_ACCESS_KEY = prevKey;
    process.env.NODE_ENV = prevNodeEnv;
  });

  const boot = async (port: number) => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-council';
    process.env.NODE_ENV = 'production';
    const started = await startServer(port);
    activeServer = started.server;
    return started.port;
  };

  const call = (port: number, body: unknown) =>
    fetch(`http://127.0.0.1:${port}/api/nexus/missions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-council-key': 'test-key-council' },
      body: JSON.stringify(body),
    });

  it('create with models: "auto-coding" → mission carries the 4-model council + taskType', async () => {
    const port = await boot(4631);
    const res = await call(port, { goal: 'Refactor the ingestion pipeline', models: 'auto-coding', taskType: 'code' });
    expect(res.status).toBe(201);
    const state = await (await fetch(`http://127.0.0.1:${port}/api/nexus/missions/${(await res.json()).data.missionId}`, {
      headers: { 'x-council-key': 'test-key-council' },
    })).json();
    expect(state.data.models).toEqual(COUNCIL);
  });

  it('invalid model slug → 400', async () => {
    const port = await boot(4632);
    const res = await call(port, { goal: 'g', models: ['totally invalid slug'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid model slug/i);
  });

  it('unknown preset name → 400', async () => {
    const port = await boot(4633);
    const res = await call(port, { goal: 'g', models: 'not-a-preset' });
    expect(res.status).toBe(400);
  });
});
