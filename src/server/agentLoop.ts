/**
 * Server-side Agent Loop — "assess the question, make a plan, research,
 * deliberate, fact-check, then answer."
 *
 * Runs entirely inside the Node server so jobs survive tab closes and even
 * brief Railway restarts (jobs are persisted to disk and re-attachable).
 *
 * Mechanics (all grounded in OpenRouter's documented server tool):
 *  - Planning:   one bounded pass that drafts a plan + research queries.
 *                Exhibits contribute a manifest (names/sizes) — never bodies —
 *                so the planning call stays bounded even for million-char trees.
 *  - Reading:    when exhibits exceed the single-read context cap, every part
 *                (~20-page chunks, same chunker as local Autonomous) is read
 *                in its own pass and distilled into a bounded reading ledger.
 *                Every part is read; none is silently sliced away.
 *  - Research:   per-query passes using the `openrouter:web_search` server
 *                tool — OpenRouter executes the search inside the request and
 *                the model returns synthesized findings + url_citations.
 *  - Deliberate: chair passes; Nexus mode escalates adversarial falsification
 *                pass-by-pass (Night Shift), with server-side pacing.
 *  - Finalize:   a last pass that verifies claims against the collected
 *                citations and writes the final answer + honest confidence.
 *
 * Guardrails (server-enforced, independent of any client bundle):
 *  - Hard per-job cost cap (env AGENT_MAX_JOB_COST_USD, default $2.00) using
 *    REAL usage per call, including web search fees when reported.
 *  - Free budget never upgrades to paid: research tools are skipped entirely
 *    under a strict free budget (same invariant as client web grounding).
 *  - Liveness guard: unknown/delisted models are substituted from the cached
 *    catalog; free mode may only be substituted with zero-cost models.
 *  - Bounded everything: queries, passes, context size, per-call timeouts.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { chunkDocuments } from '../lib/documentChunker';
import { chunkContext } from './exhibitChunking';

export type AgentMode = 'nexus' | 'oracle' | 'chamber';
export type AgentJobStatus =
  | 'planning'
  | 'reading'
  | 'researching'
  | 'deliberating'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'stopped_budget'
  | 'interrupted';

export interface AgentJobSpec {
  goal: string;
  mode: AgentMode;
  /** Optional extra context (Bible excerpts, prior consensus). Capped small. */
  context?: string;
  /**
   * Attached exhibits, read in full. Up to MAX_EXHIBIT_TOTAL_CHARS: small
   * sets ride inline in one read; larger sets are walked part-by-part in a
   * reading phase (same ~20-page chunker as local Autonomous). Never sliced.
   */
  exhibits?: AgentExhibit[];
  model?: string;
  /**
   * Multi-model council: when set (1-8 verified slugs), the deliberation
   * phase runs one pass per model (sequential, same context) followed by a
   * chair/synthesis pass on the first model. When unset, the loop runs
   * maxDeliberationPasses on the single model exactly as before.
   */
  models?: string[];
  /** Allocator task domain hint (e.g. "code") — accepted for bookkeeping. */
  taskType?: string;
  budget?: 'free' | 'cheap' | 'quality';
  /**
   * Chunking strategy for oversized context/exhibits:
   *  auto  — split at natural boundaries automatically (default)
   *  csv-rows — split on CSV row boundaries
   *  none  — legacy behavior (context head-truncated to the cap)
   */
  chunkStrategy?: 'auto' | 'none' | 'csv-rows';
  maxResearchQueries?: number;
  maxDeliberationPasses?: number;
  maxJobCostUSD?: number;
  pacedMinutes?: number;
}

export interface AgentExhibit {
  name: string;
  content: string;
}

/** One part-read of a chunked exhibit, distilled into bounded notes. */
export interface AgentReading {
  label: string;
  sourceName: string;
  section: string;
  notes: string;
}

export interface AgentSource {
  title: string;
  url: string;
}

export interface AgentResearchItem {
  query: string;
  findings: string;
  sources: AgentSource[];
}

export interface AgentPass {
  index: number;
  label: string;
  consensus: string;
  agreementScore?: number;
}

export interface AgentJob {
  id: string;
  spec: AgentJobSpec;
  status: AgentJobStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  plan: { summary: string; steps: string[]; researchQueries: string[] } | null;
  research: AgentResearchItem[];
  readings: AgentReading[];
  passes: AgentPass[];
  verdict: string;
  brief?: string;
  citations: AgentSource[];
  confidence?: string;
  usageUSD: number;
  /** Cumulative token counts (logged even when free-budget zeroes the cost). */
  usageTokens?: { prompt: number; completion: number };
  error?: string;
  progress: { phase: string; detail: string };
  /** Chunking progress (x chunks read of y total) when the docket was split. */
  chunkProgress?: { done: number; total: number };
  /** Total exhibit+context chars the job is working through. */
  totalContextChars?: number;
}

const CALL_TIMEOUT_MS = 110_000;
const MAX_GOAL_CHARS = 4000;
const MAX_CONTEXT_CHARS = 50_000;
/** Exhibits small enough to ride inline in one read (manifest + all bodies). */
const EXHIBIT_INLINE_CHARS = 50_000;
/** Hard honesty caps for attached exhibits — refused, never silently sliced. */
const MAX_EXHIBIT_FILES = 16;
const MAX_EXHIBIT_TOTAL_CHARS = 4_000_000;
/** Mirrors the local Autonomous chunker safety cap. */
const MAX_EXHIBIT_CHUNKS = 60;
/** Reading-note budget: per-part cap and total ledger cap. */
const READING_NOTE_CHARS = 2200;
const READING_LEDGER_CHARS = 45_000;
const MAX_RESEARCH_QUERIES = 6;
const MAX_DELIBERATION_PASSES = 5;
const DEFAULT_MAX_JOB_COST_USD = 2.0;
const MAX_JOBS_STORED = 50;
const ORIGIN_HEADERS = {
  'HTTP-Referer': 'https://ai.studio/build',
  'X-Title': 'AI Council Agent',
};

const WEB_SEARCH_TOOL = {
  type: 'openrouter:web_search',
  parameters: { max_results: 5, search_context_size: 'medium' },
};

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function extractJsonBlock(text: string): Record<string, any> | null {
  const match = (text || '').match(/```json\s*([\s\S]*?)```/) || (text || '').match(/(\{[\s\S]*\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function stripFencedJson(text: string): string {
  return (text || '').replace(/```json\s*([\s\S]*?)```/g, '').trim();
}

const NIGHT_SHIFT_ESCALATION = [
  'the factual claims and cited numbers',
  'the cost, pricing, and estimate assumptions',
  'the failure modes, edge cases, and risks',
  'the overconfident generalizations and unstated assumptions',
  'whether the final recommendation is actually actionable given real constraints',
];

const SYSTEM_PROMPTS: Record<AgentMode, string> = {
  nexus:
    'You are the Presiding Chair of the Nexus Lab. You work the attached exhibits overnight: inventory them, produce a plan from them, then adversarially falsify that plan. Never invent a file that is not in the exhibits. Prefer the exhibits over web memory. Cite passages. Research the web only for gaps the exhibits cannot answer.',
  oracle:
    'You are the Oracle — an ever-loving, dependable companion (a Hal essential / Jarvis ever-loving presence). You plan, research with live citations, and deliver a clear, warm, decisive answer. Be honest about what you verified versus what you inferred.',
  chamber:
    'You are the Executive Analyst of the AI Council Chamber. You plan, research with live citations, deliberate over the strongest arguments on each side, fact-check your own answer, and deliver a decisive verdict with honest confidence.',
};

export interface AgentLoopDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  catalog: () => any[];
  openRouterKey: () => string;
  defaultModel: () => string;
  defaultMaxJobCostUSD: () => number;
}

export interface AgentLoopResult {
  job: AgentJob;
  succeeded: boolean;
}

/**
 * The orchestrator. `runner` holds a `cancel` flag per job; jobs are run
 * fire-and-forget from the route layer while status is persisted to disk
 * after every phase so a restart leaves an honest trail.
 */
export class AgentLoopRunner {
  private cancelled = new Set<string>();
  private jobs = new Map<string, AgentJob>();

  constructor(private deps: AgentLoopDeps, private dataDir: string) {
    this.jobs = this.loadFromDisk();
  }

  get(id: string): AgentJob | undefined {
    return this.jobs.get(id);
  }

  list(): AgentJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.cancelled.add(id);
    job.status = 'cancelled';
    job.updatedAt = Date.now();
    job.progress = { phase: 'cancelled', detail: 'Cancelled by the owner.' };
    this.persist();
    return true;
  }

  private persist(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const file = path.join(this.dataDir, 'agent-jobs.json');
      // Exhibit bodies live only in memory for the running job; disk keeps a
      // redacted placeholder (jobs never resume mid-flight, so nothing is lost).
      fs.writeFileSync(file, JSON.stringify(this.list().slice(0, MAX_JOBS_STORED).map(redactAgentJob)));
    } catch (err) {
      console.warn('[agent] Failed to persist jobs:', (err as any)?.message);
    }
  }

  private loadFromDisk(): Map<string, AgentJob> {
    try {
      const file = path.join(this.dataDir, 'agent-jobs.json');
      if (!fs.existsSync(file)) return new Map();
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) return new Map();
      const map = new Map<string, AgentJob>();
      for (const job of parsed) {
        if (job && typeof job.id === 'string') {
          // A job that was mid-flight when the process died gets an honest
          // terminal state; it can be re-launched but never pretends to be live.
          const midFlight = ['planning', 'reading', 'researching', 'deliberating', 'finalizing'].includes(job.status);
          map.set(job.id, {
            ...job,
            readings: Array.isArray(job.readings) ? job.readings : [],
            ...(midFlight ? { status: 'interrupted', error: 'Server restarted mid-job; re-launch to resume.' } : {}),
          });
        }
      }
      return map;
    } catch (err) {
      console.warn('[agent] Failed to load jobs:', (err as any)?.message);
      return new Map();
    }
  }

  private setPhase(job: AgentJob, phase: AgentJobStatus, detail: string): void {
    job.status = phase;
    job.updatedAt = Date.now();
    job.progress = { phase, detail };
    this.persist();
  }

  /** One chat completion with the web_search server tool available. */
  private async complete(
    job: AgentJob,
    messages: Array<{ role: string; content: string }>,
    opts: { tools?: boolean; temperature?: number; maxTokens?: number; model?: string } = {}
  ): Promise<{ content: string; citations: AgentSource[]; usageUSD: number }> {
    const model = opts.model || job.spec.model || this.deps.defaultModel();
    const key = this.deps.openRouterKey();
    if (!key) throw new Error('OPENROUTER_API_KEY is not configured on the server.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const payload: Record<string, any> = {
        model,
        messages,
        temperature: opts.temperature ?? 0.4,
      };
      if (opts.tools) payload.tools = [WEB_SEARCH_TOOL];
      if (opts.maxTokens) payload.max_tokens = opts.maxTokens;

      const fetchFn = this.deps.fetchFn || fetch;
      const resp = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...ORIGIN_HEADERS,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `OpenRouter HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const message = data?.choices?.[0]?.message || {};
      const content = String(message.content || '');

      const citations: AgentSource[] = [];
      for (const ann of data?.annotations || message.annotations || []) {
        if ((ann.type === 'url_citation' || ann.type === 'web_citation') && ann.url) {
          citations.push({ title: ann.title || ann.url, url: ann.url });
        }
      }

      const usage = data?.usage || {};
      const rates = this.ratesFor(model);
      const promptTokens = Number(usage.prompt_tokens) || 0;
      const completionTokens = Number(usage.completion_tokens) || 0;
      if (promptTokens > 0 || completionTokens > 0) {
        job.usageTokens = {
          prompt: (job.usageTokens?.prompt || 0) + promptTokens,
          completion: (job.usageTokens?.completion || 0) + completionTokens,
        };
      }
      // Free-budget invariant: a :free model under budget:'free' never logs a
      // token cost — but the token counts above are still recorded/logged for
      // visibility.
      const freeBudget = job.spec.budget === 'free' && model.toLowerCase().endsWith(':free');
      if (freeBudget && (promptTokens > 0 || completionTokens > 0)) {
        console.log(`[agent] free-budget ${model}: tokens in=${promptTokens} out=${completionTokens} — cost logged as $0`);
      }
      const tokenCost =
        promptTokens * rates.promptPerM +
        completionTokens * rates.completionPerM;
      const searchCost = Number(usage.web_search_cost || usage.search_cost || 0);
      const usageUSD = freeBudget ? 0 : tokenCost / 1_000_000 + searchCost;

      return { content, citations, usageUSD };
    } finally {
      clearTimeout(timeout);
    }
  }

  private ratesFor(model: string): { promptPerM: number; completionPerM: number } {
    const entry = this.deps.catalog().find((m: any) => String(m?.id || '').toLowerCase() === model.toLowerCase());
    const promptPerM = (Number(entry?.pricing?.prompt) || 0) * 1_000_000;
    const completionPerM = (Number(entry?.pricing?.completion) || 0) * 1_000_000;
    return { promptPerM, completionPerM };
  }

  private spend(job: AgentJob, usageUSD: number): void {
    job.usageUSD += usageUSD;
    job.updatedAt = Date.now();
  }

  private overBudget(job: AgentJob): boolean {
    // Free-budget path: the mission-create guard already rejects paid models,
    // so a :free model under budget:'free' never trips the spend cap.
    if (job.spec.budget === 'free' && String(job.spec.model || '').toLowerCase().endsWith(':free')) return false;
    const cap = job.spec.maxJobCostUSD || this.deps.defaultMaxJobCostUSD();
    return job.usageUSD >= cap;
  }

  /** Public entrypoint — spawns a job and runs it to completion. */
  run(job: AgentJob): Promise<AgentLoopResult> {
    this.jobs.set(job.id, job);
    this.persist();
    return this.execute(job).catch((err: any) => {
      if (this.cancelled.has(job.id)) return { job, succeeded: false };
      job.status = 'failed';
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
      job.progress = { phase: 'failed', detail: job.error || 'failed' };
      this.persist();
      return { job, succeeded: false };
    });
  }

  private async execute(job: AgentJob): Promise<AgentLoopResult> {
    const spec = job.spec;
    const free = spec.budget === 'free';
    const maxQueries = clampInt(spec.maxResearchQueries, 4, 0, MAX_RESEARCH_QUERIES);
    const maxPasses = clampInt(spec.maxDeliberationPasses, 3, 1, MAX_DELIBERATION_PASSES);

    // Resolve model against the live catalog (server-side liveness guard).
    let model = spec.model || this.deps.defaultModel();
    const catalog = this.deps.catalog();
    if (catalog.length > 0 && !catalog.some((m: any) => String(m?.id || '').toLowerCase() === model.toLowerCase())) {
      const fallback = free
        ? catalog.find((m: any) => Number(m?.pricing?.prompt) === 0 && Number(m?.pricing?.completion) === 0)
        : catalog.find((m: any) => String(m?.id || '').startsWith('google/'));
      model = fallback?.id || model;
    }
    job.spec.model = model;

    // Multi-model council: liveness-guard every requested seat. A model that
    // has vanished from the catalog is substituted the same way the single
    // model is (never silently seated dead).
    let council: string[] = [];
    if (Array.isArray(spec.models) && spec.models.length > 0) {
      council = spec.models.map((requested) => {
        if (
          catalog.length === 0 ||
          catalog.some((m: any) => String(m?.id || '').toLowerCase() === requested.toLowerCase())
        ) {
          return requested;
        }
        const fallback = free
          ? catalog.find((m: any) => Number(m?.pricing?.prompt) === 0 && Number(m?.pricing?.completion) === 0)
          : catalog.find((m: any) => String(m?.id || '').startsWith('google/'));
        return fallback?.id || requested;
      });
      job.spec.models = council;
    }

    // ---- 1. Planning ----
    this.setPhase(job, 'planning', spec.mode === 'nexus' ? 'Inventorying exhibits and drafting a plan...' : 'Assessing the question and drafting a plan...');
    const exhibits = Array.isArray(spec.exhibits) ? spec.exhibits.filter((e) => (e.content || '').trim().length > 0) : [];
    const exhibitChars = exhibits.reduce((n, e) => n + e.content.length, 0);
    const manifest = renderExhibitManifest(exhibits);
    // Planning sees the manifest (names/sizes) — never the bodies — so the
    // planning call stays bounded even for a million-char tree.
    const carriedCtx = spec.context ? `\n\n[Provided context]\n${spec.context.slice(0, MAX_CONTEXT_CHARS)}` : '';
    const planCtx = exhibits.length > 0 ? `${carriedCtx}\n\n${manifest}` : carriedCtx;
    let plan: AgentJob['plan'] = { summary: spec.goal.slice(0, 200), steps: [], researchQueries: [] };
    try {
      const planRes = await this.complete(
        job,
        [
          {
            role: 'system',
            content: `${SYSTEM_PROMPTS[spec.mode]}\nYou are in the PLANNING phase. Do not answer the question yet.`,
          },
          {
            role: 'user',
            content: `Task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}${planCtx}\n\nDraft a concise execution plan. Respond ONLY with a fenced JSON block:\n\`\`\`json\n{"summary": "...", "steps": ["..."], "research_queries": ["...", "..."]}\n\`\`\`\nAt most ${maxQueries} research queries, each a precise search phrase. If exhibits are attached, inventory them first and use an empty array unless a fact is missing from the files. If no live research is needed, use an empty array.`,
          },
        ],
        { maxTokens: 900 }
      );
      this.spend(job, planRes.usageUSD);
      if (this.cancelled.has(job.id) || this.overBudget(job)) return this.finishBudgetOrCancel(job);
      const parsed = extractJsonBlock(planRes.content);
      if (parsed) {
        plan = {
          summary: String(parsed.summary || spec.goal.slice(0, 200)).slice(0, 300),
          steps: Array.isArray(parsed.steps) ? parsed.steps.map(String).slice(0, 8) : [],
          researchQueries: Array.isArray(parsed.research_queries)
            ? parsed.research_queries.map(String).filter((q) => q.trim()).slice(0, maxQueries)
            : [],
        };
      } else {
        plan.summary = stripFencedJson(planRes.content).slice(0, 300);
      }
      job.plan = plan;
      this.persist();
    } catch (err: any) {
      // Planning is a nicety, not a blocker — proceed with a default plan.
      console.warn('[agent] Planning failed, continuing with default plan:', err?.message);
      this.setPhase(job, 'researching', 'Planning was unavailable; proceeding straight to research.');
    }

    // ---- 1b. Exhibit reading walk ----
    // Small sets ride inline in a single read. Anything bigger is walked
    // part-by-part — the same ~20-page chunker as local Autonomous — and
    // distilled into a bounded ledger. Every part is read; none is dropped.
    // When chunking is on (default), each part also receives a running
    // summary of everything read before it, so the final synthesis keeps
    // the middle data that plain truncation used to destroy.
    const chunkingOn = (spec.chunkStrategy ?? 'auto') !== 'none';
    let contextChunks: ReturnType<typeof chunkContext> = [];
    if (chunkingOn && spec.context && spec.context.length > MAX_CONTEXT_CHARS) {
      contextChunks = chunkContext(spec.context, { strategy: spec.chunkStrategy });
    }
    let evidenceBlock = '';
        // Walk when there are exhibits OR when the context itself was chunked —
        // context-only missions must still deliver every chunk body (a bare
        // `exhibits.length > 0` gate dropped chunk bodies and left deliberation
        // reading only the first 50k head, i.e. headers with zero rows).
        if (exhibits.length > 0 || contextChunks.length > 0) {
          if (exhibitChars <= EXHIBIT_INLINE_CHARS && contextChunks.length === 0) {
        evidenceBlock =
          `\n\n[Attached exhibits]\n${manifest}\n\n` +
          exhibits.map((e) => `--- File: ${e.name} ---\n${e.content}`).join('\n\n');
      } else {
        const parts: Array<{ sourceName: string; index: number; total: number; content: string; estimatedPages: number }> = [];
        for (const c of contextChunks) {
          parts.push({ sourceName: 'context', index: c.index, total: c.total, content: c.content, estimatedPages: Math.max(1, Math.round(c.content.length / 3000)) });
        }
        if (exhibits.length > 0) {
          const docPlan = chunkDocuments(
            exhibits.map((e) => ({ name: e.name, content: e.content })),
            { pagesPerChunk: 20, maxChunks: MAX_EXHIBIT_CHUNKS }
          );
          for (const c of docPlan.chunks) {
            parts.push({ sourceName: c.sourceName, index: c.index, total: c.total, content: c.content, estimatedPages: c.estimatedPages });
          }
        }
        const chunks = parts;
        const totalParts = chunks.length;
        job.totalContextChars = exhibitChars + (spec.context?.length || 0);
        const noteCap = Math.max(
          600,
          Math.min(READING_NOTE_CHARS, Math.floor(READING_LEDGER_CHARS / Math.max(1, chunks.length)))
        );
        let runningSummary = '';
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          if (this.cancelled.has(job.id)) return this.finishBudgetOrCancel(job);
          job.chunkProgress = { done: i, total: totalParts };
          this.setPhase(job, 'reading', `Reading exhibit part ${i + 1}/${chunks.length} · ${c.sourceName} section ${c.index + 1}/${c.total} (~${c.estimatedPages} pages)...`);
          try {
            const summaryBlock = runningSummary
              ? `\n\n[Running summary of the parts read so far — keep these facts and build on them, do not repeat them verbatim]\n${runningSummary}`
              : '';
            const res = await this.complete(
              job,
              [
                {
                  role: 'system',
                  content: `${SYSTEM_PROMPTS[spec.mode]}\nYou are in the READING phase. Do not answer the directive yet. Read this one part and report the facts: concrete numbers, definitions, entities, risks, dependencies, and open questions. Quote short key passages verbatim. Never invent a file or fact that is not in this part.`,
                },
                {
                  role: 'user',
                  content: `Directive (context only — do not answer it yet): ${spec.goal.slice(0, MAX_GOAL_CHARS)}${summaryBlock}\n\n[Exhibit part ${i + 1} of ${chunks.length} — ${c.sourceName}, section ${c.index + 1}/${c.total}, ~${c.estimatedPages} pages]\n${c.content}\n\nReport the facts from this part only. Other parts follow in later passes.`,
                },
              ],
              { maxTokens: 1600 }
            );
            this.spend(job, res.usageUSD);
            if (this.overBudget(job)) return this.finishBudgetOrCancel(job);
            job.readings.push({
              label: `Part ${i + 1}/${totalParts}`,
              sourceName: c.sourceName,
              section: `${c.index + 1}/${c.total}`,
              notes: stripFencedJson(res.content).slice(0, noteCap),
            });
            runningSummary = [runningSummary, `${c.sourceName} (part ${i + 1}/${totalParts}): ${stripFencedJson(res.content).slice(0, 600)}`].filter(Boolean).join('\n');
            job.chunkProgress = { done: i + 1, total: totalParts };
            this.persist();
          } catch (err: any) {
            job.readings.push({
              label: `Part ${i + 1}/${totalParts}`,
              sourceName: c.sourceName,
              section: `${c.index + 1}/${c.total}`,
              notes: `[Reading failed: ${err?.message}]`,
            });
            this.persist();
          }
        }
        if (job.readings.length > 0 && job.readings.every((r) => r.notes.startsWith('[Reading failed'))) {
          job.status = 'failed';
          job.error = 'Exhibits were attached but every part failed to read upstream. No verdict was stamped.';
          job.updatedAt = Date.now();
          job.finishedAt = Date.now();
          job.progress = { phase: 'failed', detail: job.error };
          this.persist();
          return { job, succeeded: false };
        }
        // v7 chunk-inline render fix (v6 blocker): deliberation and finalize
        // must SEE the full text of every chunk — headers AND all body rows —
        // not just the distilled reading ledger. The ledger alone left the
        // model without the actual data (v6: it tried to tool-read the
        // attachment; balances/APRs never reached the prompt). Each chunk is
        // already capped at ~100KB by the chunker, so the block stays within
        // the per-chunk budget; the ledger rides after it as a cross-part index.
        evidenceBlock =
          `\n\n[Attached exhibits — FULL text of every part, delivered inline (no attachment-only references)]\n${manifest}\n\n` +
          chunks
            .map(
              (c) =>
                `--- File: ${c.sourceName} — part ${c.index + 1}/${c.total} (full text) ---\n${c.content}`
            )
            .join('\n\n') +
          `\n\n[Exhibit reading ledger — cross-part notes distilled from the full text above]\n` +
          job.readings.map((r) => `### ${r.label} · ${r.sourceName} (section ${r.section})\n${r.notes}`).join('\n\n');
      }
    }
    const baseCtx = carriedCtx + evidenceBlock;

    // ---- 2. Research ----
    const queries = free || maxQueries === 0 ? [] : plan.researchQueries.slice(0, maxQueries);
    if (free) {
      job.progress = { phase: 'researching', detail: 'Strict free budget — web research skipped to prevent tool fees.' };
      this.persist();
    }
    if (queries.length > 0) this.setPhase(job, 'researching', `Researching ${queries.length} question${queries.length === 1 ? '' : 's'}...`);
    const researchContext: string[] = [];
    for (let i = 0; i < queries.length; i++) {
      if (this.cancelled.has(job.id)) return this.finishBudgetOrCancel(job);
      this.setPhase(job, 'researching', `Researching (${i + 1}/${queries.length}): ${queries[i].slice(0, 60)}`);
      try {
        const res = await this.complete(
          job,
          [
            {
              role: 'system',
              content: `${SYSTEM_PROMPTS[spec.mode]}\nYou are in the RESEARCH phase. Use the web_search tool to find current, factual information, then report key facts, figures, and claims with their sources. If a source contradicts another, say so.`,
            },
            {
              role: 'user',
              content: `Research this specific question: ${queries[i]}\nContext of the overall task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}`,
            },
          ],
          { tools: true, maxTokens: 1600 }
        );
        this.spend(job, res.usageUSD);
        if (this.overBudget(job)) return this.finishBudgetOrCancel(job);
        const sources = dedupeSources([...res.citations]);
        job.research.push({ query: queries[i], findings: res.content, sources });
        job.citations = dedupeSources([...job.citations, ...sources]);
        researchContext.push(
          `### Research ${i + 1}: ${queries[i]}\n${res.content}\nSources: ${sources.map((s) => s.url).join(', ') || 'none'}`
        );
        this.persist();
      } catch (err: any) {
        job.research.push({ query: queries[i], findings: `[Research failed: ${err?.message}]`, sources: [] });
        this.persist();
      }
    }

    if (
      queries.length > 0 &&
      job.research.length > 0 &&
      job.research.every((r) => (r.findings || '').startsWith('[Research failed'))
    ) {
      job.status = 'failed';
      job.error = 'Research was requested but every query failed. No verdict was stamped.';
      job.updatedAt = Date.now();
      job.finishedAt = Date.now();
      job.progress = { phase: 'failed', detail: job.error };
      this.persist();
      return { job, succeeded: false };
    }

    // ---- 3. Deliberate ----
    this.setPhase(job, 'deliberating', `Deliberating across ${maxPasses} pass${maxPasses === 1 ? '' : 'es'}...`);
    const researchBlock =
      researchContext.length > 0 ? `\n\n[Research findings with sources]\n${researchContext.join('\n\n')}` : '';
    let previousConsensus = '';
    let previousScore: number | undefined;
    // Council rounds: one pass per requested model, then a chair synthesis
    // pass on the first model. Default path: the existing falsification loop.
    const councilRounds =
      council.length > 1
        ? [
            ...council.map((m, i) => ({ model: m, label: `Council pass ${i + 1} · ${m}` })),
            { model: council[0], label: `Chair synthesis · ${council[0]}` },
          ]
        : null;
    const totalRounds = councilRounds ? councilRounds.length : maxPasses;
    for (let pass = 0; pass < totalRounds; pass++) {
      if (this.cancelled.has(job.id)) return this.finishBudgetOrCancel(job);
      const round = councilRounds ? councilRounds[pass] : null;
      this.setPhase(
        job,
        'deliberating',
        round ? `Council pass ${pass + 1}/${totalRounds} · ${round.model}` : `Deliberation pass ${pass + 1}/${maxPasses}`
      );
      const falsifyBlock =
        pass > 0 && previousConsensus
          ? `\n\n[Self-falsification pass — do NOT repeat the previous consensus]\nPrevious consensus (${previousScore ?? 'unknown'}% agreement):\n${previousConsensus.slice(0, 3000)}\n\n1) Hunt for factual errors, unsupported claims, missing failure modes, overconfidence.\n2) Re-derive any claim you cannot defend from the research; prefer the cited sources.\n3) Only change the verdict where you have substantive justification.\n4) State explicitly what changed versus the previous pass and why.\n5) This pass, concentrate your falsification on: ${NIGHT_SHIFT_ESCALATION[pass % NIGHT_SHIFT_ESCALATION.length]}.`
          : '';
      const system =
        spec.mode === 'nexus'
          ? `${SYSTEM_PROMPTS[spec.mode]}\nYou are in the DELIBERATION phase. Produce the current best consensus. Append exactly one fenced JSON block with keys: agreementScore (integer 0-100), changedFromPrevious (string, or "" on the first pass).`
          : `${SYSTEM_PROMPTS[spec.mode]}\nYou are in the DELIBERATION phase. Produce the current best verdict. Append exactly one fenced JSON block with key: agreementScore (integer 0-100).`;
      try {
        const res = await this.complete(
          job,
          [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `Task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}${baseCtx}${researchBlock}\n${spec.mode === 'nexus' ? `Plan: ${plan.summary}\nSteps: ${plan.steps.join('; ') || 'none'}\n\nPass ${pass + 1} of ${totalRounds}.${falsifyBlock}` : `Plan: ${plan.summary}${falsifyBlock}`}`,
                },
              ],
              { maxTokens: 2200, ...(round ? { model: round.model } : {}) }
              );
        this.spend(job, res.usageUSD);
        if (this.overBudget(job)) return this.finishBudgetOrCancel(job);
        let parsed = extractJsonBlock(res.content);
        let consensus = stripFencedJson(res.content);
        // Empty-consensus guard: a genuinely empty model response must never
        // count as a pass. Retry once with a hard directive; a second empty
        // response fails the job instead of stamping a hollow completion.
        if (!(res.content || '').trim()) {
          this.setPhase(job, 'deliberating', 'Empty response — retrying this pass...');
          this.persist();
          try {
            const retry = await this.complete(
              job,
              [
                { role: 'system', content: system },
                {
                  role: 'user',
                  content: `Task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}${baseCtx}${researchBlock}\\n\\nYour previous response was empty — you MUST output either a verdict or an explicit list of missing data. Do not return an empty message.`,
                },
              ],
              { maxTokens: 2200, ...(round ? { model: round.model } : {}) }
            );
            this.spend(job, retry.usageUSD);
            if (this.overBudget(job)) return this.finishBudgetOrCancel(job);
            parsed = extractJsonBlock(retry.content);
            consensus = stripFencedJson(retry.content);
          } catch {
            consensus = '';
          }
        }
        if (!(consensus || '').trim() && !(res.content || '').trim()) {
          job.status = 'failed';
          job.error = 'Empty consensus: the model returned no verdict even after a retry.';
          job.updatedAt = Date.now();
          job.finishedAt = Date.now();
          job.progress = { phase: 'failed', detail: job.error };
          this.persist();
          return { job, succeeded: false };
        }
        const score = typeof parsed?.agreementScore === 'number' ? clampInt(parsed.agreementScore, 50, 0, 100) : undefined;
        job.passes.push({
          index: pass + 1,
          label: round
            ? round.label
            : spec.mode === 'nexus'
              ? `Falsification pass ${pass + 1}`
              : `Deliberation pass ${pass + 1}`,
          consensus,
          agreementScore: score,
        });
        previousConsensus = consensus;
        previousScore = score;
        this.persist();

        // Server-side pacing (Night Shift) — interruptible, survives tab close.
        const paceMin = councilRounds ? 0 : clampInt(spec.pacedMinutes, 0, 0, 180);
        if (paceMin > 0 && pass < totalRounds - 1) {
          this.setPhase(job, 'deliberating', `Paced ${paceMin} min before the next falsification pass...`);
          const startedAt = (this.deps.now || Date.now)();
          while (!this.cancelled.has(job.id) && (this.deps.now || Date.now)() - startedAt < paceMin * 60_000) {
            await (this.deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(1000);
          }
          if (this.cancelled.has(job.id)) return this.finishBudgetOrCancel(job);
        }
      } catch (err: any) {
        job.passes.push({ index: pass + 1, label: `Deliberation pass ${pass + 1}`, consensus: `[Pass failed: ${err?.message}]` });
        this.persist();
      }
    }

    // A fully broken upstream must not masquerade as a completed job.
    if (job.passes.length === 0 || job.passes.every((p) => p.consensus.startsWith('[Pass failed'))) {
      const firstFailure = job.passes.find((p) => p.consensus.startsWith('[Pass failed'))?.consensus || '';
      job.status = 'failed';
      job.error = `Every deliberation pass failed against the upstream provider. ${firstFailure}`.trim();
      job.updatedAt = Date.now();
      job.finishedAt = Date.now();
      job.progress = { phase: 'failed', detail: job.error };
      this.persist();
      return { job, succeeded: false };
    }

    // ---- 4. Finalize (fact-check + verdict + confidence) ----
    this.setPhase(job, 'finalizing', 'Fact-checking against the research and writing the final verdict...');
    try {
      const finalRes = await this.complete(
        job,
        [
          {
            role: 'system',
            content: `${SYSTEM_PROMPTS[spec.mode]}\nYou are in the FINALIZE phase. Verify the verdict against the exhibits first, then any cited research. Inventing a file is a failure. Output exactly these markdown sections:\n## Verdict\n## What I verified\n## What I could not verify\n## Confidence\n(honest — what supports it, what would raise it; never oversell)${spec.mode === 'nexus' ? '\n## What changed across passes\n(initial consensus -> reversals -> final position, with reasons)' : ''}\nEnd with:\n## Sources\n(only sources actually relied upon)`,
          },
          {
            role: 'user',
            content: `Task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}${baseCtx}\n\nResearch:\n${researchBlock || '(no live research — strict free budget or plan decided none was needed)'}\n\nDeliberation history:\n${job.passes.map((p) => `${p.label} (${p.agreementScore ?? 'n/a'}%): ${stripFencedJson(p.consensus).slice(0, 1500)}`).join('\n\n')}`,
          },
        ],
        { maxTokens: 2400, ...(council.length > 1 ? { model: council[0] } : {}) }
      );
      this.spend(job, finalRes.usageUSD);
      job.verdict = stripFencedJson(finalRes.content);
      job.citations = dedupeSources([...job.citations, ...finalRes.citations]);
      if (spec.mode === 'nexus' && job.passes.length > 1) job.brief = finalRes.content;
      job.confidence = extractConfidence(finalRes.content);
      this.persist();
    } catch (err: any) {
      job.verdict = job.passes[job.passes.length - 1]?.consensus || `[Finalization failed: ${err?.message}]`;
      this.persist();
    }

    job.status = this.overBudget(job) ? 'stopped_budget' : 'done';
    job.finishedAt = Date.now();
    job.updatedAt = Date.now();
    job.progress = { phase: job.status, detail: job.status === 'done' ? 'Complete.' : 'Stopped: job cost cap reached.' };
    this.persist();
    return { job, succeeded: job.status === 'done' };
  }

  private finishBudgetOrCancel(job: AgentJob): AgentLoopResult {
    if (this.cancelled.has(job.id)) {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      job.progress = { phase: 'cancelled', detail: 'Cancelled by the owner.' };
    } else {
      job.status = 'stopped_budget';
      job.finishedAt = Date.now();
      job.verdict = job.verdict || (job.passes[job.passes.length - 1]?.consensus || '');
      job.progress = { phase: 'stopped_budget', detail: `Stopped: job cost cap reached ($${job.usageUSD.toFixed(4)} spent).` };
    }
    job.updatedAt = Date.now();
    this.persist();
    return { job, succeeded: false };
  }
}

function dedupeSources(sources: AgentSource[]): AgentSource[] {
  const seen = new Set<string>();
  const out: AgentSource[] = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push({ title: s.title || s.url, url: s.url });
    }
  }
  return out.slice(0, 30);
}

/** Cover sheet for attached exhibits: names + sizes, never bodies. */
function renderExhibitManifest(exhibits: AgentExhibit[]): string {
  if (exhibits.length === 0) return '';
  const lines = [`EXHIBITS (${exhibits.length} artifact${exhibits.length === 1 ? '' : 's'} attached — read them, do not guess at them)`];
  exhibits.forEach((e, i) => {
    const pages = Math.max(1, Math.round(e.content.length / 3000));
    lines.push(`- ${String.fromCharCode(65 + (i % 26))}. ${e.name} · ${e.content.length.toLocaleString()} chars (~${pages} pages)`);
  });
  return lines.join('\n');
}

/**
 * Copy of a job with exhibit bodies replaced by size placeholders. Used for
 * disk persistence and API responses so million-char trees are never echoed
 * back on every 4-second poll; the full bodies stay in server memory only.
 */
export function redactAgentJob(job: AgentJob): AgentJob {
  if (!job.spec.exhibits || job.spec.exhibits.length === 0) return job;
  return {
    ...job,
    spec: {
      ...job.spec,
      exhibits: job.spec.exhibits.map((e) => ({
        name: e.name,
        content: `[attached to this job — ${e.content.length.toLocaleString()} chars, read server-side]`,
      })),
    },
  };
}

function extractConfidence(finalText: string): string | undefined {
  const match = finalText.match(/## Confidence\s*\n([\s\S]*?)(?=\n## |$)/);
  if (match) return match[1].trim().slice(0, 500);
  return undefined;
}

export function newAgentJobId(): string {
  return `agent_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Exhibits are refused above the honesty caps (files / total chars) — never
 * silently sliced. Empty bodies are dropped; an all-empty docket is refused.
 */
function sanitizeExhibits(raw: any): { exhibits?: AgentExhibit[] } | { error: string } {
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw)) return { error: 'Exhibits must be an array of { name, content } files.' };
  const cleaned: AgentExhibit[] = (raw as any[])
    .filter((e) => e && typeof e === 'object' && typeof e.name === 'string' && typeof e.content === 'string')
    .map((e) => ({ name: (e.name.trim() || 'exhibit').slice(0, 200), content: e.content }))
    .filter((e) => e.content.trim().length > 0);
  if (raw.length > 0 && cleaned.length === 0) {
    return { error: 'Exhibits were attached but every body is empty (blob missing). Re-attach the files.' };
  }
  if (cleaned.length > MAX_EXHIBIT_FILES) {
    return { error: `Too many exhibit files (${cleaned.length}) — the server cap is ${MAX_EXHIBIT_FILES}.` };
  }
  const total = cleaned.reduce((n, e) => n + e.content.length, 0);
  if (total > MAX_EXHIBIT_TOTAL_CHARS) {
    return {
      error: `Exhibits are ${total.toLocaleString()} chars — over the server cap of ${MAX_EXHIBIT_TOTAL_CHARS.toLocaleString()}. Trim the tree or run Autonomous locally.`,
    };
  }
  return cleaned.length > 0 ? { exhibits: cleaned } : {};
}

export function sanitizeAgentSpec(raw: any): AgentJobSpec | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid agent job spec.' };
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
  if (!goal) return { error: 'A goal is required.' };
  if (goal.length > MAX_GOAL_CHARS) return { error: `Goal exceeds ${MAX_GOAL_CHARS} characters.` };
  const mode: AgentMode = raw.mode === 'nexus' || raw.mode === 'oracle' ? raw.mode : 'chamber';
  const context = typeof raw.context === 'string' ? raw.context.slice(0, MAX_CONTEXT_CHARS) : undefined;
  const exhibits = sanitizeExhibits(raw.exhibits);
  if ('error' in exhibits) return { error: exhibits.error };
  const budget = raw.budget === 'free' || raw.budget === 'quality' ? raw.budget : 'cheap';
  const chunkStrategy = raw.chunkStrategy === 'none' || raw.chunkStrategy === 'csv-rows' ? raw.chunkStrategy : undefined;
  const spec: AgentJobSpec = {
    goal,
    mode,
    context,
    ...(exhibits.exhibits ? { exhibits: exhibits.exhibits } : {}),
    budget,
    ...(chunkStrategy ? { chunkStrategy } : {}),
    maxResearchQueries: clampInt(raw.maxResearchQueries, 4, 0, MAX_RESEARCH_QUERIES),
    maxDeliberationPasses: clampInt(raw.maxDeliberationPasses, 3, 1, MAX_DELIBERATION_PASSES),
    pacedMinutes: clampInt(raw.pacedMinutes, 0, 0, 180),
    maxJobCostUSD:
      typeof raw.maxJobCostUSD === 'number' && isFinite(raw.maxJobCostUSD)
        ? Math.min(50, Math.max(0.1, raw.maxJobCostUSD))
        : undefined,
  };
  if (typeof raw.model === 'string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)?$/.test(raw.model)) {
    spec.model = raw.model;
  }
  if (Array.isArray(raw.models)) {
    const models = raw.models.filter(
      (m: unknown): m is string => typeof m === 'string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)?$/.test(m.trim())
    );
    if (models.length > 0 && models.length <= 8 && models.length === raw.models.length) {
      spec.models = models.map((m: string) => m.trim());
    }
  }
  if (typeof raw.taskType === 'string' && raw.taskType.trim()) {
    spec.taskType = raw.taskType.trim().slice(0, 64);
  }
  return spec;
}

export function createAgentRunner(deps: AgentLoopDeps, dataDir: string): AgentLoopRunner {
  return new AgentLoopRunner(deps, dataDir);
}

export { DEFAULT_MAX_JOB_COST_USD };
