/**
 * Nexus works exhibits overnight. Not a chat.
 *
 * Debug: buildOvernightPlan({…}).messages in the terminal, or
 * packExhibitsForServerJob(files) before a server launch. A refused pack is
 * honest — we never slice a tree to fit a single call. Big exhibits are
 * walked part-by-part (local Autonomous on this device, or the server's
 * reading phase for server jobs) so every part is still read.
 */

import { chunkDocuments, type DocumentChunkPlan } from './documentChunker';

/**
 * Mirrors the server's hard honesty caps (see MAX_EXHIBIT_* in
 * src/server/agentLoop.ts). Above these a server launch is refused outright —
 * never silently sliced. Run Autonomous locally instead.
 */
export const MAX_SERVER_EXHIBIT_TOTAL_CHARS = 4_000_000;
export const MAX_SERVER_EXHIBIT_FILES = 16;
/** Under this total the server reads exhibits inline in a single pass. */
export const SERVER_EXHIBIT_INLINE_CHARS = 50_000;

export type ExhibitKind = 'code' | 'csv' | 'pdf' | 'archive' | 'text';

export interface ExhibitSource {
  name: string;
  content: string;
  type?: string;
}

export interface OvernightPass {
  label: string;
  iter: number;
  query: string;
  isFinalSynthesis?: boolean;
}

export interface OvernightPlan {
  ok: boolean;
  reason?: string;
  wasChunked: boolean;
  messages: string[];
  passes: OvernightPass[];
  docPlan: DocumentChunkPlan | null;
  manifest: string;
}

export function classifyExhibit(name: string, type?: string): ExhibitKind {
  const n = (name || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (t === 'zip' || t === 'rar' || /\.(zip|rar|tar|gz)$/.test(n)) return 'archive';
  if (t === 'pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.csv') || n.endsWith('.tsv')) return 'csv';
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|cpp|c|h|json|yml|yaml|sql|md)$/.test(n)) return 'code';
  return 'text';
}

export function liveExhibits(files: ExhibitSource[] | undefined): ExhibitSource[] {
  return (files || []).filter((f) => (f.content || '').trim().length > 0);
}

export function canLaunchNexus(input: {
  files?: ExhibitSource[];
  followUp?: string | null;
}): { ok: boolean; reason?: string } {
  const live = liveExhibits(input.files);
  if (live.length > 0) return { ok: true };
  if ((input.files || []).length > 0) {
    return {
      ok: false,
      reason: 'Exhibits are on the docket but bodies are empty (blob missing). Re-attach the files.',
    };
  }
  if ((input.followUp || '').trim()) return { ok: true };
  return {
    ok: false,
    reason: 'Nexus works overnight on artifacts. Attach a tree, CSV, or statement.',
  };
}

export function renderExhibitManifest(files: ExhibitSource[]): string {
  const live = liveExhibits(files);
  if (live.length === 0) return 'EXHIBITS: (none)';
  const lines = ['EXHIBITS (cover sheet — these are the artifacts, not optional color)'];
  live.forEach((f, i) => {
    const kind = classifyExhibit(f.name, f.type);
    lines.push(
      `- ${String.fromCharCode(65 + (i % 26))}. ${f.name} · ${kind} · ${f.content.length.toLocaleString()} chars`
    );
  });
  return lines.join('\n');
}

/**
 * Pack exhibits for a server job. Up to the hard caps above, the full
 * docket ships — the server walks oversized sets part-by-part in its reading
 * phase (every part read, none sliced). Refusal is reserved for the caps.
 */
export function packExhibitsForServerJob(files: ExhibitSource[]):
  | {
      ok: true;
      exhibits: ExhibitSource[];
      manifest: string;
      chars: number;
      chunkCount: number;
      wasChunked: boolean;
    }
  | { ok: false; error: string; chars: number } {
  const live = liveExhibits(files);
  const chars = live.reduce((n, f) => n + f.content.length, 0);
  if (live.length === 0) {
    return {
      ok: false,
      error: 'Nexus server jobs need exhibits. Attach the artifacts, or run a follow-up of a finished mission.',
      chars: 0,
    };
  }
  if (live.length > MAX_SERVER_EXHIBIT_FILES) {
    return {
      ok: false,
      error: `Too many exhibit files (${live.length}) — the server cap is ${MAX_SERVER_EXHIBIT_FILES}.`,
      chars,
    };
  }
  if (chars > MAX_SERVER_EXHIBIT_TOTAL_CHARS) {
    return {
      ok: false,
      error: `Exhibits are ${chars.toLocaleString()} chars — over the server cap of ${MAX_SERVER_EXHIBIT_TOTAL_CHARS.toLocaleString()}. Trim the tree or run Autonomous on this device.`,
      chars,
    };
  }
  const wasChunked = chars > SERVER_EXHIBIT_INLINE_CHARS;
  const chunkCount = wasChunked
    ? chunkDocuments(live.map((f) => ({ name: f.name, content: f.content })), { pagesPerChunk: 20 }).chunks.length
    : 1;
  return { ok: true, exhibits: live, manifest: renderExhibitManifest(live), chars, chunkCount, wasChunked };
}

const ROTATION_THEMES = [
  'Cycle 1: Strategic Foundations & Core Architecture',
  'Cycle 2: Operational Implementation, Code & Vulnerability Audit',
  'Cycle 3: Adversarial Stress-Test & Invariant Synthesis',
  'Cycle 4: Optimization, Performance & Scalability',
  'Cycle 5: Comprehensive Cross-Model Alignment & Verification',
  'Cycle 6: Final Hardened Blueprint & Actionable Execution',
];

/**
 * Overnight plan: every exhibit part is read. Night-shift passes after that
 * falsify the ledger. We never skip unread parts to fit a cycle budget.
 */
export function buildOvernightPlan(opts: {
  goal: string;
  files?: ExhibitSource[];
  carriedContext?: string;
  passes: number;
  pagesPerChunk?: number;
  mode?: 'autonomous' | 'mini_deliberation' | 'model_rotation';
}): OvernightPlan {
  const launch = canLaunchNexus({ files: opts.files, followUp: opts.carriedContext });
  if (!launch.ok) {
    return {
      ok: false,
      reason: launch.reason,
      wasChunked: false,
      messages: [launch.reason || 'cannot launch'],
      passes: [],
      docPlan: null,
      manifest: renderExhibitManifest(opts.files || []),
    };
  }

  const live = liveExhibits(opts.files);
  const goal = (opts.goal || '').trim() || 'Produce a plan from the attached exhibits.';
  const carried = opts.carriedContext
    ? `\n\n[Prior Mission Consensus Memory]:\n${opts.carriedContext}`
    : '';
  const mode = opts.mode || 'autonomous';
  const nightPasses = Math.max(1, opts.passes || 1);
  const messages: string[] = [];

  if (live.length === 0) {
    messages.push('Follow-up only — no new exhibits. Falsifying the prior consensus.');
    return {
      ok: true,
      wasChunked: false,
      messages,
      passes: themePasses(mode, nightPasses, goal, '', carried),
      docPlan: null,
      manifest: renderExhibitManifest([]),
    };
  }

  const pagesPerChunk = opts.pagesPerChunk ?? 20;
  const docPlan = chunkDocuments(
    live.map((f) => ({ name: f.name, content: f.content })),
    { pagesPerChunk }
  );
  messages.push(renderExhibitManifest(live));
  messages.push(...docPlan.messages);

  const attachmentBlock =
    `\n\n[Attached exhibits]:\n` + live.map((f) => `--- File: ${f.name} ---\n${f.content}`).join('\n\n');

  if (!docPlan.wasChunked) {
    messages.push(`All ${live.length} exhibit(s) fit in one read. ${nightPasses} overnight pass(es) will work them.`);
    return {
      ok: true,
      wasChunked: false,
      messages,
      passes: themePasses(mode, nightPasses, goal, attachmentBlock, carried),
      docPlan,
      manifest: renderExhibitManifest(live),
    };
  }

  const chunks = docPlan.chunks;
  messages.push(`Reading ${chunks.length} exhibit part(s) before any falsification.`);
  const passes: OvernightPass[] = chunks.map((c, i) => ({
    label: `📄 Part ${i + 1}/${chunks.length} · ${c.sourceName} (~${c.estimatedPages} pages)`,
    iter: i + 1,
    query: `[Exhibit part ${i + 1} of ${chunks.length}]\nDirective: ${goal}${carried}\n\n[Document: ${c.sourceName} — Section ${c.index + 1}/${c.total}, ~${c.estimatedPages} pages]\n${c.content}\n\nReview this section against the directive. Report facts, numbers, risks, and open questions. Quote the passage. Do not invent files that are not here.`,
  }));

  passes.push({
    label: '🧠 Final cross-exhibit synthesis',
    iter: passes.length + 1,
    query: '',
    isFinalSynthesis: true,
  });

  const extraFalsify = Math.max(0, nightPasses - 1);
  for (let i = 0; i < extraFalsify; i++) {
    passes.push({
      label: `🌙 Overnight falsify ${i + 1}/${extraFalsify}`,
      iter: passes.length + 1,
      query: `[Overnight falsify ${i + 1}/${extraFalsify}]\nDirective: ${goal}${carried}\n\nYou already reviewed every exhibit part. Adversarially falsify the running ledger. Do not invent new source documents.`,
    });
  }

  return {
    ok: true,
    wasChunked: true,
    messages,
    passes,
    docPlan,
    manifest: renderExhibitManifest(live),
  };
}

function themePasses(
  mode: 'autonomous' | 'mini_deliberation' | 'model_rotation',
  count: number,
  goal: string,
  attachmentBlock: string,
  carried: string
): OvernightPass[] {
  if (mode === 'mini_deliberation') {
    return [
      {
        label: '⚖️ Mini Deliberation Consensus Pass',
        iter: 1,
        query: `[Nexus Mini Deliberation Pass]:\nDirective: ${goal}${attachmentBlock}${carried}\n\nProvide your authoritative analysis and distinct technical recommendations for consensus synthesis.`,
      },
    ];
  }
  if (mode === 'model_rotation') {
    return Array.from({ length: count }, (_, i) => ({
      label: `🔄 ${ROTATION_THEMES[i % ROTATION_THEMES.length]}`,
      iter: i + 1,
      query: `[Nexus Model Rotation — ${ROTATION_THEMES[i % ROTATION_THEMES.length]}]:\nDirective: ${goal}${attachmentBlock}${carried}\n\nFocus deeply on the specific domain of this rotation cycle. Ground every claim in the exhibits.`,
    }));
  }
  return Array.from({ length: count }, (_, i) => ({
    label: `⚡ Cycle ${i + 1}/${count}`,
    iter: i + 1,
    query: `[Nexus Lab Cycle ${i + 1}/${count}]:\nDirective: ${goal}${attachmentBlock}${carried}\n\nWork the exhibits. A plan with no exhibit citations is incomplete.`,
  }));
}
