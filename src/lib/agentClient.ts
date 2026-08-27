/**
 * Client for the server-side agent loop (/api/agent*).
 *
 * All calls go through `authenticatedFetch` so the owner token / council key
 * are attached on same-origin requests without ever leaking to providers.
 */

import { authenticatedFetch } from './apiClient';

export interface AgentLaunchSpec {
  goal: string;
  mode: 'nexus' | 'oracle' | 'chamber';
  context?: string;
  /** Attached exhibits — the server reads every part; never silently sliced. */
  exhibits?: { name: string; content: string }[];
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

export interface AgentJobStatus {
  id: string;
  goal: string;
  mode: string;
  status:
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
  progress: { phase: string; detail: string };
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  usageUSD: number;
  citations: number;
  error?: string;
}

export interface AgentJobFull extends AgentJobStatus {
  spec?: { goal: string; model?: string; budget?: string };
  plan: { summary: string; steps: string[]; researchQueries: string[] } | null;
  research: { query: string; findings: string; sources: AgentSource[] }[];
  readings?: { label: string; sourceName: string; section: string; notes: string }[];
  passes: { index: number; label: string; consensus: string; agreementScore?: number }[];
  verdict: string;
  brief?: string;
  citationsList: AgentSource[];
  confidence?: string;
}

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'stopped_budget', 'interrupted']);

export function isAgentJobTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export async function launchAgentJob(spec: AgentLaunchSpec): Promise<{ id: string }> {
  const resp = await authenticatedFetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json?.error || `Agent launch failed (HTTP ${resp.status})`);
  }
  return json?.data || {};
}

export async function getAgentJob(id: string): Promise<AgentJobFull | null> {
  const resp = await authenticatedFetch(`/api/agent/jobs/${encodeURIComponent(id)}`);
  if (resp.status === 404) return null;
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || `Agent status failed (HTTP ${resp.status})`);
  const data = json?.data || {};
  return {
    ...data,
    citationsList: data.citations || [],
    citations: (data.citations || []).length,
  };
}

export async function cancelAgentJob(id: string): Promise<void> {
  const resp = await authenticatedFetch(`/api/agent/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
  if (!resp.ok) {
    const json = await resp.json().catch(() => ({}));
    throw new Error(json?.error || `Cancel failed (HTTP ${resp.status})`);
  }
}

export interface PollAgentOptions {
  intervalMs?: number;
  maxWaitMs?: number;
  onUpdate?: (job: AgentJobFull) => void;
  signal?: AbortSignal;
}

/**
 * Polls a job until it reaches a terminal state (or the wait window closes).
 * Returns the latest snapshot; `onUpdate` fires on every poll.
 */
export async function pollAgentJob(
  id: string,
  opts: PollAgentOptions = {}
): Promise<AgentJobFull | null> {
  const intervalMs = opts.intervalMs ?? 4000;
  const startedAt = Date.now();
  let latest: AgentJobFull | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.signal?.aborted) return latest;
    if (opts.maxWaitMs && Date.now() - startedAt > opts.maxWaitMs) return latest;
    try {
      const job = await getAgentJob(id);
      if (job) {
        latest = job;
        opts.onUpdate?.(job);
        if (isAgentJobTerminal(job.status)) return job;
      }
    } catch (err) {
      console.warn('[agentClient] Poll failed:', err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
