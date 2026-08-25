/**
 * Confidence Ledger — an opt-in Chamber add-on ("Who was right, for you?").
 *
 * Purely manual: the owner explicitly tracks a verdict and later marks how it
 * turned out. Nothing is ever recorded automatically, so personal questions
 * (family, feelings, casual advice) stay out unless the owner chooses to
 * track them. Stats are honest: ratios are only shown once there are enough
 * resolved outcomes to mean something.
 */

import { detectTaskDomain } from './smartModelSelector';

export type LedgerOutcome = 'pending' | 'worked' | 'didnt' | 'ignored';

export interface TrackedPersona {
  id: string;
  name: string;
  model?: string;
}

export interface TrackedOutcome {
  id: string;
  sessionId?: string;
  query: string;
  domain: string;
  recordedAt: number;
  outcomeAt?: number;
  outcome: LedgerOutcome;
  personas: TrackedPersona[];
  models: string[];
}

export interface StatRow {
  tracked: number;
  resolved: number;
  correct: number;
  wrong: number;
}

export interface LedgerStats {
  total: StatRow;
  byPersona: Record<string, StatRow & { name: string }>;
  byModel: Record<string, StatRow>;
  byDomain: Record<string, StatRow>;
}

const LEDGER_KEY = 'council_outcome_ledger_v1';
/** Minimum resolved outcomes before a ratio is worth showing. */
export const MIN_RESOLVED_FOR_RATIO = 3;
const MAX_ENTRIES = 200;

export function loadOutcomeLedger(): TrackedOutcome[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === 'string' && e.outcome);
  } catch (err) {
    console.warn('[OutcomeLedger] Failed to load:', err);
    return [];
  }
}

export function saveOutcomeLedger(ledger: TrackedOutcome[]): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger.slice(-MAX_ENTRIES)));
  } catch (err) {
    console.warn('[OutcomeLedger] Failed to save:', err);
  }
}

export function getTrackedOutcome(id: string): TrackedOutcome | undefined {
  return loadOutcomeLedger().find((e) => e.id === id);
}

/** Starts tracking a completed round's verdict (or replaces an existing entry). */
export function trackOutcome(entry: {
  id: string;
  sessionId?: string;
  query: string;
  domain: string;
  personas: TrackedPersona[];
  models: string[];
}): TrackedOutcome[] {
  const ledger = loadOutcomeLedger();
  const existing = ledger.find((e) => e.id === entry.id);
  const record: TrackedOutcome = {
    id: entry.id,
    sessionId: entry.sessionId,
    query: entry.query.slice(0, 200),
    domain: entry.domain || 'general',
    recordedAt: Date.now(),
    outcome: 'pending',
    personas: entry.personas,
    models: entry.models,
  };
  const next = existing
    ? ledger.map((e) => (e.id === entry.id ? { ...existing, ...record } : e))
    : [record, ...ledger];
  saveOutcomeLedger(next);
  return next;
}

export function setTrackedOutcome(id: string, outcome: LedgerOutcome): TrackedOutcome[] {
  const ledger = loadOutcomeLedger();
  const next = ledger.map((e) =>
    e.id === id ? { ...e, outcome, outcomeAt: Date.now() } : e
  );
  saveOutcomeLedger(next);
  return next;
}

export function untrackOutcome(id: string): TrackedOutcome[] {
  const next = loadOutcomeLedger().filter((e) => e.id !== id);
  saveOutcomeLedger(next);
  return next;
}

/** Classifies a query into the same task domains the Chamber uses for model selection. */
export function classifyOutcomeDomain(query: string, attachedTextFiles?: unknown[]): string {
  try {
    return detectTaskDomain(query, (attachedTextFiles || []) as any) || 'general';
  } catch {
    return 'general';
  }
}

const emptyRow = (): StatRow => ({ tracked: 0, resolved: 0, correct: 0, wrong: 0 });

function addRow(row: StatRow, entry: TrackedOutcome): StatRow {
  row.tracked += 1;
  if (entry.outcome === 'worked') {
    row.resolved += 1;
    row.correct += 1;
  } else if (entry.outcome === 'didnt') {
    row.resolved += 1;
    row.wrong += 1;
  }
  return row;
}

/**
 * Aggregates the ledger into per-persona, per-model, and per-domain rows.
 * Pure and deterministic.
 */
export function buildLedgerStats(ledger: TrackedOutcome[]): LedgerStats {
  const stats: LedgerStats = {
    total: emptyRow(),
    byPersona: {},
    byModel: {},
    byDomain: {},
  };
  for (const entry of ledger) {
    addRow(stats.total, entry);
    const domainKey = entry.domain || 'general';
    stats.byDomain[domainKey] = addRow(stats.byDomain[domainKey] || emptyRow(), entry);
    for (const p of entry.personas) {
      const row = stats.byPersona[p.id] || (stats.byPersona[p.id] = { ...emptyRow(), name: p.name });
      addRow(row, entry);
    }
    for (const model of entry.models) {
      stats.byModel[model] = addRow(stats.byModel[model] || emptyRow(), entry);
    }
  }
  return stats;
}

/**
 * Honest summary line for a stat row. Ratios only appear once there are at
 * least MIN_RESOLVED_FOR_RATIO resolved outcomes; below that the ledger
 * admits it is still gathering evidence.
 */
export function describeStat(row: StatRow | undefined): string {
  if (!row || row.tracked === 0) return 'no tracked verdicts yet';
  if (row.resolved < MIN_RESOLVED_FOR_RATIO) {
    return `${row.correct} right · ${row.wrong} wrong of ${row.tracked} tracked — gathering evidence`;
  }
  const pct = Math.round((row.correct / row.resolved) * 100);
  return `${row.correct}/${row.resolved} right (${pct}%) · ${row.tracked} tracked`;
}

export const OUTCOME_LABELS: Record<LedgerOutcome, string> = {
  pending: 'Pending',
  worked: 'Worked',
  didnt: "Didn't",
  ignored: 'Ignored',
};
