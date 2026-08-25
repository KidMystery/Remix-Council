/**
 * The Bible is claims, not a diary.
 *
 * Sealed claims (Admit, or a pin) cannot be rewritten by Oracle, a Drive
 * last-write, or a Settings "Save Memory". Unsealed claims are working notes.
 *
 * Debug: loadGlobalBible().claims in DevTools. sealed === true is law.
 */

export type BibleClaimSource = 'oracle' | 'admit' | 'import';

export interface BibleClaim {
  id: string;
  text: string;
  source: BibleClaimSource;
  threadId?: string;
  question?: string;
  sealed: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface OracleBible {
  content: string;
  updatedAt: number;
  claims?: BibleClaim[];
}

export const MAX_BIBLE_CHARS = 12000;

export function normalizeClaimText(text: string): string {
  return (text || '').replace(/\s+/g, ' ').replace(/^[-*•]\s+/, '').trim();
}

/** Short stable id. Same wording → same claim. */
export function claimIdFor(text: string): string {
  const n = normalizeClaimText(text).toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `claim_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function emptyBible(now = Date.now()): OracleBible {
  return { content: '', updatedAt: now, claims: [] };
}

function liveClaims(bible: OracleBible | null | undefined): BibleClaim[] {
  return (bible?.claims || []).filter((c) => c && c.id && c.text && !c.deletedAt);
}

export function renderBiblePrompt(bible: OracleBible | null | undefined): string {
  const live = liveClaims(bible);
  const law = live.filter((c) => c.sealed);
  const notes = live.filter((c) => !c.sealed);
  const lines: string[] = [];
  if (law.length) {
    lines.push('LAW (sealed — do not rewrite, contradict only by filing a reversal)');
    for (const c of law) lines.push(`- [${c.id}] ${c.text}`);
  } else {
    lines.push('LAW (sealed): (none)');
  }
  lines.push('');
  if (notes.length) {
    lines.push('Working notes (unsealed — may be updated)');
    const budget = 1500;
    let used = 0;
    for (const c of notes) {
      const line = `- ${c.text}`;
      if (used + line.length > budget) break;
      lines.push(line);
      used += line.length + 1;
    }
  } else {
    lines.push('Working notes: (none)');
  }
  return lines.join('\n');
}

export function finalizeBible(claims: BibleClaim[], now = Date.now()): OracleBible {
  const live = claims.filter((c) => c && !c.deletedAt);
  return {
    claims,
    updatedAt: now,
    content: renderBiblePrompt({ content: '', updatedAt: now, claims: live }),
  };
}

/** Legacy string / `{ content }` → claims. Admitted headings become sealed. */
export function hydrateBible(raw: unknown, now = Date.now()): OracleBible {
  if (!raw || typeof raw !== 'object') {
    if (typeof raw === 'string') return hydrateFromBlob(raw, now);
    return emptyBible(now);
  }
  const doc = raw as OracleBible;
  if (Array.isArray(doc.claims) && doc.claims.length > 0) {
    const claims = doc.claims.filter((c) => c && typeof c.text === 'string' && c.id);
    return finalizeBible(claims, doc.updatedAt || now);
  }
  return hydrateFromBlob(typeof doc.content === 'string' ? doc.content : '', doc.updatedAt || now);
}

function hydrateFromBlob(blob: string, now: number): OracleBible {
  const text = (blob || '').trim();
  if (!text) return emptyBible(now);
  const claims: BibleClaim[] = [];
  const admitted = text.split(/(?=^## Admitted )/m);
  for (const part of admitted) {
    const isAdmit = /^## Admitted /m.test(part);
    const q = part.match(/^Question:\s*(.+)$/m)?.[1];
    const body = part.replace(/^## Admitted [^\n]*\n/, '').replace(/^Question:\s*.+\n/, '');
    const bits = splitClaimLines(body);
    if (bits.length === 0 && part.trim() && !isAdmit) {
      const rest = splitClaimLines(part);
      for (const line of rest) claims.push(makeClaim(line, 'import', false, now));
      continue;
    }
    for (const line of bits) {
      claims.push(makeClaim(line, isAdmit ? 'admit' : 'import', isAdmit, now, q));
    }
  }
  if (claims.length === 0 && text) claims.push(makeClaim(text.slice(0, 700), 'import', false, now));
  return finalizeBible(dedupeClaims(claims), now);
}

function splitClaimLines(text: string): string[] {
  const lines = (text || '')
    .split('\n')
    .map((l) => normalizeClaimText(l).replace(/^\[claim_[0-9a-f]+\]\s*/i, ''))
    .filter((l) => l.length > 2)
    .filter((l) => !/^LAW\b/i.test(l) && !/^Working notes/i.test(l) && !/^CASE BRIEF/i.test(l));
  if (lines.length >= 1) return lines.slice(0, 40);
  return [];
}

function makeClaim(
  text: string,
  source: BibleClaimSource,
  sealed: boolean,
  now: number,
  question?: string
): BibleClaim {
  const t = normalizeClaimText(text);
  return {
    id: claimIdFor(t),
    text: t,
    source,
    sealed,
    createdAt: now,
    updatedAt: now,
    question,
  };
}

function dedupeClaims(claims: BibleClaim[]): BibleClaim[] {
  const map = new Map<string, BibleClaim>();
  for (const c of claims) {
    const prev = map.get(c.id);
    if (!prev) {
      map.set(c.id, c);
      continue;
    }
    map.set(c.id, mergeClaim(prev, c));
  }
  return [...map.values()];
}

export function mergeClaim(a: BibleClaim, b: BibleClaim): BibleClaim {
  const aSealed = a.sealed && !a.deletedAt;
  const bSealed = b.sealed && !b.deletedAt;
  if (aSealed && !bSealed) return { ...a, deletedAt: undefined };
  if (bSealed && !aSealed) return { ...b, deletedAt: undefined };
  if (aSealed && bSealed) {
    return a.createdAt <= b.createdAt ? { ...a, deletedAt: undefined } : { ...b, deletedAt: undefined };
  }
  const laterDel = Math.max(a.deletedAt || 0, b.deletedAt || 0);
  const laterUp = Math.max(a.updatedAt, b.updatedAt);
  if (laterDel > 0 && laterDel >= laterUp) {
    const base = a.updatedAt >= b.updatedAt ? a : b;
    return { ...base, deletedAt: laterDel };
  }
  return a.updatedAt >= b.updatedAt ? { ...a, deletedAt: undefined } : { ...b, deletedAt: undefined };
}

export function mergeBibles(local: unknown, remote: unknown, now = Date.now()): OracleBible {
  const a = hydrateBible(local, now);
  const b = hydrateBible(remote, now);
  const map = new Map<string, BibleClaim>();
  for (const c of a.claims || []) map.set(c.id, c);
  for (const c of b.claims || []) {
    const prev = map.get(c.id);
    map.set(c.id, prev ? mergeClaim(prev, c) : c);
  }
  return capBible(finalizeBible([...map.values()], now));
}

/** Oracle / Settings rewrite: replace unsealed notes. Copy sealed forward. */
export function applyOracleRewrite(
  current: unknown,
  incomingText: string,
  now = Date.now()
): OracleBible {
  const cur = hydrateBible(current, now);
  const sealed = (cur.claims || []).filter((c) => c.sealed && !c.deletedAt);
  const sealedIds = new Set(sealed.map((c) => c.id));
  const incoming = splitClaimLines(incomingText)
    .map((line) => makeClaim(line, 'oracle', false, now))
    .filter((c) => !sealedIds.has(c.id));
  const tombstoned = (cur.claims || []).filter((c) => c.deletedAt);
  return capBible(finalizeBible([...sealed, ...incoming, ...tombstoned], now));
}

export function admitInvariantLines(
  current: unknown,
  invariants: string,
  meta: { question?: string; admittedAt?: number; threadId?: string }
): OracleBible {
  const now = meta.admittedAt ?? Date.now();
  const cur = hydrateBible(current, now);
  const map = new Map((cur.claims || []).map((c) => [c.id, { ...c }]));
  const lines = splitClaimLines(invariants);
  const fallback = normalizeClaimText(invariants);
  const toSeal = lines.length > 0 ? lines : fallback ? [fallback] : [];
  for (const line of toSeal) {
    const id = claimIdFor(line);
    const prev = map.get(id);
    if (prev?.sealed && !prev.deletedAt) continue;
    map.set(id, {
      id,
      text: normalizeClaimText(line),
      source: 'admit',
      sealed: true,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
      question: meta.question,
      threadId: meta.threadId,
      deletedAt: undefined,
    });
  }
  return capBible(finalizeBible([...map.values()], now));
}

export function dropUnsealed(current: unknown, now = Date.now()): OracleBible {
  const cur = hydrateBible(current, now);
  const next = (cur.claims || []).map((c) =>
    c.sealed ? c : { ...c, deletedAt: now, updatedAt: now }
  );
  return capBible(finalizeBible(next, now));
}

/** Drop oldest unsealed first. Never drop sealed to make quota. */
export function capBible(bible: OracleBible): OracleBible {
  const claims = [...(bible.claims || [])];
  const sizeOf = () => JSON.stringify(finalizeBible(claims, bible.updatedAt)).length;
  if (sizeOf() <= MAX_BIBLE_CHARS * 2) return bible;

  const unsealed = claims
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.sealed && !c.deletedAt)
    .sort((a, b) => a.c.updatedAt - b.c.updatedAt);
  for (const { i } of unsealed) {
    claims[i] = { ...claims[i], deletedAt: bible.updatedAt, updatedAt: bible.updatedAt };
    if (sizeOf() <= MAX_BIBLE_CHARS * 2) break;
  }
  const next = finalizeBible(claims, bible.updatedAt);
  if (JSON.stringify(next).length > MAX_BIBLE_CHARS * 3) {
    throw new Error('Sealed Bible claims do not fit on this device. Export, then free space. Law was not dropped.');
  }
  return next;
}
