/**
 * Nexus missions — server-side mission registry (Phase 3).
 *
 * A mission wraps the existing AgentLoopRunner job (mode 'nexus') with a CSV
 * exhibit uploaded as raw text, plus the pause/answer loop:
 *  - pause    → cancels the in-flight job (honest 'cancelled' trail) and
 *               parks the mission as 'paused' (or 'awaiting_approval' when
 *               structured questions are attached).
 *  - answers  → injects owner answers and resumes: a NEW job is launched
 *               with the prior findings + Q&A folded into the context, so
 *               the loop's existing pass/verdict machinery is reused — the
 *               loop itself is never re-invented here.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  AgentJob,
  AgentLoopRunner,
  sanitizeAgentSpec,
  type AgentJobSpec,
} from './agentLoop';
import { parseCsv } from './csvParse';
import { expandModelsInput, validateModelsAgainstCatalog } from '../lib/modelCatalog';
import type { WebhookNotifier } from './webhookNotifier';

export type NexusMissionStatus = 'running' | 'paused' | 'awaiting_approval' | 'complete' | 'failed';

export interface NexusMissionRecord {
  id: string;
  goal: string;
  /** Actor that created the mission (x-agent-name header, default "web"). */
  agent: string;
  context?: string;
  /** Raw CSV text — server-side only, redacted in disk/API views. */
  csvText: string;
  /** Multi-model council seats (validated slugs); empty = single-model default. */
  models?: string[];
  /** Allocator task-domain hint (e.g. "code"). */
  taskType?: string;
  csvHeaders: string[];
  csvRowCount: number;
  /** Set by pause(); cleared by resume(). When set, it wins over the job. */
  manualStatus: NexusMissionStatus | null;
  pendingQuestions: string[];
  answers: Record<string, string>;
  jobId: string | null;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface NexusMissionFinding {
  label: string;
  detail: string;
}

export interface NexusMissionView {
  id: string;
  goal: string;
  agent: string;
  status: NexusMissionStatus;
  currentPass: number;
  latestPassLabel?: string;
  findings: NexusMissionFinding[];
  researchQueries: string[];
  pendingQuestions: string[];
  answers: Record<string, string>;
  csv: { headers: string[]; rowCount: number } | null;
  models?: string[];
  jobId: string | null;
  usageUSD: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const MAX_CSV_CHARS = 2_000_000; // ~2MB
const MAX_QUESTIONS = 20;
const FINDING_DETAIL_CHARS = 700;
const MAX_PERSISTED = 50;

function newMissionId(): string {
  return `nexus_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function jobToStatus(status: string): NexusMissionStatus | null {
  switch (status) {
    case 'planning':
    case 'reading':
    case 'researching':
    case 'deliberating':
    case 'finalizing':
      return 'running';
    case 'done':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'interrupted':
    case 'stopped_budget':
      return 'paused';
    default:
      return null;
  }
}

export class NexusMissionStore {
  private missions = new Map<string, NexusMissionRecord>();
  /** missionId:status keys already reported over the webhook (dedupe). */
  private notified = new Set<string>();

  constructor(
    private runner: AgentLoopRunner,
    private dataDir: string,
    private notifier?: WebhookNotifier,
    /** Cached OpenRouter catalog accessor for create-time model validation. */
    private catalog?: () => any[]
  ) {
    this.loadFromDisk();
  }

  // ── creation ────────────────────────────────────────────────────────────

  /**
   * Validates and creates a mission. Returns either a record or an error
   * message for the route to turn into a 400.
   */
  create(input: { goal?: unknown; csv?: unknown; context?: unknown; agent?: unknown; models?: unknown; taskType?: unknown }): NexusMissionRecord | { error: string } {
    const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
    if (!goal) return { error: 'A goal is required.' };

    let csvText = '';
    if (input.csv !== undefined && input.csv !== null) {
      if (typeof input.csv !== 'string') return { error: 'csv must be raw CSV text (a string).' };
      csvText = input.csv;
      if (csvText.length > MAX_CSV_CHARS) {
        return { error: `CSV is ${csvText.length.toLocaleString()} chars — over the ~2MB server cap.` };
      }
      const parsed = parseCsv(csvText);
      if (parsed.rows.length === 0) {
        return { error: 'CSV could not be parsed: no data rows found (is the file empty?).' };
      }
    }

    const modelsRes = expandModelsInput(input.models);
    if ('error' in modelsRes) return { error: modelsRes.error };
    const catalog = this.catalog?.() || [];
    const catalogError = validateModelsAgainstCatalog(modelsRes.models, catalog);
    if (catalogError) return { error: catalogError };
    const taskType = typeof input.taskType === 'string' && input.taskType.trim() ? input.taskType.trim().slice(0, 64) : undefined;

    const spec = this.buildSpec(goal, csvText, typeof input.context === 'string' ? input.context : undefined, modelsRes.models, taskType);
    if ('error' in spec) return { error: spec.error };

    const parsed = csvText ? parseCsv(csvText) : { headers: [], rows: [] as string[][] };
    const record: NexusMissionRecord = {
      id: newMissionId(),
      goal,
      agent: typeof input.agent === 'string' && input.agent.trim() ? input.agent.trim().slice(0, 64) : 'web',
      context: typeof input.context === 'string' && input.context.trim() ? input.context : undefined,
      csvText,
      ...(modelsRes.models.length > 0 ? { models: modelsRes.models } : {}),
      ...(taskType ? { taskType } : {}),
      csvHeaders: parsed.headers,
      csvRowCount: parsed.rows.length,
      manualStatus: null,
      pendingQuestions: [],
      answers: {},
      jobId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const job = this.newJob(spec);
    record.jobId = job.id;
    this.missions.set(record.id, record);
    this.persist();
    void this.runner.run(job);
    return record;
  }

  private buildSpec(goal: string, csvText: string, context?: string, models?: string[], taskType?: string): AgentJobSpec | { error: string } {
    const exhibits = csvText
      ? [{ name: 'uploaded-exhibit.csv', content: csvText }]
      : undefined;
    return sanitizeAgentSpec({
      goal,
      mode: 'nexus',
      context,
      ...(models && models.length > 0 ? { models } : {}),
      ...(taskType ? { taskType } : {}),
      ...(exhibits ? { exhibits } : {}),
    });
  }

  private newJob(spec: AgentJobSpec): AgentJob {
    return {
      id: `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      spec,
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
      progress: { phase: 'planning', detail: 'Nexus mission accepted.' },
    };
  }

  // ── reads ───────────────────────────────────────────────────────────────

  list(): NexusMissionView[] {
    const views = Array.from(this.missions.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((m) => this.view(m));
    for (const m of this.missions.values()) this.reportTransitions(m);
    return views;
  }

  get(id: string): NexusMissionView | null {
    const m = this.missions.get(id);
    if (!m) return null;
    const view = this.view(m);
    this.reportTransitions(m);
    return view;
  }

  /**
   * Phase 4 "return wire": mission completion/pause/fail are derived states
   * (computed from the live job), so transition events fire lazily on read —
   * get()/list()/pause() — deduped per (mission, status). Fire-and-forget.
   */
  private reportTransitions(m: NexusMissionRecord): void {
    if (!this.notifier) return;
    const status = this.statusOf(m);
    if (status !== 'complete' && status !== 'failed' && status !== 'paused' && status !== 'awaiting_approval') return;
    const key = `${m.id}:${status}`;
    if (this.notified.has(key)) return;
    this.notified.add(key);
    const paused = status === 'paused' || status === 'awaiting_approval';
    this.notifier.notify({
      event: status === 'complete' ? 'mission_completed' : status === 'failed' ? 'mission_failed' : 'mission_paused',
      missionId: m.id,
      goal: m.goal,
      ...(paused && m.pendingQuestions.length > 0 ? { pendingQuestions: [...m.pendingQuestions] } : {}),
      status,
      ts: Date.now(),
      agent: m.agent || 'web',
    });
  }

  /** Status resolution: manual override wins; otherwise the live job maps it. */
  private statusOf(m: NexusMissionRecord): NexusMissionStatus {
    if (m.manualStatus) return m.manualStatus;
    const job = m.jobId ? this.runner.get(m.jobId) : undefined;
    const mapped = job ? jobToStatus(job.status) : null;
    return mapped || (m.error ? 'failed' : 'running');
  }

  private view(m: NexusMissionRecord): NexusMissionView {
    const job = m.jobId ? this.runner.get(m.jobId) : undefined;
    const findings: NexusMissionFinding[] = [];
    const researchQueries: string[] = [];
    if (job) {
      for (const p of job.passes) {
        findings.push({ label: p.label, detail: p.consensus.slice(0, FINDING_DETAIL_CHARS) });
      }
      for (const r of job.research) researchQueries.push(r.query);
    }
    const lastPass = job?.passes[job.passes.length - 1];
    return {
      id: m.id,
      goal: m.goal,
      agent: m.agent || 'web',
      status: this.statusOf(m),
      currentPass: job ? job.passes.length : 0,
      latestPassLabel: lastPass?.label,
      findings,
      researchQueries,
      pendingQuestions: m.pendingQuestions,
      answers: m.answers,
      csv: m.csvText
        ? { headers: m.csvHeaders, rowCount: m.csvRowCount }
        : null,
      ...(m.models && m.models.length > 0 ? { models: m.models } : {}),
      jobId: m.jobId,
      usageUSD: job ? Number(job.usageUSD.toFixed(6)) : 0,
      error: m.error || job?.error,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  // ── pause / answers / resume ────────────────────────────────────────────

  /**
   * Manual pause. Cancels the in-flight job (the loop records an honest
   * 'cancelled' state) and parks the mission. Structured questions attach an
   * 'awaiting_approval' status surfaced as pendingQuestions in GET state.
   */
  pause(id: string, pendingQuestions?: unknown): NexusMissionView | null {
    const m = this.missions.get(id);
    if (!m) return null;
    if (m.jobId) this.runner.cancel(m.jobId);
    const questions = this.sanitizeQuestions(pendingQuestions);
    m.pendingQuestions = questions.length > 0 ? questions : m.pendingQuestions;
    m.manualStatus = m.pendingQuestions.length > 0 ? 'awaiting_approval' : 'paused';
    m.updatedAt = Date.now();
    this.persist();
    this.reportTransitions(m);
    return this.view(m);
  }

  /** Injects owner answers; if the mission is parked, resumes it. */
  answer(id: string, answers: unknown): NexusMissionView | { error: string } | null {
    const m = this.missions.get(id);
    if (!m) return null;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return { error: 'answers must be an object of { questionOrKey: answer }.' };
    }
    const status = this.statusOf(m);
    if (status !== 'paused' && status !== 'awaiting_approval') {
      return { error: `Mission is ${status} — answers are only accepted while paused or awaiting_approval.` };
    }
    const clean: Record<string, string> = { ...m.answers };
    for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        clean[k.slice(0, 200)] = String(v).slice(0, 4000);
      }
    }
    m.answers = clean;
    const resumed = this.resumeRecord(m);
    return resumed ? this.view(m) : { error: 'Mission could not be resumed.' };
  }

  resume(id: string): NexusMissionView | null {
    const m = this.missions.get(id);
    if (!m) return null;
    return this.resumeRecord(m) ? this.view(m) : null;
  }

  private resumeRecord(m: NexusMissionRecord): boolean {
    const answerBlock =
      Object.keys(m.answers).length > 0
        ? `\n\n[Owner answers to your questions]\n${Object.entries(m.answers)
            .map(([q, a]) => `- Q: ${q}\n  A: ${a}`)
            .join('\n')}`
        : '';
    const prior = this.priorFindingsBlock(m);
    const spec = this.buildSpec(
      m.goal,
      m.csvText,
      [m.context, prior, answerBlock].filter(Boolean).join('\n') || undefined,
      m.models,
      m.taskType
    );
    if ('error' in spec) {
      m.error = spec.error;
      m.updatedAt = Date.now();
      this.persist();
      return false;
    }
    const job = this.newJob(spec);
    m.jobId = job.id;
    m.manualStatus = null;
    m.pendingQuestions = [];
    m.error = undefined;
    m.updatedAt = Date.now();
    this.persist();
    void this.runner.run(job);
    return true;
  }

  private priorFindingsBlock(m: NexusMissionRecord): string {
    const job = m.jobId ? this.runner.get(m.jobId) : undefined;
    if (!job) return '';
    const parts: string[] = [];
    if (job.plan?.summary) parts.push(`Prior plan: ${job.plan.summary}`);
    for (const p of job.passes) {
      parts.push(`Prior pass (${p.label}): ${p.consensus.slice(0, 1200)}`);
    }
    if (job.verdict) parts.push(`Prior verdict: ${job.verdict.slice(0, 2000)}`);
    return parts.length > 0 ? `[Prior progress on this mission — build on it, do not start over]\n${parts.join('\n\n')}` : '';
  }

  private sanitizeQuestions(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim().slice(0, 500))
      .slice(0, MAX_QUESTIONS);
  }

  // ── persistence (same pattern as agent-jobs.json) ───────────────────────

  private persist(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const file = path.join(this.dataDir, 'nexus-missions.json');
      const payload = this.listRecords().slice(0, MAX_PERSISTED).map((m) => ({
        ...m,
        // Raw CSV never rides to disk — it lives in server memory only.
        csvText: m.csvText ? `[uploaded CSV — ${m.csvText.length.toLocaleString()} chars]` : '',
      }));
      fs.writeFileSync(file, JSON.stringify(payload));
    } catch (err: any) {
      console.warn('[nexus-missions] Failed to persist:', err?.message);
    }
  }

  private listRecords(): NexusMissionRecord[] {
    return Array.from(this.missions.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  private loadFromDisk(): void {
    try {
      const file = path.join(this.dataDir, 'nexus-missions.json');
      if (!fs.existsSync(file)) return;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) return;
      for (const m of parsed) {
        if (m && typeof m.id === 'string' && typeof m.goal === 'string') {
          this.missions.set(m.id, {
            ...m,
            csvText: '', // redacted on disk; resume rebuilds from the goal/context
            manualStatus: m.manualStatus ?? null,
            pendingQuestions: Array.isArray(m.pendingQuestions) ? m.pendingQuestions : [],
            answers: m.answers && typeof m.answers === 'object' ? m.answers : {},
          });
        }
      }
    } catch (err: any) {
      console.warn('[nexus-missions] Failed to load:', err?.message);
    }
  }
}

export function createNexusMissionStore(
  runner: AgentLoopRunner,
  dataDir: string,
  notifier?: WebhookNotifier,
  catalog?: () => any[]
): NexusMissionStore {
  return new NexusMissionStore(runner, dataDir, notifier, catalog);
}
