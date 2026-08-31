/**
 * Oracle server-side persistence (Phase 2 — server becomes source of truth).
 *
 * JSON files under a configurable data directory:
 *   threads.json       → OracleThread[] (raw entries, full message history)
 *   global-bible.json  → OracleBible snapshot
 *
 * Shape parity: types are reused from src/lib/oracleStore.ts via type-only
 * imports (erased at compile time — no browser code is pulled in), and Bible
 * building/hydration is NOT duplicated: the shared builder in
 * src/lib/bibleClaims.ts (hydrateBible) runs here too. The server stores RAW
 * entries plus the last bible snapshot the client (or this store) produced.
 *
 * Writes are atomic: tmp file + rename. mkdir -p on every write.
 */

import fs from 'fs';
import path from 'path';
import { hydrateBible, emptyBible, type OracleBible } from '../lib/bibleClaims';
import type { OracleMessage, OracleThread } from '../lib/oracleStore';

export interface OracleAppendEntryInput {
  threadId?: string;
  text: string;
  ts?: number;
  /** Optional actor identity from the x-agent-name header (default "web"). */
  agent?: string;
}

export interface OracleSyncInput {
  threads: OracleThread[];
  bible?: OracleBible | null;
}

export interface OracleServerStore {
  getThreads(): OracleThread[];
  getThread(id: string): OracleThread | null;
  getBible(): OracleBible;
  appendEntry(input: OracleAppendEntryInput): OracleThread;
  sync(input: OracleSyncInput): { threads: OracleThread[]; bible: OracleBible };
}

const ORACLE_DEFAULT_MODEL = 'google/gemini-2.5-flash';
const MAX_MESSAGES = 200;

function newThreadId(now: number): string {
  return `oracle_${now}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Default thread shape mirrors newOracleThread() in src/lib/oracleStore.ts. */
function newThread(now: number, title: string): OracleThread {
  return {
    id: newThreadId(now),
    title,
    createdAt: now,
    updatedAt: now,
    model: ORACLE_DEFAULT_MODEL,
    mode: 'direct',
    reflectEnabled: true,
    webEnabled: true,
    rotateVoices: true,
    rotateVoiceModels: false,
    turnCount: 0,
    messages: [],
    bible: emptyBible(now),
  };
}

/** Atomic JSON write: tmp + rename, mkdir -p first. */
function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createOracleServerStore(dataDir: string): OracleServerStore {
  const threadsFile = path.join(dataDir, 'threads.json');
  const bibleFile = path.join(dataDir, 'global-bible.json');

  const loadThreads = (): OracleThread[] => {
    const raw = readJson<unknown>(threadsFile, []);
    return Array.isArray(raw) ? (raw as OracleThread[]) : [];
  };

  const loadBible = (): OracleBible => hydrateBible(readJson<unknown>(bibleFile, null));

  const store: OracleServerStore = {
    getThreads: () => loadThreads(),

    getThread: (id) => loadThreads().find((t) => t?.id === id) || null,

    getBible: () => loadBible(),

    appendEntry: ({ threadId, text, ts, agent }) => {
      const now = Date.now();
      const when = typeof ts === 'number' && ts > 0 ? ts : now;
      const threads = loadThreads();
      const message: OracleMessage = {
        id: `msg_${when}_${Math.random().toString(36).slice(2, 7)}`,
        role: 'user',
        content: text,
        timestamp: when,
        agent: typeof agent === 'string' && agent.trim() ? agent.trim().slice(0, 64) : 'web',
      };
      let target =
        threadId && typeof threadId === 'string'
          ? threads.find((t) => t?.id === threadId)
          : undefined;
      if (!target) {
        const firstWords = text.trim().split(/\s+/).slice(0, 6).join(' ') || 'New Conversation';
        target = newThread(when, firstWords.slice(0, 60));
        threads.unshift(target);
      }
      target.messages = [...(target.messages || []), message].slice(-MAX_MESSAGES);
      target.updatedAt = now;
      target.turnCount = (target.turnCount || 0) + 1;
      atomicWriteJson(threadsFile, threads);
      return target;
    },

    sync: ({ threads, bible }) => {
      if (!Array.isArray(threads)) throw new Error('threads must be an array');
      const current = loadThreads();
      const byId = new Map<string, OracleThread>();
      for (const t of current) if (t?.id) byId.set(t.id, t);
      for (const t of threads) {
        if (!t || typeof t.id !== 'string') continue;
        const prev = byId.get(t.id);
        // Newer updatedAt wins; ties go to the incoming (browser) copy.
        if (!prev || (t.updatedAt || 0) >= (prev.updatedAt || 0)) byId.set(t.id, t);
      }
      const merged = [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      atomicWriteJson(threadsFile, merged);

      let nextBible = loadBible();
      if (bible && typeof bible === 'object') {
        const incoming = hydrateBible(bible);
        if ((incoming.updatedAt || 0) >= (nextBible.updatedAt || 0)) nextBible = incoming;
      }
      atomicWriteJson(bibleFile, nextBible);
      return { threads: merged, bible: nextBible };
    },
  };

  return store;
}
