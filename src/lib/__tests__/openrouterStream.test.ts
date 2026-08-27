import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamOpenRouterCompletion } from '../openrouter';

/**
 * Regression tests for the wedged-Oracle bug: a stalled SSE stream (upstream
 * sends headers, then nothing — ever) used to leave the reader pending
 * forever, so handleSend's finally never ran and the composer stayed busy
 * on a one-sentence message.
 */

function mockFetchWithStream(frames: string[] | null, opts: { stallForever?: boolean } = {}) {
  return vi.fn(async (_url: any, init: any) => {
    const signal = init?.signal as AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (opts.stallForever) {
          // Never enqueue, never close — but honor the abort signal the way a
          // real fetch body does (error the stream on abort).
          const onAbort = () => controller.error(new DOMException('Aborted', 'AbortError'));
          if (signal) {
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort);
          }
          return;
        }
        const enc = new TextEncoder();
        for (const f of frames as string[]) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    return { ok: true, status: 200, body: stream } as any;
  }) as any;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('streamOpenRouterCompletion stall watchdog', () => {
  it('breaks a never-ending stream with a visible "stalled" error (not a hang, not user-stop)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetchWithStream(null, { stallForever: true }));

    const promise = streamOpenRouterCompletion({
      model: 'test/model',
      messages: [{ role: 'user', content: 'one sentence' }],
    });
    const guarded = promise.catch((e) => e);

    // 120s of silence trips the watchdog.
    await vi.advanceTimersByTimeAsync(120_500);

    const err = await guarded;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/stalled/i);
    expect((err as Error).name).not.toBe('AbortError'); // callers treat AbortError as user-stop
  });

  it('throws the server error frame instead of returning a truncated answer as complete', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchWithStream([
        'data: {"choices":[{"delta":{"content":"partial answer "}}]}\n\n',
        'data: {"error":{"message":"Upstream stream failed mid-response: provider hang"}}\n\n',
      ])
    );
    await expect(
      streamOpenRouterCompletion({ model: 'test/model', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/provider hang/);
  });

  it('still accumulates deltas and completes a healthy stream', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchWithStream([
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const result = await streamOpenRouterCompletion({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.content).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    expect(result.actualModel).toBe('test/model');
  });
});
