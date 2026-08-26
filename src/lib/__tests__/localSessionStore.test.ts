import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _setKvBackendForTests, KV_KEYS, type KvBackend } from '../kvStore';
import {
  loadSessionsLocal,
  persistSessionsLocal,
  LOCAL_STORAGE_KEY,
} from '../localSessionStore';
import type { Session } from '../../types';

function session(id: string, updatedAt: number): Session {
  return {
    id,
    title: id,
    rounds: [],
    personas: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function memoryKv(): KvBackend & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);
    },
    async del(key: string) {
      data.delete(key);
    },
  };
}

function installLocalStorage() {
  const store = new Map<string, string>();
  const api = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
  (globalThis as unknown as { localStorage: typeof api }).localStorage = api;
  return api;
}

let kv: ReturnType<typeof memoryKv>;
let ls: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
  kv = memoryKv();
  _setKvBackendForTests(kv);
  ls = installLocalStorage();
});

afterEach(() => {
  _setKvBackendForTests(null);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('local session store (IDB first)', () => {
  it('migrates leftover localStorage and drops the fat key after a successful IDB write', async () => {
    ls.setItem(LOCAL_STORAGE_KEY, JSON.stringify([session('from-ls', 10)]));
    const loaded = await loadSessionsLocal();
    expect(loaded.map((s) => s.id)).toEqual(['from-ls']);

    await persistSessionsLocal(loaded);
    expect(kv.data.get(KV_KEYS.sessions)).toHaveLength(1);
    expect(ls.getItem(LOCAL_STORAGE_KEY)).toBeNull();
  });

  it('prefers IDB and unions a leftover LS copy so a half-migrated tab does not drop work', async () => {
    kv.data.set(KV_KEYS.sessions, [session('idb', 50)]);
    ls.setItem(LOCAL_STORAGE_KEY, JSON.stringify([session('ls-only', 40)]));
    const loaded = await loadSessionsLocal();
    expect(loaded.map((s) => s.id).sort()).toEqual(['idb', 'ls-only']);
  });

  it('loads IDB alone when localStorage is already empty', async () => {
    kv.data.set(KV_KEYS.sessions, [session('only-idb', 1)]);
    const loaded = await loadSessionsLocal();
    expect(loaded.map((s) => s.id)).toEqual(['only-idb']);
  });
});
