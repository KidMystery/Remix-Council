/**
 * Device-local document store. IndexedDB is the ceiling (hundreds of MB),
 * not Chrome's ~5 MB localStorage bucket. Drive remains the sync target.
 *
 * Debug: DevTools → Application → IndexedDB → council-kv-v1 → kv.
 */

export const KV_DB_NAME = 'council-kv-v1';
export const KV_STORE = 'kv';
export const KV_VERSION = 1;

export const KV_KEYS = {
  sessions: 'sessions',
  sessionTombstones: 'session-tombstones',
  nexusMission: 'nexus-mission',
  nexusArchive: 'nexus-archive',
  nexusDeleted: 'nexus-deleted',
  oracleThreads: 'oracle-threads',
  oracleBible: 'oracle-bible',
  oracleTombstones: 'oracle-tombstones',
} as const;

export interface KvBackend {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

let injected: KvBackend | null = null;

/** Test seam — not used in production. */
export function _setKvBackendForTests(backend: KvBackend | null): void {
  injected = backend;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(KV_DB_NAME, KV_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open council-kv IndexedDB.'));
  });
}

const idbBackend: KvBackend = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(KV_STORE, 'readonly');
        const req = tx.objectStore(KV_STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error || new Error(`Failed to read ${key}.`));
      });
    } finally {
      db.close();
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(KV_STORE, 'readwrite');
        const req = tx.objectStore(KV_STORE).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error(`Failed to write ${key}.`));
        tx.onabort = () => reject(tx.error || new Error(`IndexedDB write aborted for ${key}.`));
      });
    } finally {
      db.close();
    }
  },
  async del(key: string): Promise<void> {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(KV_STORE, 'readwrite');
        const req = tx.objectStore(KV_STORE).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error(`Failed to delete ${key}.`));
      });
    } finally {
      db.close();
    }
  },
};

function backend(): KvBackend {
  return injected || idbBackend;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return backend().get<T>(key);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  return backend().set(key, value);
}

export async function kvDel(key: string): Promise<void> {
  return backend().del(key);
}

/** After IDB has the copy, drop the fat localStorage key so the 5 MB bucket is free. */
export function dropLocalStorageKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function readLocalStorageJson<T>(key: string): T | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
