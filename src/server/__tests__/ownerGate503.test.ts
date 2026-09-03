import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { startServer } from '../../../server';

/**
 * Integration tests for the owner-gate fail-closed hardening (Hermes bridge):
 * with NO council key configured, gated endpoints must return 503
 * ("server auth not configured") instead of the old dev-mode open door.
 * With a key configured, the existing 401 (bad/missing key) path is unchanged.
 */
describe('owner gate fail-closed (503 when auth unconfigured)', () => {
  let activeServer: http.Server | null = null;
  const prevKey = process.env.COUNCIL_ACCESS_KEY;
  const prevSecret = process.env.COUNCIL_ACCESS_SECRET;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
    process.env.COUNCIL_ACCESS_KEY = prevKey;
    process.env.COUNCIL_ACCESS_SECRET = prevSecret;
    process.env.NODE_ENV = prevNodeEnv;
  });

  const boot = async (port: number) => {
    // production mode skips the vite dev middleware inside startServer
    process.env.NODE_ENV = 'production';
    const started = await startServer(port);
    activeServer = started.server;
    return started.port;
  };

  it('unconfigured key → gated endpoint returns 503 with clear message', async () => {
    delete process.env.COUNCIL_ACCESS_KEY;
    delete process.env.COUNCIL_ACCESS_SECRET;
    const port = await boot(4691);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent`, { method: 'POST' });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(String(body.error)).toMatch(/auth not configured/i);
  });

  it('configured key → 401 path unchanged for missing/wrong key (not 503)', async () => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-123';
    const port = await boot(4692);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('configured key + correct x-council-key passes the gate (reaches handler)', async () => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-123';
    const port = await boot(4693);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent`, {
      method: 'POST',
      headers: { 'x-council-key': 'test-key-123', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Gate passed — the handler itself rejects the empty spec with 400.
    expect(res.status).toBe(400);
  });

  it('configured key + Cookie passes the gate', async () => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-123';
    const port = await boot(4694);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent`, {
      method: 'POST',
      headers: { Cookie: 'council_access_key=test-key-123', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('configured key + Bearer Authorization header passes the gate', async () => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-123';
    const port = await boot(4695);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-key-123', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('configured key + ?key= query parameter passes the gate', async () => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-123';
    const port = await boot(4696);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent?key=test-key-123`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
