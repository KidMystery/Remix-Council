/**
 * Oracle (living assistant) persistence layer.
 *
 * Threads hold a chat history plus a per-thread "Bible" — a concise, current,
 * self-contained summary the assistant maintains and references every turn.
 * A separate global Bible persists knowledge across all threads.
 */

import type { OracleCustomModel } from './oracleModelPool';
import { hydrateBible, type OracleBible } from './bibleClaims';
import { dropLocalStorageKey, kvGet, kvSet, KV_KEYS, readLocalStorageJson } from './kvStore';
export type { BibleClaim } from './bibleClaims';
export type { OracleBible };

export interface OracleImage {
  name: string;
  /** data URL (base64) of the attached image */
  url: string;
}

export interface OracleTextFile {
  name: string;
  content: string;
}

export interface OracleMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: OracleImage[];
  files?: OracleTextFile[];
  timestamp: number;
  model?: string;
  error?: boolean;
  /** Which rotating voice produced this reply (when voice rotation is on). */
  voice?: { id: string; name: string; avatar: string };
  /** Small metadata note (e.g. "auto-expanded tokens ×2"). */
  note?: string;
}

export interface OracleThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  mode?: 'direct' | 'mini_deliberation' | 'rotation';
  miniDeliberationModels?: string[];
  rotationModels?: string[];
  reflectEnabled: boolean;
  webEnabled: boolean;
  rotateVoices: boolean;
  /** Rotate the model per voice too (budget tier). Requires a paid model. */
  rotateVoiceModels: boolean;
  /** Monotonic turn counter used to rotate voices deterministically. */
  turnCount: number;
  messages: OracleMessage[];
  bible: OracleBible;
}

const THREADS_KEY = 'council-oracle-threads-v1';
const GLOBAL_BIBLE_KEY = 'council-oracle-global-bible-v1';
const TOMBSTONE_KEY = 'council-oracle-tombstones-v1';
const MAX_MESSAGES = 200;

let memoryThreads: OracleThread[] | null = null;
let memoryBible: OracleBible | null = null;
let memoryTombstones: { id: string; deletedAt: number }[] | null = null;
let oracleHydrated = false;

function hydrateThreadList(raw: unknown): OracleThread[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    ...t,
    bible: hydrateBible(t?.bible),
  }));
}

/** Load IndexedDB first, then leftover localStorage. Safe to call more than once. */
export async function hydrateOracleFromIdb(): Promise<void> {
  if (oracleHydrated) return;
  try {
    const [threads, bible, stones] = await Promise.all([
      kvGet<unknown>(KV_KEYS.oracleThreads),
      kvGet<unknown>(KV_KEYS.oracleBible),
      kvGet<unknown>(KV_KEYS.oracleTombstones),
    ]);
    if (threads !== undefined) {
      memoryThreads = hydrateThreadList(threads);
    } else {
      const ls = readLocalStorageJson<unknown>(THREADS_KEY);
      memoryThreads = hydrateThreadList(ls);
      if (memoryThreads.length > 0) {
        await kvSet(KV_KEYS.oracleThreads, memoryThreads);
        dropLocalStorageKey(THREADS_KEY);
      }
    }
    if (bible !== undefined) {
      memoryBible = hydrateBible(bible);
    } else {
      const ls = readLocalStorageJson<unknown>(GLOBAL_BIBLE_KEY);
      if (ls) {
        memoryBible = hydrateBible(ls);
        await kvSet(KV_KEYS.oracleBible, memoryBible);
        dropLocalStorageKey(GLOBAL_BIBLE_KEY);
      }
    }
    if (Array.isArray(stones)) {
      memoryTombstones = stones as { id: string; deletedAt: number }[];
    } else {
      const ls = readLocalStorageJson<unknown>(TOMBSTONE_KEY);
      if (Array.isArray(ls)) {
        memoryTombstones = ls as { id: string; deletedAt: number }[];
        await kvSet(KV_KEYS.oracleTombstones, memoryTombstones);
        dropLocalStorageKey(TOMBSTONE_KEY);
      }
    }
  } catch (err) {
    console.warn('[OracleStore] IndexedDB hydrate failed:', err);
  }
  oracleHydrated = true;
}

/** Test seam. */
export function _resetOracleMemoryForTests(): void {
  memoryThreads = null;
  memoryBible = null;
  memoryTombstones = null;
  oracleHydrated = false;
}

export const ORACLE_DEFAULT_MODEL = 'google/gemini-2.5-flash';

/**
 * Curated frontier defaults (verified live against OpenRouter, Aug 24 2026).
 * Kept to current frontier models only — the full catalog remains available
 * in Settings → Oracle for manual picks, plus any custom id the owner adds.
 */
export const DEFAULT_MINI_DELIBERATION_MODELS: string[] = [
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-5.1',
  'google/gemini-2.5-flash',
];

export const DEFAULT_ROTATION_ROSTER: string[] = [
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-5.1',
  'google/gemini-2.5-pro',
  'google/gemini-3.7-flash',
  'deepseek/deepseek-v4-flash-0731',
];

/**
 * Oracle's curated model list — current frontier only, every id live-checked
 * against the OpenRouter catalog on Aug 24 2026. Vision flags come from each
 * model's actual catalog architecture (input_modalities), not guesswork.
 */
export const ORACLE_MODEL_OPTIONS: { id: string; name: string; tag?: string; vision: boolean }[] = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', tag: 'Frontier', vision: true },
  { id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', tag: 'Flagship', vision: true },
  { id: 'openai/gpt-5.1', name: 'GPT-5.1', tag: 'Frontier', vision: true },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', tag: 'Frontier', vision: true },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', tag: 'Fast Frontier', vision: true },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', tag: 'Fast Workhorse', vision: true },
  { id: 'meta/muse-spark-1.2', name: 'Muse Spark 1.2', tag: 'Frontier', vision: true },
  { id: 'z-ai/glm-5.3', name: 'GLM 5.3', tag: 'Reasoning', vision: false },
  { id: 'deepseek/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', tag: 'Fast Frontier', vision: false },
];

/**
 * Fallback vision-capable model for image attachments when the chosen model
 * is text-only (verified live, Aug 2026).
 */
export const VISION_SAFE_FALLBACK_MODEL = 'google/gemini-2.5-flash';

/** Broadcast when Oracle threads are edited outside the Oracle view (Settings). */
export const ORACLE_THREADS_UPDATED_EVENT = 'council-oracle-threads-updated';

/** Patches a stored Oracle thread by id and persists + broadcasts the update. */
export function patchOracleThread(
  threadId: string,
  patch: Partial<Omit<OracleThread, 'id'>>
): OracleThread[] {
  const threads = loadOracleThreads();
  const updated = threads.map((t) => (t.id === threadId ? { ...t, ...patch, updatedAt: Date.now() } : t));
  saveOracleThreads(updated);
  try {
    window.dispatchEvent(new CustomEvent(ORACLE_THREADS_UPDATED_EVENT));
  } catch {
    /* non-browser environment */
  }
  return updated;
}

export function newOracleThread(model: string = ORACLE_DEFAULT_MODEL): OracleThread {
  const now = Date.now();
  return {
    id: `oracle_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Conversation',
    createdAt: now,
    updatedAt: now,
    model,
    mode: 'direct',
    miniDeliberationModels: [...DEFAULT_MINI_DELIBERATION_MODELS],
    rotationModels: [...DEFAULT_ROTATION_ROSTER],
    reflectEnabled: true,
    webEnabled: true,
    rotateVoices: true,
    rotateVoiceModels: false,
    turnCount: 0,
    messages: [],
    bible: { content: '', updatedAt: now },
  };
}

export function loadOracleThreads(): OracleThread[] {
  if (memoryThreads) return memoryThreads;
  const ls = readLocalStorageJson<unknown>(THREADS_KEY);
  memoryThreads = hydrateThreadList(ls);
  return memoryThreads;
}

export function saveOracleThreads(threads: OracleThread[]): void {
  const sanitized = threads.map((t) => ({
    ...t,
    messages: (t.messages || []).slice(-MAX_MESSAGES),
  }));
  memoryThreads = sanitized;
  if (typeof indexedDB === 'undefined') {
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(sanitized));
    } catch (err) {
      console.warn('[OracleStore] Failed to save threads (quota?):', err);
      throw err instanceof Error
        ? err
        : new Error('Could not save this turn locally (storage full). Last good copy is still on this device.');
    }
    return;
  }
  void kvSet(KV_KEYS.oracleThreads, sanitized)
    .then(() => dropLocalStorageKey(THREADS_KEY))
    .catch((err) => {
      console.warn('[OracleStore] IndexedDB thread save failed. Last good copy stays.', err);
      try {
        localStorage.setItem(THREADS_KEY, JSON.stringify(sanitized));
      } catch (lsErr) {
        console.warn('[OracleStore] localStorage fallback also failed:', lsErr);
      }
    });
}

export function loadOracleTombstones(): { id: string; deletedAt: number }[] {
  if (memoryTombstones) return memoryTombstones;
  const ls = readLocalStorageJson<unknown>(TOMBSTONE_KEY);
  memoryTombstones = Array.isArray(ls) ? (ls as { id: string; deletedAt: number }[]) : [];
  return memoryTombstones;
}

export function saveOracleTombstones(stones: { id: string; deletedAt: number }[]): void {
  memoryTombstones = stones;
  void kvSet(KV_KEYS.oracleTombstones, stones)
    .then(() => dropLocalStorageKey(TOMBSTONE_KEY))
    .catch((err) => {
      console.warn('[OracleStore] Could not persist delete marks:', err);
      try {
        localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(stones));
      } catch {
        // last good copy stays
      }
    });
}

export function loadGlobalBible(): OracleBible {
  if (memoryBible) return memoryBible;
  const ls = readLocalStorageJson<unknown>(GLOBAL_BIBLE_KEY);
  memoryBible = ls ? hydrateBible(ls) : hydrateBible({ content: '', updatedAt: Date.now() });
  return memoryBible;
}

export function saveGlobalBible(bible: OracleBible): void {
  const normalized = hydrateBible(bible);
  memoryBible = normalized;
  if (typeof indexedDB === 'undefined') {
    try {
      localStorage.setItem(GLOBAL_BIBLE_KEY, JSON.stringify(normalized));
    } catch (err) {
      throw err instanceof Error
        ? err
        : new Error('Could not save the Bible locally (storage full). Sealed claims were not dropped.');
    }
    return;
  }
  void kvSet(KV_KEYS.oracleBible, normalized)
    .then(() => dropLocalStorageKey(GLOBAL_BIBLE_KEY))
    .catch((err) => {
      console.warn('[OracleStore] IndexedDB Bible save failed. Last good copy stays.', err);
      try {
        localStorage.setItem(GLOBAL_BIBLE_KEY, JSON.stringify(normalized));
      } catch (lsErr) {
        throw lsErr instanceof Error
          ? lsErr
          : new Error('Could not save the Bible locally (storage full). Sealed claims were not dropped.');
      }
    });
}

export function exportOracleThreads(
  threads: OracleThread[],
  globalBible: OracleBible,
  extras?: { customModels?: OracleCustomModel[]; directList?: string[] }
): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: Date.now(),
      threads,
      globalBible,
      customModels: extras?.customModels,
      directList: extras?.directList,
    },
    null,
    2
  );
}

export function importOracleThreads(jsonString: string): {
  success: boolean;
  message: string;
  threads?: OracleThread[];
  globalBible?: OracleBible;
  extras?: { customModels?: OracleCustomModel[]; directList?: string[] };
} {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    return { success: false, message: `Invalid JSON: ${err?.message || 'could not parse input.'}` };
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.threads)) {
    return { success: false, message: 'Invalid import format: expected an object with a "threads" array.' };
  }
  const extras =
    Array.isArray(parsed.customModels) || Array.isArray(parsed.directList)
      ? {
          customModels: Array.isArray(parsed.customModels)
            ? (parsed.customModels.filter((m: any) => m && typeof m.id === 'string') as OracleCustomModel[])
            : undefined,
          directList: Array.isArray(parsed.directList)
            ? (parsed.directList.filter((x: any) => typeof x === 'string') as string[])
            : undefined,
        }
      : undefined;
  return {
    success: true,
    message: `Imported ${parsed.threads.length} thread(s).`,
    threads: parsed.threads as OracleThread[],
    globalBible: parsed.globalBible as OracleBible | undefined,
    extras,
  };
}

/**
 * Error-message hygiene (Aug 2026 storm follow-up): error bubbles are live
 * diagnostics, not permanent furniture. The moment a thread has a successful
 * assistant message AFTER an error, that error is resolved litter — prune it
 * on commit. Errors after the LAST success (the currently-broken tail) stay:
 * they are what the user still needs to see and retry.
 */
export function pruneStaleOracleErrors(messages: OracleMessage[]): OracleMessage[] {
  const list = Array.isArray(messages) ? messages : [];
  let lastSuccessIdx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'assistant' && !list[i]?.error) {
      lastSuccessIdx = i;
      break;
    }
  }
  if (lastSuccessIdx === -1) return list; // never succeeded — keep diagnostics
  return list.filter((m, i) => !m?.error || i > lastSuccessIdx);
}
