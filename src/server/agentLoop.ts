/**
 * Server-side Agent Loop — "assess the question, make a plan, research,
 * deliberate, fact-check, then answer."
 *
 * Runs entirely inside the Node server so jobs survive tab closes and even
 * brief Railway restarts (jobs are persisted to disk and re-attachable).
 *
 * Mechanics (all grounded in OpenRouter's documented server tool):
 *  - Planning:   one bounded pass that drafts a plan + research queries.
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

export type AgentMode = 'nexus' | 'oracle' | 'chamber';
export type AgentJobStatus =
  | 'planning'
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
  /** Optional extra context (Bible excerpts, attached files, prior consensus). */
  context?: string;
  model?: string;
  budget?: 'free' | 'cheap' | 'quality';
  maxResearchQueries?: number;
  maxDeliberationPasses?: number;
  maxJobCostUSD?: number;
  pacedMinutes?: number;
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
  passes: AgentPass[];
  verdict: string;
  brief?: string;
  citations: AgentSource[];
  confidence?: string;
  usageUSD: number;
  error?: string;
  progress: { phase: string; detail: string };
}

const CALL_TIMEOUT_MS = 110_000;
const MAX_GOAL_CHARS = 4000;
const MAX_CONTEXT_CHARS = 50_000;
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
    'You are the Presiding Chair of the Nexus Lab — a deliberate, self-falsifying agent. You plan, research with live citations, adversarially test your own consensus across passes, and only then answer. Never present an assumption as a fact. Prefer cited sources over memory.',
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
      fs.writeFileSync(file, JSON.stringify(this.list().slice(0, MAX_JOBS_STORED)));
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
          const midFlight = ['planning', 'researching', 'deliberating', 'finalizing'].includes(job.status);
          map.set(job.id, { ...job, ...(midFlight ? { status: 'interrupted', error: 'Server restarted mid-job; re-launch to resume.' } : {}) });
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
    opts: { tools?: boolean; temperature?: number; maxTokens?: number } = {}
  ): Promise<{ content: string; citations: AgentSource[]; usageUSD: number }> {
    const model = job.spec.model || this.deps.defaultModel();
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
      const tokenCost =
        (Number(usage.prompt_tokens) || 0) * rates.promptPerM +
        (Number(usage.completion_tokens) || 0) * rates.completionPerM;
      const searchCost = Number(usage.web_search_cost || usage.search_cost || 0);
      const usageUSD = tokenCost / 1_000_000 + searchCost;

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
    const maxQueries = clampInt(spec.maxResearchQueries, 4, 1, MAX_RESEARCH_QUERIES);
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

    // ---- 1. Planning ----
    this.setPhase(job, 'planning', 'Assessing the question and drafting a plan...');
    const baseCtx = spec.context ? `\n\n[Provided context]\n${spec.context.slice(0, MAX_CONTEXT_CHARS)}` : '';
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
            content: `Task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}${baseCtx}\n\nDraft a concise execution plan. Respond ONLY with a fenced JSON block:\n\`\`\`json\n{"summary": "...", "steps": ["..."], "research_queries": ["...", "..."]}\n\`\`\`\nAt most ${maxQueries} research queries, each a precise search phrase. If no live research is needed, use an empty array.`,
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

    // ---- 2. Research ----
    const queries = free ? [] : plan.researchQueries;
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
    for (let pass = 0; pass < maxPasses; pass++) {
      if (this.cancelled.has(job.id)) return this.finishBudgetOrCancel(job);
      this.setPhase(job, 'deliberating', `Deliberation pass ${pass + 1}/${maxPasses}`);
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
              content: `Task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}${baseCtx}${researchBlock}\n${spec.mode === 'nexus' ? `Plan: ${plan.summary}\nSteps: ${plan.steps.join('; ') || 'none'}\n\nPass ${pass + 1} of ${maxPasses}.${falsifyBlock}` : `Plan: ${plan.summary}${falsifyBlock}`}`,
            },
          ],
          { maxTokens: 2200 }
        );
        this.spend(job, res.usageUSD);
        if (this.overBudget(job)) return this.finishBudgetOrCancel(job);
        const parsed = extractJsonBlock(res.content);
        const consensus = stripFencedJson(res.content);
        const score = typeof parsed?.agreementScore === 'number' ? clampInt(parsed.agreementScore, 50, 0, 100) : undefined;
        job.passes.push({
          index: pass + 1,
          label: spec.mode === 'nexus' ? `Falsification pass ${pass + 1}` : `Deliberation pass ${pass + 1}`,
          consensus,
          agreementScore: score,
        });
        previousConsensus = consensus;
        previousScore = score;
        this.persist();

        // Server-side pacing (Night Shift) — interruptible, survives tab close.
        const paceMin = clampInt(spec.pacedMinutes, 0, 0, 180);
        if (paceMin > 0 && pass < maxPasses - 1) {
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
            content: `${SYSTEM_PROMPTS[spec.mode]}\nYou are in the FINALIZE phase. Verify the verdict against the cited research only. Output exactly these markdown sections:\n## Verdict\n## What I verified\n## What I could not verify\n## Confidence\n(honest — what supports it, what would raise it; never oversell)${spec.mode === 'nexus' ? '\n## What changed across passes\n(initial consensus -> reversals -> final position, with reasons)' : ''}\nEnd with:\n## Sources\n(only sources actually relied upon)`,
          },
          {
            role: 'user',
            content: `Task: ${spec.goal.slice(0, MAX_GOAL_CHARS)}${baseCtx}\n\nResearch:\n${researchBlock || '(no live research — strict free budget or plan decided none was needed)'}\n\nDeliberation history:\n${job.passes.map((p) => `${p.label} (${p.agreementScore ?? 'n/a'}%): ${stripFencedJson(p.consensus).slice(0, 1500)}`).join('\n\n')}`,
          },
        ],
        { maxTokens: 2400 }
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

function extractConfidence(finalText: string): string | undefined {
  const match = finalText.match(/## Confidence\s*\n([\s\S]*?)(?=\n## |$)/);
  if (match) return match[1].trim().slice(0, 500);
  return undefined;
}

export function newAgentJobId(): string {
  return `agent_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export function sanitizeAgentSpec(raw: any): AgentJobSpec | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid agent job spec.' };
  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
  if (!goal) return { error: 'A goal is required.' };
  if (goal.length > MAX_GOAL_CHARS) return { error: `Goal exceeds ${MAX_GOAL_CHARS} characters.` };
  const mode: AgentMode = raw.mode === 'nexus' || raw.mode === 'oracle' ? raw.mode : 'chamber';
  const context = typeof raw.context === 'string' ? raw.context.slice(0, MAX_CONTEXT_CHARS) : undefined;
  const budget = raw.budget === 'free' || raw.budget === 'quality' ? raw.budget : 'cheap';
  const spec: AgentJobSpec = {
    goal,
    mode,
    context,
    budget,
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
  return spec;
}

export function createAgentRunner(deps: AgentLoopDeps, dataDir: string): AgentLoopRunner {
  return new AgentLoopRunner(deps, dataDir);
}

export { DEFAULT_MAX_JOB_COST_USD };
