import { describe, it, expect } from 'vitest';
import {
  AgentLoopRunner,
  newAgentJobId,
  type AgentJob,
  type AgentLoopDeps,
} from '../agentLoop';
import { validateChunkPayloads, CHUNK_SIZE_CAP_CHARS } from '../../lib/chunkAssembly';
import { splitContent, chunkDocuments } from '../../lib/documentChunker';

const CATALOG = [
  { id: 'google/gemini-2.5-flash', pricing: { prompt: '0', completion: '0' } },
];

function makeRunner(handler: (body: any) => any): { runner: AgentLoopRunner; calls: any[] } {
  const calls: any[] = [];
  const fetchFn = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return { ok: true, status: 200, json: async () => handler(body) } as unknown as Response;
  }) as unknown as typeof fetch;
  const deps: AgentLoopDeps = {
    fetchFn,
    catalog: () => CATALOG,
    openRouterKey: () => 'sk-or-test',
    defaultModel: () => 'google/gemini-2.5-flash',
    defaultMaxJobCostUSD: () => 2.0,
    sleep: async () => {},
  };
  return { runner: new AgentLoopRunner(deps, ''), calls };
}

function nexusJob(): AgentJob {
  return {
    id: newAgentJobId(),
    spec: {
      goal: 'FINANCIAL UNTANGLING v9 — verdict + debt table + income-vs-spend + phased plan + odds.',
      mode: 'nexus',
      budget: 'free',
      maxResearchQueries: 0,
      maxDeliberationPasses: 3,
      maxJobCostUSD: 2,
    },
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

const PLAN_OK = { choices: [{ message: { content: '```json\n{"summary":"s","steps":[],"research_queries":[]}\n```' } }], usage: {} };
const READ_OK = { choices: [{ message: { content: 'Balances: checking $5,067.39; card balances inferred from payments.' } }], usage: {} };
const DELIB_OK = {
  choices: [{ message: { content: '```json\n{"agreementScore": 88, "changedFromPrevious": ""}\n```\nVERDICT: (a) yes, (b) yes, (c) yes.' } }],
  usage: {},
};
const FINAL_OK = {
  choices: [{ message: { content: '## Verdict\nyes/yes/yes.\n## 1. Debt Inventory\n(table)\n## 2. Income vs Spend per month\n(net +$900)\n## 3. Phased plan\n(4 phases)\n## 4. Odds\n70%\n## Sources\nnone' } }],
  usage: {},
};

describe('v9: finalize output budget', () => {
  it('requests >= 4000 output tokens on nexus finalize and logs the budget on the job', async () => {
    const { runner, calls } = makeRunner((body) => {
      if (body.messages.some((m: any) => /PLANNING phase/.test(m.content))) return PLAN_OK;
      if (body.messages.some((m: any) => /DELIBERATION phase/.test(m.content))) return DELIB_OK;
      if (body.messages.some((m: any) => /FINALIZE phase/.test(m.content))) return FINAL_OK;
      return { choices: [{ message: { content: 'ok' } }], usage: {} };
    });
    const result = await runner.run(nexusJob());
    expect(result.succeeded).toBe(true);
    const finalizeCalls = calls.filter((c) => c.messages.some((m: any) => /FINALIZE phase/.test(m.content)));
    expect(finalizeCalls.length).toBe(1);
    expect(finalizeCalls[0].max_tokens).toBeGreaterThanOrEqual(4000);
    // verdict-first scaffold present so truncation keeps the verdict early
    expect(finalizeCalls[0].messages[0].content).toMatch(/VERDICT FIRST/);
    expect(result.job.outputTokenBudget).toBeGreaterThanOrEqual(4000);
    expect(result.job.verdict).toMatch(/## Verdict/);
  });

  it('multi-section finalize prompt lists every required section', async () => {
    let finalizeSystem = '';
    const { runner } = makeRunner((body) => {
      if (body.messages.some((m: any) => /PLANNING phase/.test(m.content))) return PLAN_OK;
      if (body.messages.some((m: any) => /DELIBERATION phase/.test(m.content))) return DELIB_OK;
      if (body.messages.some((m: any) => /FINALIZE phase/.test(m.content))) {
        finalizeSystem = body.messages[0].content;
        return FINAL_OK;
      }
      return { choices: [{ message: { content: 'ok' } }], usage: {} };
    });
    await runner.run(nexusJob());
    for (const section of ['## Verdict', '## Confidence', '## Sources']) {
      expect(finalizeSystem).toContain(section);
    }
  });
});

// ---- (b) A/B/C chunk payload assembly validation ----

/** Mirrors v8 mission A structure: balances + month-end balances + two prose docs + Jul/Aug tx. */
function payloadA(): { sourceName: string; index: number; total: number; content: string }[] {
  const bal = 'Date,Balance,Account\n8/31/2026,"$5,067.39",SIMPLY RIGHT CHECKING - *7343\n8/31/2026,"$1,900.00",CREDIT CARD (...0837)\n';
  const monthends = 'Date,Balance,Account\n' + Array.from({ length: 50 }, (_, i) => `2026-0${(i % 8) + 1}-28,"$4,50${i % 10}.00",ACCT *7343`).join('\n') + '\n';
  const ref = 'Financial Reference July 2026\n\nIncome: $4,200/mo. Rent $1,450.\n';
  const plan = 'THE ACTUAL PLAN (Aug 2026)\n\nSlow fuel. Kill the 29% APR first.\n';
  const txJul = 'Date,Merchant,Category,Account,Amount\n' + Array.from({ length: 40 }, (_, i) => `2026-07-${String((i % 28) + 1).padStart(2, '0')},Merchant ${i},Groceries,CREDIT CARD (...0837),-${(i + 1) * 3}.50`).join('\n') + '\n';
  const txAug = 'Date,Merchant,Category,Account,Amount\n2026-08-01,Costco,Groceries,CREDIT CARD (...4504),-86.20\n';
  return [
    { sourceName: 'uploaded-exhibit.csv', index: 0, total: 2, content: `===== bal_831.csv =====\n${bal}\n===== bal_monthends.csv =====\n${monthends}\n===== Financial_Reference_July2026.txt =====\n${ref}\n===== the_actual_plan_aug2026.txt =====\n${plan}` },
    { sourceName: 'uploaded-exhibit.csv', index: 1, total: 2, content: `===== tx_2026-07.csv =====\n${txJul}\n===== tx_2026-08.csv =====\n${txAug}` },
  ];
}

/** Mirrors v8 mission B structure: three tx month CSVs, Jan–Mar. */
function payloadB() {
  const mk = (m: number, n: number) =>
    'Date,Merchant,Category,Account,Amount\n' +
    Array.from({ length: n }, (_, i) => `2026-0${m}-1${i % 9},"Trader Joe's",Groceries,CREDIT CARD (...4504),-${(i + 1) * 2}.25`).join('\n') + '\n';
  return [
    { sourceName: 'uploaded-exhibit.csv', index: 0, total: 2, content: `===== tx_2026-01.csv =====\n${mk(1, 30)}\n===== tx_2026-02.csv =====\n${mk(2, 25)}` },
    { sourceName: 'uploaded-exhibit.csv', index: 1, total: 2, content: `===== tx_2026-03.csv =====\n${mk(3, 28)}` },
  ];
}

/** Mirrors v8 mission C structure: three tx month CSVs, Apr–Jun (the one that succeeded). */
function payloadC() {
  const mk = (m: number, n: number) =>
    'Date,Merchant,Category,Account,Amount\n' +
    Array.from({ length: n }, (_, i) => `2026-0${m}-0${(i % 9) + 1},Walgreens,Medical,Discover it Card (...XXXX),-${(i + 1) * 4}.10`).join('\n') + '\n';
  return [
    { sourceName: 'uploaded-exhibit.csv', index: 0, total: 2, content: `===== tx_2026-04.csv =====\n${mk(4, 30)}\n===== tx_2026-05.csv =====\n${mk(5, 26)}` },
    { sourceName: 'uploaded-exhibit.csv', index: 1, total: 2, content: `===== tx_2026-06.csv =====\n${mk(6, 31)}` },
  ];
}

describe('v9: chunk payload assembly validation (A/B pass the same gate as C)', () => {
  it('A-style, B-style and C-style payloads all pass the identical assembly validation', () => {
    for (const payload of [payloadA(), payloadB(), payloadC()]) {
      const check = validateChunkPayloads(payload);
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.chunks).toBe(2);
        expect(check.totalChars).toBeGreaterThan(0);
      }
    }
  });

  it('rejects an empty chunk, an over-cap chunk, and forbidden control characters', () => {
    const empty = validateChunkPayloads([{ sourceName: 'x', index: 0, total: 1, content: '   \n  ' }]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/EMPTY/i);

    const oversize = validateChunkPayloads([
      { sourceName: 'x', index: 0, total: 1, content: 'a'.repeat(CHUNK_SIZE_CAP_CHARS + 1) },
    ]);
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) expect(oversize.error).toMatch(/assembly cap/);

    const ctrl = validateChunkPayloads([{ sourceName: 'x', index: 0, total: 1, content: 'row1\nrow\u0000bad' }]);
    expect(ctrl.ok).toBe(false);
    if (!ctrl.ok) expect(ctrl.error).toMatch(/control character/);

    const zero = validateChunkPayloads([]);
    expect(zero.ok).toBe(false);
  });
});

// ---- (c) no produced chunk exceeds the size cap ----

describe('v9: chunker never emits an over-cap chunk', () => {
  it('splitContent and chunkDocuments keep every chunk under the assembly cap', () => {
    const big = Array.from({ length: 40_000 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')},Merchant ${i},Groceries,ACCT,-${i}.00`).join('\n');
    expect(big.length).toBeGreaterThan(CHUNK_SIZE_CAP_CHARS);

    const parts = splitContent(big, 60_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(60_000);

    const plan = chunkDocuments([{ name: 'uploaded-exhibit.csv', content: big }], { pagesPerChunk: 20 });
    for (const c of plan.chunks) {
      expect(c.chars).toBeLessThanOrEqual(CHUNK_SIZE_CAP_CHARS);
      const check = validateChunkPayloads([{ sourceName: c.sourceName, index: c.index, total: c.total, content: c.content }]);
      expect(check.ok).toBe(true);
    }
  });
});
