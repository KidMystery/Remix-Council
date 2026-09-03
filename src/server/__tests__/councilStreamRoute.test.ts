import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import http from 'http';
import { Readable } from 'stream';

const { startServer } = await import('../../../server');

describe('/api/council streaming and non-streaming fallback handling', () => {
  let activeServer: http.Server | null = null;
  const prevKey = process.env.COUNCIL_ACCESS_KEY;
  const prevOrKey = process.env.OPENROUTER_API_KEY;
  const prevNodeEnv = process.env.NODE_ENV;
  const realFetch = globalThis.fetch;

  let capturedUpstreamPayloads: any[] = [];
  let upstreamResponseFactory: () => Response = () =>
    new Response('{"id":"1","choices":[{"message":{"content":"ok"}}]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    process.env.COUNCIL_ACCESS_KEY = 'test-key-council';
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    capturedUpstreamPayloads = [];

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('127.0.0.1') || url.includes('localhost')) {
        return realFetch(input, init);
      }
      if (url.includes('openrouter.ai/api/v1/chat/completions')) {
        if (init?.body) {
          try {
            capturedUpstreamPayloads.push(JSON.parse(init.body));
          } catch {
            capturedUpstreamPayloads.push(init.body);
          }
        }
        return upstreamResponseFactory();
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
    process.env.COUNCIL_ACCESS_KEY = prevKey;
    process.env.OPENROUTER_API_KEY = prevOrKey;
    process.env.NODE_ENV = prevNodeEnv;
  });

  const boot = async (port: number) => {
    process.env.NODE_ENV = 'production';
    const started = await startServer(port);
    activeServer = started.server;
    return started.port;
  };

  const postCouncil = (port: number, body: unknown) =>
    realFetch(`http://127.0.0.1:${port}/api/council`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-council-key': 'test-key-council',
      },
      body: JSON.stringify(body),
    });

  it('defaults stream to true when omitted, sending stream:true upstream and returning SSE', async () => {
    const sseStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': OPENROUTER PROCESSING\n\n'));
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"gen-1","choices":[{"delta":{"role":"assistant","content":"Hello from stream"}}]}\n\n'
          )
        );
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    upstreamResponseFactory = () =>
      new Response(sseStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });

    const port = await boot(4610);
    const res = await postCouncil(port, {
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      // Note: stream is intentionally omitted
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(capturedUpstreamPayloads.length).toBe(1);
    expect(capturedUpstreamPayloads[0].stream).toBe(true);

    const text = await res.text();
    expect(text).toContain('Hello from stream');
  });

  it('handles SSE comments in non-streaming mode without throwing 502 SyntaxError', async () => {
    const responseBody =
      ': OPENROUTER PROCESSING\n\n{"id":"chatcmpl-test","choices":[{"message":{"role":"assistant","content":"Parsed successfully despite comment"}}]}\n';

    upstreamResponseFactory = () =>
      new Response(responseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });

    const port = await boot(4611);
    const res = await postCouncil(port, {
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'test non streaming with comment' }],
      stream: false,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe('Parsed successfully despite comment');
  });

  it('handles raw SSE chunks in non-streaming mode without throwing 502 SyntaxError', async () => {
    const rawChunks = [
      ': OPENROUTER PROCESSING',
      '',
      'data: {"id":"gen-10","choices":[{"delta":{"role":"assistant","content":"Chunk 1, "}}]}',
      '',
      'data: {"id":"gen-10","choices":[{"delta":{"content":"Chunk 2"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    upstreamResponseFactory = () =>
      new Response(rawChunks, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });

    const port = await boot(4612);
    const res = await postCouncil(port, {
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'test chunk assembly' }],
      stream: false,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe('Chunk 1, Chunk 2');
  });
});
