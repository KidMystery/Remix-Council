/**
 * Evidence-gated completion.
 *
 * One rule: a round cannot be stamped COMPLETED while any blocker is open.
 * Session JSON stores exhibit *metadata* only. Extracted bodies live in
 * IndexedDB (see evidenceStore.ts). Drive never receives file bytes.
 *
 * This file is pure — no DOM, no IndexedDB — so it is the place to debug
 * “why wasn’t this stamped?” Open the round, read `stamp` + `blockers`.
 */

import type {
  AttachedTextFile,
  CouncilRound,
  EvidenceCoverage,
  EvidenceRecord,
  ExtractorKind,
  Persona,
  RunBlocker,
  RunStamp,
} from '../types';

export const EXTRACTOR_VERSION = 'council-evidence-1';
export const EVIDENCE_PREVIEW_CHARS = 240;
/** PDFs/zips this small are never flagged “thin” — a 2-page letter is fine. */
export const COVERAGE_THIN_MIN_UNITS = 4;
export const COVERAGE_THIN_RATIO = 0.5;
export const LEGACY_TRUNCATION_MARKERS = [
  '[Truncated for storage',
  '... [TRUNCATED AFTER',
];

export function evidenceIdFromSha(sha256: string): string {
  return `ev_${(sha256 || '').slice(0, 16)}`;
}

export function shortSha(sha256: string): string {
  const s = sha256 || '';
  if (s.length < 12) return s || '—';
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

export function previewOf(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= EVIDENCE_PREVIEW_CHARS) return t;
  return `${t.slice(0, EVIDENCE_PREVIEW_CHARS)}…`;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function makeEvidenceRecord(input: {
  sha256: string;
  name: string;
  mime: string;
  byteSize: number;
  extractor: ExtractorKind;
  coverage: Omit<EvidenceCoverage, 'byteSize' | 'extractedChars'> & { extractedChars: number };
  body: string;
  failDetail?: string;
  createdAt?: number;
}): EvidenceRecord {
  return {
    id: evidenceIdFromSha(input.sha256),
    name: input.name,
    mime: input.mime || 'application/octet-stream',
    byteSize: input.byteSize,
    sha256: input.sha256,
    extractor: input.extractor,
    extractorVersion: EXTRACTOR_VERSION,
    coverage: {
      extractedChars: input.coverage.extractedChars,
      byteSize: input.byteSize,
      pagesTotal: input.coverage.pagesTotal,
      pagesWithText: input.coverage.pagesWithText,
      filesInArchive: input.coverage.filesInArchive,
      filesExtracted: input.coverage.filesExtracted,
    },
    createdAt: input.createdAt ?? Date.now(),
    preview: previewOf(input.body),
    failDetail: input.failDetail,
  };
}

export function coverageRatio(ev: EvidenceRecord): number | null {
  const c = ev.coverage;
  if (typeof c.pagesTotal === 'number' && c.pagesTotal > 0 && typeof c.pagesWithText === 'number') {
    return c.pagesWithText / c.pagesTotal;
  }
  if (typeof c.filesInArchive === 'number' && c.filesInArchive > 0 && typeof c.filesExtracted === 'number') {
    return c.filesExtracted / c.filesInArchive;
  }
  return null;
}

export function coverageLabel(ev: EvidenceRecord): string {
  const c = ev.coverage;
  if (typeof c.pagesTotal === 'number') {
    return `${c.pagesWithText ?? 0} / ${c.pagesTotal} pages with text`;
  }
  if (typeof c.filesInArchive === 'number') {
    return `${c.filesExtracted ?? 0} / ${c.filesInArchive} files extracted`;
  }
  if (c.extractedChars > 0) return `${c.extractedChars.toLocaleString()} chars read`;
  return 'nothing read';
}

function looksLegacyTruncated(content: string | undefined): boolean {
  const t = content || '';
  return LEGACY_TRUNCATION_MARKERS.some((m) => t.includes(m));
}

export interface StampInput {
  evidence?: EvidenceRecord[];
  attached?: AttachedTextFile[];
  personas: Pick<Persona, 'id' | 'enabled'>[];
  stage1?: Record<string, { status?: string; promptTokens?: number } | undefined>;
  stage2?: Record<string, { status?: string } | undefined>;
  isQuickPanel?: boolean;
  stopAfterStage1?: boolean;
  overCeiling?: boolean;
  /** 0 / undefined = unlimited. Client and server must use this same number. */
  costCeilingUSD?: number;
  missingBlobIds?: string[];
  /** True once Stage 1 has been attempted (so we can flag a partial panel). */
  stage1Attempted?: boolean;
}

/**
 * Every reason this round must not be stamped COMPLETED.
 * Order is stable so the docket reads like a form: exhibits first, then panel, then cost.
 */
export function collectRunBlockers(input: StampInput): RunBlocker[] {
  const blockers: RunBlocker[] = [];
  const evidence = input.evidence || [];
  const attached = input.attached || [];

  for (const ev of evidence) {
    if (ev.extractor === 'failed' || (ev.byteSize > 0 && ev.coverage.extractedChars === 0)) {
      blockers.push({
        type: 'extraction_failed',
        evidenceId: ev.id,
        detail: ev.failDetail
          ? `${ev.name}: extractor failed — ${ev.failDetail}`
          : `${ev.name}: extractor read 0 characters from a ${ev.byteSize}-byte file.`,
      });
      continue;
    }
    const units = ev.coverage.pagesTotal ?? ev.coverage.filesInArchive ?? 0;
    const ratio = coverageRatio(ev);
    if (units >= COVERAGE_THIN_MIN_UNITS && ratio !== null && ratio < COVERAGE_THIN_RATIO) {
      blockers.push({
        type: 'coverage_thin',
        evidenceId: ev.id,
        ratio,
        threshold: COVERAGE_THIN_RATIO,
        detail: `${ev.name}: ${coverageLabel(ev)} — less than half the artifact was readable. The council did not see the rest.`,
      });
    }
  }

  const hasEvidence = evidence.length > 0;
  for (const f of attached) {
    if (looksLegacyTruncated(f.content)) {
      blockers.push({
        type: 'legacy_truncated_inline',
        detail: `${f.name} was sliced by the old 2k/5k storage cap. Re-attach the file; Resume will not invent the missing pages.`,
      });
    } else if (!hasEvidence && f.content && f.content.length > 0 && !f.evidenceId) {
      // Pre-evidence sessions: we have inline text and no exhibit. Honest, not a blocker
      // unless it was truncated (handled above).
    }
  }

  for (const id of input.missingBlobIds || []) {
    const ev = evidence.find((e) => e.id === id);
    blockers.push({
      type: 'blob_missing',
      evidenceId: id,
      detail: `${ev?.name || id}: the extracted body is not on this device. Re-attach the file before Resume.`,
    });
  }

  const active = (input.personas || []).filter((p) => p.enabled !== false);
  const required = active.length;
  if (input.stage1Attempted && required > 0) {
    const completed = active.filter((p) => input.stage1?.[p.id]?.status === 'completed').length;
    if (completed < required) {
      blockers.push({
        type: 'partial_panel',
        completed,
        required,
        detail: `Panel incomplete: ${completed} of ${required} seats finished Stage 1. A Chair must not synthesize error strings into a verdict.`,
      });
    } else if (!input.isQuickPanel && !input.stopAfterStage1 && !input.overCeiling) {
      const s2 = input.stage2 || {};
      const s2Started = Object.keys(s2).length > 0;
      if (s2Started) {
        const s2Done = active.filter((p) => s2[p.id]?.status === 'completed').length;
        if (s2Done < required) {
          blockers.push({
            type: 'partial_panel',
            completed: s2Done,
            required,
            detail: `Peer review incomplete: ${s2Done} of ${required} seats finished Stage 2.`,
          });
        }
      }
    }
  }

  if (input.stopAfterStage1 || input.overCeiling) {
    const skipReason = input.overCeiling
      ? 'Per-round cost ceiling reached — Stage 2 and synthesis were not run.'
      : 'Stop After Stage 1 is on — no Chair verdict was produced.';
    blockers.push({
      type: 'skipped_stages',
      reason: skipReason,
      detail: skipReason,
    });
  }

  const ceiling = input.costCeilingUSD;
  if (typeof ceiling === 'number' && ceiling > 0 && input.stage1Attempted) {
    const completedSeats = active.filter((p) => input.stage1?.[p.id]?.status === 'completed');
    const missingUsage = completedSeats.some(
      (p) => !Number.isFinite(input.stage1?.[p.id]?.promptTokens as number)
    );
    if (completedSeats.length > 0 && missingUsage) {
      blockers.push({
        type: 'cost_unknown',
        detail: `A cost ceiling of $${ceiling.toFixed(2)} is set, but at least one completed seat reported no token usage. Spend is unknown — cannot claim we stayed under the ceiling.`,
      });
    }
  }

  return blockers;
}

export function canStampCompleted(blockers: RunBlocker[] | undefined): boolean {
  return !blockers || blockers.length === 0;
}

export function stampFromBlockers(
  blockers: RunBlocker[],
  opts: { running?: boolean; aborted?: boolean; failed?: boolean } = {}
): RunStamp {
  if (opts.running) return 'running';
  if (opts.aborted) return 'stopped';
  if (opts.failed) return 'failed';
  if (!canStampCompleted(blockers)) return 'blocked';
  return 'completed';
}

export function applyStamp<T extends Pick<CouncilRound, 'stamp' | 'blockers' | 'synthesis'>>(
  round: T,
  stamp: RunStamp,
  blockers: RunBlocker[]
): T {
  const next = { ...round, stamp, blockers };
  if (stamp !== 'completed' && next.synthesis?.status === 'completed') {
    // A skip-note or draft must not wear the completed badge.
    next.synthesis = { ...next.synthesis, status: stamp === 'failed' ? 'error' : 'idle' };
  }
  return next;
}

/** 0 / negative / non-finite → unlimited. Never invent a $2 default. */
export function resolveCostCeilingUSD(uiValue: number | undefined | null): number | undefined {
  if (typeof uiValue !== 'number' || !Number.isFinite(uiValue) || uiValue <= 0) return undefined;
  return uiValue;
}

/**
 * Persistence shape: keep exhibit metadata, drop file bodies.
 * If a writer would have to slice a body to fit storage, it is a failed write
 * — this function never slices.
 */
export function stripRoundBodies<T extends Pick<CouncilRound, 'attachedTextFiles' | 'evidence'>>(round: T): T {
  const attached = (round.attachedTextFiles || []).map((f) => ({
    ...f,
    content: '',
    evidenceId: f.evidenceId,
  }));
  return { ...round, attachedTextFiles: attached, evidence: round.evidence || [] };
}

export function stripSessionBodies<T extends { rounds?: CouncilRound[] }>(session: T): T {
  const rounds = (session.rounds || []).map((r) => stripRoundBodies(r));
  return { ...session, rounds };
}

export function stripSessionsBodies<T extends { rounds?: CouncilRound[] }>(sessions: T[]): T[] {
  return sessions.map((s) => stripSessionBodies(s));
}

function completedSeatCount(round: CouncilRound): number {
  const s1 = Object.values(round.deliberation?.stage1 || {}).filter((r) => r?.status === 'completed').length;
  const s2 = Object.values(round.deliberation?.stage2 || {}).filter((r) => r?.status === 'completed').length;
  const stamped = round.stamp === 'completed' ? 1 : 0;
  return s1 + s2 + stamped;
}

function hasTruncatedInline(round: CouncilRound): boolean {
  return (round.attachedTextFiles || []).some((f) => looksLegacyTruncated(f.content));
}

/**
 * Merge preference: exhibit identity and seat completion, never synthesis length.
 * A Drive copy that was sliced to 5k chars must not beat a local copy with blobs.
 */
export function preferIncomingRound(existing: CouncilRound, incoming: CouncilRound): boolean {
  const existingTrunc = hasTruncatedInline(existing);
  const incomingTrunc = hasTruncatedInline(incoming);
  if (existingTrunc && !incomingTrunc) return true;
  if (!existingTrunc && incomingTrunc) return false;

  const existingEv = (existing.evidence || []).length;
  const incomingEv = (incoming.evidence || []).length;
  if (incomingEv !== existingEv) return incomingEv > existingEv;

  return completedSeatCount(incoming) >= completedSeatCount(existing);
}

export function blockerHeadline(blockers: RunBlocker[] | undefined): string {
  if (!blockers || blockers.length === 0) return '';
  return ('detail' in blockers[0] && blockers[0].detail) || blockers[0].type;
}
