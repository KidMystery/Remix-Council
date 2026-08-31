import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { startServer } = await import('../../../server');

/**
 * Oracle server persistence routes (Phase 2).
 *
 * Every test boots the real server with ORACLE_DATA_DIR pointed at a fresh
 * tmp dir — no writes to the repo's real data/ directory.
 */

describe('Oracle server persistence routes', () => {
  let activeServer: http.Server | null = null;
  let dataDir = '';
  const prevKey = process.env.COUNCIL_ACCESS_KEY;
  const prevDataDir = process.env.ORACLE_DATA_DIR;

  beforeEach(() => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-456';
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-store-test-'));
    process.env.ORACLE_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
    if (prevKey === undefined) delete process.env.COUNCIL_ACCESS_KEY;
    else process.env.COUNCIL_ACCESS_KEY = prevKey;
    if (prevDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
    else process.env.ORACLE_DATA_DIR = prevDataDir;
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const boot = async (port: number) => {
    process.env.NODE_ENV = 'production';
    const started = await startServer(port);
    activeServer = started.server;
    return started.port;
  };

  const req = (
    port: number,
    method: 'GET' | 'POST',
    urlPath: string,
    body?: unknown,
    key = 'test-key-456'
  ) =>
    fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-council-key': key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const mkThread = (id: string, updatedAt: number, title = 'T') => ({
    id,
    title,
    createdAt: updatedAt - 1000,
    updatedAt,
    model: 'google/gemini-2.5-flash',
    reflectEnabled: true,
    webEnabled: true,
    rotateVoices: true,
    rotateVoiceModels: false,
    turnCount: 0,
    messages: [],
    bible: { content: '', updatedAt },
  });

  it('GET /api/oracle/bible returns empty bible on fresh store', async () => {
    const port = await boot(4601);
    const res = await req(port, 'GET', '/api/oracle/bible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content).toBe('');
    expect(typeof body.data.updatedAt).toBe('number');
  });

  it('GET /api/oracle/threads lists threads', async () => {
    const port = await boot(4602);
    await req(port, 'POST', '/api/oracle/entries', { text: 'hello world' });
    const res = await req(port, 'GET', '/api/oracle/threads');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].messages[0].content).toBe('hello world');
  });

  it('GET /api/oracle/threads/:id returns thread or 404', async () => {
    const port = await boot(4603);
    const created = await (await req(port, 'POST', '/api/oracle/entries', { text: 'note' })).json();
    const id = created.data.id;
    const got = await req(port, 'GET', `/api/oracle/threads/${id}`);
    expect(got.status).toBe(200);
    expect((await got.json()).data.id).toBe(id);
    const missing = await req(port, 'GET', '/api/oracle/threads/nope');
    expect(missing.status).toBe(404);
  });

  it('POST /api/oracle/entries appends to existing thread when threadId given', async () => {
    const port = await boot(4604);
    const first = await (await req(port, 'POST', '/api/oracle/entries', { text: 'one' })).json();
    const id = first.data.id;
    const second = await req(port, 'POST', '/api/oracle/entries', { threadId: id, text: 'two', ts: 123 });
    expect(second.status).toBe(201);
    const data = (await second.json()).data;
    expect(data.id).toBe(id);
    expect(data.messages.length).toBe(2);
    expect(data.messages[1].content).toBe('two');
    expect(data.messages[1].timestamp).toBe(123);
    // persisted to disk
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'threads.json'), 'utf8'));
    expect(onDisk.length).toBe(1);
    expect(onDisk[0].messages.length).toBe(2);
  });

  it('POST /api/oracle/entries malformed body → 400', async () => {
    const port = await boot(4605);
    expect((await req(port, 'POST', '/api/oracle/entries', {})).status).toBe(400);
    expect((await req(port, 'POST', '/api/oracle/entries', { text: '' })).status).toBe(400);
    expect((await req(port, 'POST', '/api/oracle/entries', { text: 'x', threadId: 5 })).status).toBe(400);
    expect((await req(port, 'POST', '/api/oracle/entries', { text: 'x', ts: 'no' })).status).toBe(400);
  });

  it('POST /api/oracle/sync merges by id, newer updatedAt wins', async () => {
    const port = await boot(4606);
    // Server-side thread A (old)
    await req(port, 'POST', '/api/oracle/entries', { text: 'server entry' });
    // Browser export: newer copy of thread A + brand-new thread B
    const serverThreads = (await (await req(port, 'GET', '/api/oracle/threads')).json()).data;
    const newerA = {
      ...serverThreads[0],
      title: 'Updated by browser',
      updatedAt: serverThreads[0].updatedAt + 5000,
    };
    const res = await req(port, 'POST', '/api/oracle/sync', {
      threads: [newerA, mkThread('oracle_B', 111)],
      bible: { content: '## Admitted Fact\n- Law one', updatedAt: Date.now() + 1000 },
    });
    expect(res.status).toBe(200);
    const merged = (await res.json()).data;
    expect(merged.threads.find((t: any) => t.id === serverThreads[0].id).title).toBe('Updated by browser');
    expect(merged.threads.find((t: any) => t.id === 'oracle_B')).toBeTruthy();
    expect(merged.bible.content).toContain('Law one');
    // Older incoming copy does NOT overwrite newer server copy
    const older = { ...newerA, title: 'Older copy', updatedAt: 1 };
    const res2 = await req(port, 'POST', '/api/oracle/sync', { threads: [older] });
    const merged2 = (await res2.json()).data;
    expect(merged2.threads.find((t: any) => t.id === newerA.id).title).toBe('Updated by browser');
  });

  it('POST /api/oracle/sync malformed body → 400', async () => {
    const port = await boot(4607);
    expect((await req(port, 'POST', '/api/oracle/sync', {})).status).toBe(400);
    expect((await req(port, 'POST', '/api/oracle/sync', { threads: 'nope' })).status).toBe(400);
    expect((await req(port, 'POST', '/api/oracle/sync', { threads: [], bible: 'str' })).status).toBe(400);
  });

  it('all oracle routes fail closed without key → 503, wrong key → 401', async () => {
    delete process.env.COUNCIL_ACCESS_KEY;
    const port = await boot(4608);
    for (const [m, p] of [
      ['GET', '/api/oracle/bible'],
      ['GET', '/api/oracle/threads'],
      ['GET', '/api/oracle/threads/x'],
      ['POST', '/api/oracle/entries'],
      ['POST', '/api/oracle/sync'],
    ] as const) {
      const res = await req(port, m, p, m === 'POST' ? {} : undefined);
      expect(res.status, `${m} ${p}`).toBe(503);
    }
  });

  it('wrong council key → 401 on gated oracle routes', async () => {
    const port = await boot(4610);
    const res = await req(port, 'GET', '/api/oracle/threads', undefined, 'wrong-key');
    expect(res.status).toBe(401);
    const res2 = await req(port, 'POST', '/api/oracle/entries', { text: 'x' }, 'wrong-key');
    expect(res2.status).toBe(401);
  });

  it('no writes leak to the real data/ dir', async () => {
    const port = await boot(4609);
    await req(port, 'POST', '/api/oracle/entries', { text: 'isolation check' });
    expect(fs.existsSync(path.join(dataDir, 'threads.json'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'data', 'oracle', 'threads.json'))).toBe(false);
  });
});
