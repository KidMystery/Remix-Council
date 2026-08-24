/**
 * Oracle (living assistant) persistence layer.
 *
 * Threads hold a chat history plus a per-thread "Bible" — a concise, current,
 * self-contained summary the assistant maintains and references every turn.
 * A separate global Bible persists knowledge across all threads.
 */

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

export interface OracleBible {
  content: string;
  updatedAt: number;
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
const MAX_MESSAGES = 200;

export const ORACLE_DEFAULT_MODEL = 'google/gemini-2.5-flash';

export const DEFAULT_MINI_DELIBERATION_MODELS: string[] = [
  'anthropic/claude-3.7-sonnet',
  'openai/gpt-4o',
  'google/gemini-2.5-flash',
];

export const DEFAULT_ROTATION_ROSTER: string[] = [
  'anthropic/claude-3.7-sonnet',
  'openai/gpt-4o',
  'google/gemini-2.5-flash',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.3-70b-instruct',
];

export const ORACLE_MODEL_OPTIONS: { id: string; name: string; tag?: string; vision: boolean }[] = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', tag: 'Fast & Smart', vision: true },
  { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', tag: 'Top Frontier', vision: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o', tag: 'Omni Frontier', vision: true },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', tag: 'Deep Context', vision: true },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 Chat', tag: 'Efficient Reasoning', vision: false },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', tag: 'Math & Logic', vision: false },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', tag: 'Open Weights', vision: false },
  { id: 'mistralai/mistral-large-2411', name: 'Mistral Large 2411', tag: 'Frontier EU', vision: true },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct', tag: 'Coding & Multilingual', vision: false },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Exp (Free)', tag: 'Free Tier', vision: true },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', tag: 'Free Tier', vision: false },
];

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
    return Array.isArray(parsed) ? parsed : [];
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
  }
}

export function loadGlobalBible(): OracleBible {
  try {
    const raw = localStorage.getItem(GLOBAL_BIBLE_KEY);
    if (!raw) return { content: '', updatedAt: Date.now() };
    const parsed = JSON.parse(raw);
    return typeof parsed?.content === 'string'
      ? { content: parsed.content, updatedAt: parsed.updatedAt || Date.now() }
      : { content: '', updatedAt: Date.now() };
  } catch (err) {
    console.warn('[OracleStore] Failed to load global Bible:', err);
    return { content: '', updatedAt: Date.now() };
  }
}

export function saveGlobalBible(bible: OracleBible): void {
  try {
    localStorage.setItem(GLOBAL_BIBLE_KEY, JSON.stringify(bible));
  } catch (err) {
    console.warn('[OracleStore] Failed to save global Bible:', err);
  }
}

export function exportOracleThreads(threads: OracleThread[], globalBible: OracleBible): string {
  return JSON.stringify({ version: 1, exportedAt: Date.now(), threads, globalBible }, null, 2);
}

export function importOracleThreads(jsonString: string): {
  success: boolean;
  message: string;
  threads?: OracleThread[];
  globalBible?: OracleBible;
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
  return {
    success: true,
    message: `Imported ${parsed.threads.length} thread(s).`,
    threads: parsed.threads as OracleThread[],
    globalBible: parsed.globalBible as OracleBible | undefined,
  };
}
