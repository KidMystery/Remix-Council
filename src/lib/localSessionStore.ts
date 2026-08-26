/**
 * Device-local sessions. IndexedDB is the store; localStorage is a migrate-from
 * source. After a successful IDB write we drop the fat LS key so the 5 MB
 * bucket is free. Drive is still the sync target, not the local ceiling.
 */

import type { Session } from '../types';
import { stripSessionsBodies } from './evidence';
import { mergeSessions } from './drivePersistence';
import { dropLocalStorageKey, kvGet, kvSet, KV_KEYS, readLocalStorageJson } from './kvStore';
import type { Tombstone } from './syncContract';

export const LOCAL_STORAGE_KEY = 'council-sessions-v3';
export const TOMBSTONE_STORAGE_KEY = 'council-session-tombstones-v1';
export const SESSIONS_META_KEY = 'council-sessions-meta-v1';

export function sanitizeSessionsForStorage(sessions: Session[]): Session[] {
  return stripSessionsBodies(sessions);
}

function parseSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => s && typeof s === 'object' && typeof (s as Session).id === 'string') as Session[];
}

function parseTombstones(raw: unknown): Tombstone[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t) => t && typeof t === 'object' && typeof (t as Tombstone).id === 'string') as Tombstone[];
}

export function loadSessionsFromLocalStorage(): Session[] {
  const raw = readLocalStorageJson<unknown>(LOCAL_STORAGE_KEY);
  return parseSessions(raw);
}

export function loadTombstonesFromLocalStorage(): Tombstone[] {
  const raw = readLocalStorageJson<unknown>(TOMBSTONE_STORAGE_KEY);
  return parseTombstones(raw);
}

/**
 * Prefer IDB. If both IDB and leftover LS have sessions, union them so a
 * half-migrated tab does not drop the other copy.
 */
export async function loadSessionsLocal(): Promise<Session[]> {
  let fromIdb: Session[] = [];
  try {
    fromIdb = parseSessions(await kvGet<unknown>(KV_KEYS.sessions));
  } catch (err) {
    console.warn('[localSessionStore] IndexedDB session read failed:', err);
  }
  const fromLs = loadSessionsFromLocalStorage();
  if (fromIdb.length > 0 && fromLs.length > 0) {
    return mergeSessions(fromIdb, fromLs).merged;
  }
  if (fromIdb.length > 0) return fromIdb;
  return fromLs;
}

export async function loadTombstonesLocal(): Promise<Tombstone[]> {
  let fromIdb: Tombstone[] = [];
  try {
    fromIdb = parseTombstones(await kvGet<unknown>(KV_KEYS.sessionTombstones));
  } catch (err) {
    console.warn('[localSessionStore] IndexedDB tombstone read failed:', err);
  }
  const fromLs = loadTombstonesFromLocalStorage();
  if (fromIdb.length === 0) return fromLs;
  if (fromLs.length === 0) return fromIdb;
  const seen = new Map<string, Tombstone>();
  for (const t of [...fromIdb, ...fromLs]) {
    const prev = seen.get(t.id);
    if (!prev || (t.deletedAt || 0) > (prev.deletedAt || 0)) seen.set(t.id, t);
  }
  return Array.from(seen.values());
}

export async function persistSessionsLocal(sessions: Session[]): Promise<Session[]> {
  const sanitized = sanitizeSessionsForStorage(sessions);
  await kvSet(KV_KEYS.sessions, sanitized);
  dropLocalStorageKey(LOCAL_STORAGE_KEY);
  try {
    localStorage.setItem(
      SESSIONS_META_KEY,
      JSON.stringify({ n: sanitized.length, updatedAt: Date.now(), store: 'idb' })
    );
  } catch {
    // meta is optional
  }
  return sanitized;
}

export async function persistTombstonesLocal(deleted: Tombstone[]): Promise<void> {
  await kvSet(KV_KEYS.sessionTombstones, deleted);
  dropLocalStorageKey(TOMBSTONE_STORAGE_KEY);
}
