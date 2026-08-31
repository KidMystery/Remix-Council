import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'http';
import {
  createWebhookNotifier,
  detectObligation,
  parseObligationHints,
} from '../webhookNotifier';
import { createNexusMissionStore } from '../nexusMissions';

/** Minimal mock agent runner (no real LLM calls) for NexusMissionStore. */
function fakeRunner(status = 'done') {
  const jobs = new Map<string, any>();
  return {
    run(job: any) {
      const done = {
        ...job,
        status,
        passes: [{ label: 'Pass 1', consensus: 'Mock consensus' }],
        verdict: 'Mock verdict',
        usageUSD: 0,
      };
      jobs.set(job.id, done);
      return Promise.resolve({ job: done, succeeded: true });
    },
    cancel(id: string) {
      const job = jobs.get(id);
      if (!job) return false;
      job.status = 'cancelled';
      return true;
    },
    get: (id: string) => jobs.get(id),
    list: () => Array.from(jobs.values()),
  };
}

describe('webhookNotifier', () => {
  let server: http.Server | null = null;
  const received: any[] = [];

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    received.length = 0;
  });

  /** Start a local HTTP receiver that records JSON POST bodies. */
  const startReceiver = () =>
    new Promise<string>((resolve) => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          received.push(JSON.parse(body));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}/hook`);
      });
    });

  const waitFor = async (n: number, ms = 2000) => {
    const deadline = Date.now() + ms;
    while (received.length < n && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return received.length;
  };

  it('delivers a JSON event to the configured endpoint (happy path)', async () => {
    const url = await startReceiver();
    const notifier = createWebhookNotifier(url);
    expect(notifier.enabled).toBe(true);
    notifier.notify({
      event: 'mission_completed',
      missionId: 'nexus_1',
      goal: 'Test goal',
      status: 'complete',
      ts: 123,
      agent: 'hermes',
    });
    expect(await waitFor(1)).toBe(1);
    expect(received[0]).toEqual({
      event: 'mission_completed',
      missionId: 'nexus_1',
      goal: 'Test goal',
      status: 'complete',
      ts: 123,
      agent: 'hermes',
    });
  });

  it('swallows timeouts without throwing', async () => {
    // Endpoint that accepts the connection but never responds.
    let hanging: http.Server | null = null;
    const url = await new Promise<string>((resolve) => {
      hanging = http.createServer(() => {
        /* never respond */
      });
      hanging.listen(0, '127.0.0.1', () => {
        const addr = hanging!.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}/hang`);
      });
    });
    const log = vi.fn();
    const notifier = createWebhookNotifier(url, { log, timeoutMs: 150 });
    notifier.notify({ event: 'oracle_entry_appended', threadId: 't1', agent: 'web', ts: 1 });
    // Must not throw; failure surfaces via log (timeout path) — wait for it.
    const deadline = Date.now() + 2000;
    while (log.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0][1]?.error)).toMatch(/timeout|abort/i);
    hanging!.close();
  });

  it('is fully disabled when the URL is unset', async () => {
    const fetchImpl = vi.fn();
    const notifier = createWebhookNotifier(undefined, { fetchImpl });
    expect(notifier.enabled).toBe(false);
    expect(() =>
      notifier.notify({ event: 'mission_failed', missionId: 'm', goal: 'g', status: 'failed', ts: 1, agent: 'web' })
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('logs failed deliveries (non-2xx) instead of throwing', async () => {
    const log = vi.fn();
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const notifier = createWebhookNotifier('http://example.invalid/hook', { log, fetchImpl });
    notifier.notify({ event: 'oracle_entry_appended', threadId: 't', agent: 'web', ts: 2 });
    const deadline = Date.now() + 2000;
    while (log.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls[0][1]?.status).toBe(500);
  });

  it('detects obligations with the dead-simple patterns', () => {
    expect(detectObligation('obligation: renew license')).toBe(true);
    expect(detectObligation('OBLIGATION: file taxes')).toBe(true);
    expect(detectObligation('note contains TODO: fix later')).toBe(true);
    expect(detectObligation('just a normal entry')).toBe(false);
    expect(detectObligation('')).toBe(false);
  });

  it('lifts due:/action: hints into the obligation payload', () => {
    const hints = parseObligationHints('obligation: renew license due: 2026-09-15 action: visit DMV');
    expect(hints.due).toBe('2026-09-15');
    expect(hints.action).toContain('visit DMV');
    expect(parseObligationHints('plain text').due).toBeUndefined();
  });
});

describe('agent identity persistence (Phase 4)', () => {
  const dataDir = `./.tmp-test-agent-${Date.now()}`;

  it('defaults agent to "web" and stores a custom agent on missions', () => {
    const store = createNexusMissionStore(fakeRunner() as any, dataDir);
    const custom = store.create({ goal: 'Custom agent mission', agent: 'hermes' }) as any;
    expect(custom.agent).toBe('hermes');
    const defaulted = store.create({ goal: 'Web mission' }) as any;
    expect(defaulted.agent).toBe('web');
    expect(store.get(custom.id)?.agent).toBe('hermes');
  });

  it('persists agent on oracle entries (default "web")', async () => {
    const { createOracleServerStore } = await import('../oracleServerStore');
    const dir = `./.tmp-test-oracle-${Date.now()}`;
    const store = createOracleServerStore(dir);
    const custom = store.appendEntry({ text: 'obligation: custom agent entry', agent: 'hermes' });
    const last = custom.messages[custom.messages.length - 1];
    expect(last.agent).toBe('hermes');
    const plain = store.appendEntry({ text: 'plain entry' });
    expect(plain.messages[plain.messages.length - 1].agent).toBe('web');
  });
});
