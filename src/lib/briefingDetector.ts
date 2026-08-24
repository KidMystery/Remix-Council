/**
 * Council Briefings — the Oracle's "Unasked Verdict" detection.
 *
 * Pure local clustering over recent user messages across Oracle threads.
 * Detection costs ZERO tokens: it only notices that the owner keeps circling
 * a question, then offers to convene a mini-council. Nothing is ever spent
 * until the owner explicitly clicks "Convene".
 *
 * Guardrails (matching the Oracle's companion character):
 *  - Only question-like messages count (decision/lookup phrasing), so
 *    ordinary chatter never triggers a briefing.
 *  - Personal topics (family, health, relationships…) are excluded — the
 *    warm companion never proposes a "council" for those.
 *  - Dismissed topics stay quiet; a *new* mention re-opens the suggestion.
 */

import type { OracleThread } from './oracleStore';

export const ORACLE_BRIEFINGS_UPDATED_EVENT = 'council-oracle-briefings-updated';
const BRIEFINGS_KEY = 'council-oracle-briefings-v1';

export interface BriefingSettings {
  enabled: boolean;
  /** How many total mentions across threads before a suggestion appears (2–6). */
  minMentions: number;
  /** How far back to look, in days (3–30). */
  lookbackDays: number;
}

export interface BriefingCandidate {
  /** Stable topic key (sorted significant words). */
  key: string;
  /** Human label, e.g. "roof estimate siding". */
  label: string;
  mentions: number;
  threads: number;
  newestAt: number;
  /** The most recent user message in this cluster (representative framing). */
  sample: string;
}

export interface BriefingStore {
  settings: BriefingSettings;
  /** topicKey -> timestamp of dismissal */
  dismissed: Record<string, number>;
  /** topicKey -> timestamp of convening (topics are not re-suggested) */
  convened: Record<string, number>;
}

export const DEFAULT_BRIEFING_SETTINGS: BriefingSettings = {
  enabled: true,
  minMentions: 3,
  lookbackDays: 14,
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was',
  'have', 'has', 'had', 'not', 'but', 'all', 'any', 'can', 'could', 'would',
  'should', 'will', 'shall', 'may', 'might', 'must', 'about', 'into', 'over',
  'from', 'they', 'them', 'their', 'there', 'here', 'when', 'where', 'which',
  'what', 'who', 'whom', 'how', 'why', 'then', 'than', 'too', 'very', 'just',
  'really', 'more', 'most', 'some', 'our', 'out', 'off', 'its', 'his', 'her',
  'him', 'she', 'get', 'got', 'need', 'want', 'like', 'make', 'made', 'use',
  'used', 'using', 'via', 'per', 'was', 'were', 'been', 'being', 'does', 'did',
  'doing', 'don', 'doesn', 'isn', 'aren', 'wasn', 'weren', 'please', 'thanks',
  'thank', 'also', 'even', 'still', 'only', 'one', 'two', 'way', 'lot', 'much',
]);

/** Topics the companion never convenes a council about. */
const PERSONAL_WORDS = new Set([
  'son', 'daughter', 'child', 'children', 'kid', 'kids', 'wife', 'husband',
  'partner', 'girlfriend', 'boyfriend', 'mom', 'dad', 'mother', 'father',
  'family', 'families', 'brother', 'sister', 'grandma', 'grandpa', 'grandparent',
  'grandparents', 'marriage', 'divorce', 'relationship', 'health', 'therapy',
  'therapist', 'grief', 'feelings', 'feeling', 'upset', 'anxious', 'anxiety',
  'depressed', 'depression', 'sick', 'illness', 'diagnosis', 'funeral',
]);

const QUESTION_PATTERNS: RegExp[] = [
  /\?/,
  /\b(should|which|better|best|worth|compare|comparing|versus|vs)\b/,
  /\b(cost|costs|price|prices|pricing|quote|quotes|estimate|estimates|estimating|budget|bid|bids|contractor|vendor|supplier|option|options|choose|decide|decision)\b/,
];

export function extractSignificantWords(text: string): string[] {
  const lower = (text || '').toLowerCase().replace(/[^a-z0-9\s$%]/g, ' ');
  return lower
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        !STOPWORDS.has(w) &&
        !/^\d+(\.\d+)?$/.test(w) &&
        !/^[$%]/.test(w)
    )
    .slice(0, 24);
}

/** A message only counts toward a briefing if it reads like a decision/lookup question. */
export function isBriefingWorthyMessage(content: string): boolean {
  const text = (content || '').trim();
  if (text.length < 24 || text.length > 500) return false;
  const lower = text.toLowerCase();
  return QUESTION_PATTERNS.some((re) => re.test(lower));
}

interface MessageNode {
  threadId: string;
  text: string;
  words: string[];
  at: number;
}

function collectNodes(threads: OracleThread[], windowMs: number, now: number): MessageNode[] {
  const nodes: MessageNode[] = [];
  for (const t of threads) {
    const msgs = (t.messages || []).filter((m) => m.role === 'user');
    const recent = msgs.slice(-12);
    for (const m of recent) {
      if (!m.timestamp || now - m.timestamp > windowMs) continue;
      if (!isBriefingWorthyMessage(m.content)) continue;
      const words = extractSignificantWords(m.content);
      if (words.length === 0) continue;
      nodes.push({ threadId: t.id, text: m.content.trim(), words, at: m.timestamp });
    }
  }
  return nodes;
}

function cluster(nodes: MessageNode[]): number[][] {
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = new Set(nodes[i].words);
      let shared = 0;
      for (const w of nodes[j].words) if (a.has(w)) shared++;
      // Link when two messages share at least two significant words, or when
      // both are short question-like messages sharing one word (common phrasing
      // like "compare these two roof estimates" vs "which roof quote should I
      // take"). Longer messages need two shared words to avoid over-merging.
      const bothShort = nodes[i].words.length <= 6 && nodes[j].words.length <= 6;
      const link = shared >= 2 || (shared >= 1 && bothShort);
      if (link) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  nodes.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });
  return Array.from(groups.values());
}

/**
 * Detects briefing candidates from the owner's recent question-like messages.
 * Pure and deterministic — no model calls, no storage access.
 */
export function detectBriefingCandidates(
  threads: OracleThread[],
  opts: { minMentions: number; lookbackDays: number; now?: number }
): BriefingCandidate[] {
  const now = opts.now ?? Date.now();
  const windowMs = (opts.lookbackDays || 14) * 86_400_000;
  const nodes = collectNodes(threads, windowMs, now);
  const groups = cluster(nodes);

  const candidates: BriefingCandidate[] = [];
  for (const group of groups) {
    const members = group.map((i) => nodes[i]);
    const threadIds = new Set(members.map((m) => m.threadId));
    if (threadIds.size < 2) continue;
    if (members.length < (opts.minMentions || 3)) continue;

    const freq = new Map<string, number>();
    let hasPersonalWord = false;
    for (const m of members) {
      for (const w of m.words) {
        freq.set(w, (freq.get(w) || 0) + 1);
        if (PERSONAL_WORDS.has(w)) hasPersonalWord = true;
      }
    }
    if (hasPersonalWord) continue;

    const topWords = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([w]) => w);

    const keyWords = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([w]) => w)
      .sort();

    const newest = members.reduce((acc, m) => Math.max(acc, m.at), 0);

    candidates.push({
      key: keyWords.join('+'),
      label: topWords.join(' '),
      mentions: members.length,
      threads: threadIds.size,
      newestAt: newest,
      sample: members.reduce((acc, m) => (m.at >= acc ? m.at : acc), 0)
        ? members.find((m) => m.at === newest)?.text.slice(0, 180) || ''
        : '',
    });
  }

  return candidates.sort((a, b) => b.mentions - a.mentions).slice(0, 3);
}

/**
 * Applies the owner's stored preferences: disabled → none; dismissed topics
 * stay quiet unless a NEW mention arrived after the dismissal; convened
 * topics are never re-suggested.
 */
export function filterBriefingCandidates(
  candidates: BriefingCandidate[],
  store: BriefingStore
): BriefingCandidate[] {
  if (!store.settings.enabled) return [];
  return candidates.filter((c) => {
    if (store.convened[c.key]) return false;
    const dismissedAt = store.dismissed[c.key];
    if (dismissedAt && c.newestAt <= dismissedAt) return false;
    return true;
  });
}

export function loadBriefingStore(): BriefingStore {
  const base: BriefingStore = {
    settings: { ...DEFAULT_BRIEFING_SETTINGS },
    dismissed: {},
    convened: {},
  };
  try {
    const raw = localStorage.getItem(BRIEFINGS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      settings: { ...base.settings, ...(parsed.settings || {}) },
      dismissed: parsed.dismissed && typeof parsed.dismissed === 'object' ? parsed.dismissed : {},
      convened: parsed.convened && typeof parsed.convened === 'object' ? parsed.convened : {},
    };
  } catch (err) {
    console.warn('[Briefings] Failed to load store:', err);
    return base;
  }
}

function saveBriefingStore(store: BriefingStore): void {
  try {
    localStorage.setItem(BRIEFINGS_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('[Briefings] Failed to save store:', err);
  }
  try {
    window.dispatchEvent(new CustomEvent(ORACLE_BRIEFINGS_UPDATED_EVENT));
  } catch {
    /* non-browser environment */
  }
}

export function dismissBriefingTopic(key: string): void {
  const store = loadBriefingStore();
  store.dismissed[key] = Date.now();
  saveBriefingStore(store);
}

export function recordBriefingConvened(key: string): void {
  const store = loadBriefingStore();
  store.convened[key] = Date.now();
  saveBriefingStore(store);
}

export function updateBriefingSettings(patch: Partial<BriefingSettings>): BriefingSettings {
  const store = loadBriefingStore();
  store.settings = { ...store.settings, ...patch };
  saveBriefingStore(store);
  return store.settings;
}

export function capitalizeLabel(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
