/**
 * Oracle → Chamber handoff.
 *
 * One rule: we send a Case brief, never the raw vent. The operator stays
 * the editor. Chamber may stamp. Only a stamped invariant may be offered
 * to the Global Bible — never auto-written.
 *
 * Debug: if Chamber opened empty, inspect session.handoff in DevTools.
 */

import { detectTaskDomain, type TaskDomain } from './smartModelSelector';

export const CHAMBER_COMMAND = '/chamber';

export interface ChamberHandoff {
  source: 'oracle';
  threadId: string;
  threadTitle: string;
  question: string;
  brief: string;
  domain: TaskDomain;
  createdAt: number;
  /** Set when the operator admits stamped invariants into the Global Bible. */
  bibleAdmittedAt?: number;
}

export function parseChamberCommand(text: string): { isCommand: boolean; question: string } {
  const raw = (text || '').trim();
  const match = raw.match(/^\/chamber(?:\s+([\s\S]+))?$/i);
  if (!match) return { isCommand: false, question: raw };
  return { isCommand: true, question: (match[1] || '').trim() };
}

function clip(text: string, max: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function lastUserQuestion(
  messages: Array<{ role?: string; content?: string }> | undefined
): string {
  const list = messages || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m?.role === 'user' && (m.content || '').trim()) {
      const parsed = parseChamberCommand(m.content || '');
      if (parsed.isCommand && parsed.question) return parsed.question;
      if (!parsed.isCommand) return (m.content || '').trim();
    }
  }
  return '';
}

/**
 * Local brief. No extra model call — 2G-safe, stranger-debuggable.
 * Pro models get this dense page, not 200 turns of venting.
 */
export function buildCaseBrief(input: {
  threadId: string;
  threadTitle?: string;
  question?: string;
  messages?: Array<{ role?: string; content?: string }>;
  threadBible?: string;
  globalBible?: string;
  now?: number;
}): ChamberHandoff {
  const question =
    (input.question || '').trim() || lastUserQuestion(input.messages) || 'Convene on the current conversation.';
  const domain = detectTaskDomain(question);
  const recentUsers = (input.messages || [])
    .filter((m) => m?.role === 'user' && (m.content || '').trim())
    .slice(-6)
    .map((m) => `- ${clip(m.content || '', 220)}`);

  const lines = [
    'CASE BRIEF',
    `Question: ${question}`,
    `Domain: ${domain}`,
    '',
    'What the operator has been circling',
    recentUsers.length > 0 ? recentUsers.join('\n') : '- (no prior user turns)',
    '',
    'Thread Bible (working memory — not law)',
    clip(input.threadBible || '', 900) || '(empty)',
    '',
    'Global Bible (standing claims — challenge, do not restate)',
    clip(input.globalBible || '', 700) || '(empty)',
    '',
    'Chair instructions: decide the Question. Cite the Bibles or file a reversal. Do not restate the vent.',
  ];

  return {
    source: 'oracle',
    threadId: input.threadId || '',
    threadTitle: input.threadTitle || 'Oracle thread',
    question,
    brief: lines.join('\n'),
    domain,
    createdAt: input.now ?? Date.now(),
  };
}

/** Pull Consensus Invariants (or a short fallback) — never the whole essay. */
export function extractInvariants(synthesis: string | undefined): string {
  const text = (synthesis || '').trim();
  if (!text) return '';

  const heading = text.match(
    /(?:^|\n)#{1,3}\s*(?:consensus\s+)?invariants?\b[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|\n\*\*[A-Z]|$)/i
  );
  if (heading && heading[1].trim()) {
    return clip(heading[1].replace(/^[-*]\s+/gm, '• ').trim(), 1600);
  }

  const bullets = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]/.test(l) || /^\d+\./.test(l));
  if (bullets.length >= 2) {
    return clip(bullets.slice(0, 8).map((l) => l.replace(/^[-*]\s+/, '• ')).join('\n'), 1600);
  }

  return clip(text, 700);
}

export function admitInvariantsToBible(
  current: string,
  invariants: string,
  meta: { question: string; admittedAt?: number }
): string {
  const body = (invariants || '').trim();
  if (!body) return current || '';
  const when = new Date(meta.admittedAt ?? Date.now()).toISOString().slice(0, 10);
  const block = [
    `## Admitted ${when}`,
    `Question: ${clip(meta.question, 180)}`,
    body,
  ].join('\n');
  const next = current?.trim() ? `${current.trim()}\n\n${block}` : block;
  // Bible must stay a brief, not a corpus.
  if (next.length <= 12000) return next;
  return `${next.slice(next.length - 12000).trim()}`;
}
