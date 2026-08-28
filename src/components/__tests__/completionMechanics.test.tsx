// @vitest-environment jsdom
import './setupDom'; // jsdom polyfills must load before pdfjs-dist evaluates
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

import { CouncilChamber } from '../CouncilChamber';
import { INITIAL_PERSONAS, defaultSynthesizer } from '../../data';
import type { CouncilRound, Persona } from '../../types';

/**
 * COMPLETION MECHANICS — end-to-end, through the REAL component.
 *
 * The operator's report: "nothing is completing." The docket rules (pure,
 * unit-tested in evidence.test.ts) say a round stamps COMPLETED when every
 * blocker is closed. This test exercises the WIRING around those rules:
 * press Deliberate with a healthy network (server proxy + models all
 * answering) and the round MUST end STAMPED — every seat completed,
 * synthesis written, `stamp === 'completed'`, `blockers === []`.
 *
 * It fails (red) when any link in the chain breaks — a seat that errors,
 * a stage that never runs, a stamp that never lands — which is exactly the
 * "rounds never finish" symptom. It does NOT mock any app module: the only
 * mock is the network (fetch), simulating a healthy production server.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A minimal but honest live catalog (the models the default roster parked). */
const CATALOG = [
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 Chat', pricing: { prompt: '0.0000003', completion: '0.0000006', request: '0' }, context_length: 64000, created: 1735689600 },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', pricing: { prompt: '0.0000002', completion: '0.0000002', request: '0' }, context_length: 128000, created: 1735689600 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', pricing: { prompt: '0.00000015', completion: '0.0000006', request: '0' }, context_length: 128000, created: 1735689600 },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', pricing: { prompt: '0.0000003', completion: '0.00000025', request: '0' }, context_length: 1000000, created: 1735689600 },
] as any[];

/**
 * Simulates the production server for one healthy call: SSE frames with
 * delta content, a final usage chunk, and `data: [DONE]` — the same wire
 * shape server.ts relays from OpenRouter.
 */
function healthySse(model: string, text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const frames = [
    `data: ${JSON.stringify({ id: 'gen-1', model, choices: [{ delta: { role: 'assistant', content: text.slice(0, 40) } }] })}\n\n`,
    `data: ${JSON.stringify({ id: 'gen-1', model, choices: [{ delta: { content: text.slice(40) } }] })}\n\n`,
    `data: ${JSON.stringify({ id: 'gen-1', model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 160, total_tokens: 1360 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: any, init: any) => {
    const url = String(input);
    if (url.includes('/api/council/models')) {
      return { ok: true, status: 200, json: async () => ({ data: CATALOG }) } as any;
    }
    if (url.includes('/api/council') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const text = `Healthy reply for ${(body.messages?.[body.messages.length - 1]?.content || '').slice(0, 40)}`;
      return { ok: true, status: 200, body: healthySse(String(body.model), text) } as any;
    }
    return { ok: false, status: 404, json: async () => ({ error: `unmocked URL ${url}` }) } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Auth/token state seeded by the expiry test must not leak into others.
  try {
    localStorage.removeItem('council_google_auth_v2');
    localStorage.removeItem('council-drive-wanted');
  } catch {
    /* non-browser */
  }
  delete (window as any).google;
});

/**
 * Drives the real component: render, type the question, press Deliberate.
 * Captures every round the component hands to the session manager
 * (onUpdateRound / onCompleteRound) — that is the persisted state.
 */
async function runDeliberation(query: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const persisted: CouncilRound[] = [];
  const capture = (sessionId: string, round: CouncilRound) => persisted.push(JSON.parse(JSON.stringify(round)));

  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <CouncilChamber
        personas={INITIAL_PERSONAS as Persona[]}
        synthesizer={defaultSynthesizer as Persona}
        activePresetId="highest_quality"
        rounds={[]}
        activeSessionId="session_test"
        activeSession={null}
        sessions={[]}
        onUpdateRound={capture}
        onCompleteRound={capture}
        flushNow={vi.fn()}
        rawModelsCatalog={CATALOG as any[]}
        executionMode="auto"
        webMode="auto"
        autoSelectModels
        maxTokens={4000}
        quickPanelMaxTokens={350}
        synthesisMaxTokens={500}
        panelTimeoutSeconds={120}
        stopAfterStage1={false}
        maxRoundCostCeiling={0}
        archivistRecentRounds={2}
        disableFallback={false}
        useSingleModelForSimple={false}
      />
    );
  });

  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  expect(textarea, 'composer textarea missing').toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, query);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const submit = Array.from(container.querySelectorAll('button')).find((b) =>
    /Deliberate/.test(b.textContent || '')
  );
  expect(submit, 'Deliberate button missing').toBeTruthy();
  await act(async () => {
    (submit as HTMLButtonElement).click();
  });

  // The run is async: let the stages stream until a terminal stamp or timeout.
  await act(async () => {
    const deadline = Date.now() + 20_000;
    const terminal = () => {
      const last = persisted[persisted.length - 1];
      return last && ['completed', 'blocked', 'failed', 'stopped'].includes(last.stamp || '');
    };
    while (Date.now() < deadline && !terminal()) {
      await sleep(100);
    }
  });

  // De-duplicate by id, keep the latest snapshot of each round.
  const byId = new Map<string, CouncilRound>();
  persisted.forEach((r) => byId.set(r.id, r));
  return { container, rounds: Array.from(byId.values()), captured: persisted.length, root };
}

function describeRound(r: CouncilRound | undefined): string {
  if (!r) return 'no round was ever persisted';
  const s1 = Object.entries(r.deliberation?.stage1 || {});
  const s2 = Object.entries(r.deliberation?.stage2 || {});
  return [
    `stamp=${r.stamp}`,
    `blockers=${JSON.stringify((r.blockers || []).map((b) => b.type))}`,
    `stage1=${s1.map(([id, v]) => `${id}:${v.status}`).join(',') || '(none)'}`,
    `stage2=${s2.map(([id, v]) => `${id}:${v.status}`).join(',') || '(none)'}`,
    `synthesis=${r.synthesis?.status || '(none)'}`,
  ].join(' | ');
}

describe('completion mechanics — a healthy round must stamp COMPLETED', () => {
  it('full council (deep): Stage 1 + Stage 2 + synthesis → STAMPED, zero blockers', async () => {
    const { container, rounds, captured } = await runDeliberation('Should I hire the contractor to fix the porch?');
    expect(captured, 'component never persisted a round').toBeGreaterThan(0);
    const round = rounds[rounds.length - 1];
    expect(
      round?.stamp,
      `round never stamped completed — ${describeRound(round)}\nUI: ${(container.textContent || '').slice(0, 500)}`
    ).toBe('completed');
    expect(round?.blockers || [], 'open blockers prevent the stamp').toEqual([]);
    const activeIds = INITIAL_PERSONAS.filter((p) => p.enabled !== false).map((p) => p.id);
    for (const id of activeIds) {
      expect(round?.deliberation?.stage1?.[id]?.status, `Stage 1 seat ${id}`).toBe('completed');
      expect(round?.deliberation?.stage2?.[id]?.status, `Stage 2 seat ${id}`).toBe('completed');
    }
    expect(round?.synthesis?.status, 'Chair synthesis never completed').toBe('completed');
    expect(round?.synthesis?.content, 'synthesis content missing').toBeTruthy();
  }, 30_000);

  it('quick panel (simple question): single pass + synthesis → STAMPED, zero blockers', async () => {
    const { container, rounds, captured } = await runDeliberation('summarize this email for me');
    expect(captured, 'component never persisted a round').toBeGreaterThan(0);
    const round = rounds[rounds.length - 1];
    expect(
      round?.stamp,
      `round never stamped completed — ${describeRound(round)}\nUI: ${(container.textContent || '').slice(0, 500)}`
    ).toBe('completed');
    expect(round?.blockers || [], 'open blockers prevent the stamp').toEqual([]);
    expect(round?.synthesis?.status, 'Chair synthesis never completed').toBe('completed');
    expect(round?.synthesis?.content, 'synthesis content missing').toBeTruthy();
  }, 30_000);
});

/**
 * "Nothing is completing" — the mid-session token expiry mechanic.
 *
 * The Google access token the browser proves to the owner gate is short-lived
 * (~1 hour). When it expires mid-session:
 *   1. loadStoredAuth() → null (expired), so every /api/council call goes out
 *      WITHOUT x-owner-token.
 *   2. The owner gate (always configured) 401s EVERY model call — every seat,
 *      every fallback candidate — with "Sign in required (owner gate).".
 *   3. Every seat ends status 'error' → partial_panel → NOT STAMPED.
 *   4. The one silent-refresh recovery that exists (withAuthRetry) lives only
 *      on Drive READ/WRITE paths — and those are all gated on
 *      isGoogleSignedIn(), which is exactly FALSE while the token is expired.
 *      So no refresh, no amber banner: a silent, total lockout until the
 *      operator happens to reload the page (trySilentDriveRestore).
 *
 * The mechanic being pinned: a 401 from the owner gate on a model call must
 * trigger ONE silent refresh (prompt: 'none', never a popup) + ONE retry —
 * the same recovery the Drive path already has — so the round still completes.
 * While the fix is missing this test is RED: the round ends 'blocked'.
 */
describe('completion mechanics — expired owner token must not lock out completion', () => {
  const FRESH_TOKEN = 'fresh-gis-token';

  function seedExpiredAuth() {
    localStorage.setItem(
      'council_google_auth_v2',
      JSON.stringify({
        token: 'stale-gis-token',
        email: 'kamau.asphall@gmail.com',
        expiresAt: Date.now() - 60_000, // expired one minute ago
      })
    );
    localStorage.setItem('council-drive-wanted', '1');
  }

  function installGisMock() {
    const gis = { silentRequests: 0, lastPrompt: undefined as string | undefined };
    (window as any).google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }: any) => ({
            requestAccessToken: (opts: any) => {
              gis.silentRequests++;
              gis.lastPrompt = opts?.prompt;
              callback({ access_token: FRESH_TOKEN, expires_in: 3599 });
            },
          }),
        },
      },
    };
    return gis;
  }

  it('one silent refresh + retry keeps the round completable when the token has expired', async () => {
    seedExpiredAuth();
    const gis = installGisMock();

    // Same fetch mock as the healthy tests, PLUS the owner gate: requests
    // without the FRESH token get exactly what the server returns.
    const seenOwnerTokens: Array<string | null> = [];
    const gateFetch = vi.fn(async (input: any, init: any) => {
      const url = String(input);
      const headers: Record<string, string> = (init?.headers || {}) as Record<string, string>;
      if (url.includes('/api/council/models')) {
        return { ok: true, status: 200, json: async () => ({ data: CATALOG }) } as any;
      }
      if (url.includes('googleapis.com/drive/v3/about')) {
        return { ok: true, status: 200, json: async () => ({ user: { emailAddress: 'kamau.asphall@gmail.com' } }) } as any;
      }
      if (url.includes('/api/council') && init?.method === 'POST') {
        seenOwnerTokens.push(headers['x-owner-token'] || null);
        if ((headers['x-owner-token'] || '') !== FRESH_TOKEN) {
          // Exact server body for the owner gate.
          return { ok: false, status: 401, json: async () => ({ error: 'Sign in required (owner gate).' }) } as any;
        }
        const body = JSON.parse(String(init.body));
        const text = `Healthy reply for ${(body.messages?.[body.messages.length - 1]?.content || '').slice(0, 40)}`;
        return { ok: true, status: 200, body: healthySse(String(body.model), text) } as any;
      }
      return { ok: false, status: 404, json: async () => ({ error: `unmocked URL ${url}` }) } as any;
    });
    vi.stubGlobal('fetch', gateFetch);

    const { container, rounds, captured } = await runDeliberation('Should I hire the contractor to fix the porch?');
    const round = rounds[rounds.length - 1];

    expect(captured, 'component never persisted a round').toBeGreaterThan(0);
    expect(
      round?.stamp,
      `expired owner token locked out completion — ${describeRound(round)}\n` +
        `silent GIS refreshes attempted: ${gis.silentRequests} (last prompt: ${String(gis.lastPrompt)})\n` +
        `owner tokens seen by the server: ${JSON.stringify([...new Set(seenOwnerTokens)])}\n` +
        `UI: ${(container.textContent || '').slice(0, 500)}`
    ).toBe('completed');
    expect(round?.blockers || [], 'open blockers prevent the stamp').toEqual([]);
    // The recovery must be the silent one — never a popup, at most once per 401 storm.
    expect(gis.silentRequests, 'expected a silent refresh (prompt none), never a picker').toBeGreaterThan(0);
    expect(gis.lastPrompt, 'recovery must be silent (prompt none) — no account picker').toBe('none');
    expect(
      seenOwnerTokens.includes(FRESH_TOKEN),
      'a retried call must carry the refreshed token'
    ).toBe(true);
  }, 30_000);
});
