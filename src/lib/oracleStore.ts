/**
 * Oracle (living assistant) persistence layer.
 *
 * Threads hold a chat history plus a per-thread "Bible" — a concise, current,
 * self-contained summary the assistant maintains and references every turn.
 * A separate global Bible persists knowledge across all threads.
 */

import type { OracleCustomModel } from './oracleModelPool';
import { hydrateBible, type OracleBible } from './bibleClaims';
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
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => ({
      ...t,
      bible: hydrateBible(t?.bible),
    }));
  } catch (err) {
    console.warn('[OracleStore] Failed to load threads:', err);
    return [];
  }
}

export function saveOracleThreads(threads: OracleThread[]): void {
  try {
    // Cap message history by count to stay within localStorage quota.
    const sanitized = threads.map((t) => ({
      ...t,
      messages: (t.messages || []).slice(-MAX_MESSAGES),
    }));
    localStorage.setItem(THREADS_KEY, JSON.stringify(sanitized));
  } catch (err) {
    console.warn('[OracleStore] Failed to save threads (quota?):', err);
    throw err instanceof Error
      ? err
      : new Error('Could not save this turn locally (storage full). Last good copy is still on this device.');
  }
}

export function loadOracleTombstones(): { id: string; deletedAt: number }[] {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOracleTombstones(stones: { id: string; deletedAt: number }[]): void {
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(stones));
  } catch (err) {
    console.warn('[OracleStore] Could not persist delete marks:', err);
  }
}

export function loadGlobalBible(): OracleBible {
  try {
    const raw = localStorage.getItem(GLOBAL_BIBLE_KEY);
    if (!raw) return hydrateBible({ content: '', updatedAt: Date.now() });
    return hydrateBible(JSON.parse(raw));
  } catch (err) {
    console.warn('[OracleStore] Failed to load global Bible:', err);
    return hydrateBible({ content: '', updatedAt: Date.now() });
  }
}

export function saveGlobalBible(bible: OracleBible): void {
  const normalized = hydrateBible(bible);
  try {
    localStorage.setItem(GLOBAL_BIBLE_KEY, JSON.stringify(normalized));
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error('Could not save the Bible locally (storage full). Sealed claims were not dropped.');
  }
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
