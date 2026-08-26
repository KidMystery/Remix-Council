import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isQuotaExceeded,
  reclaimLocalStorageCaches,
  setItemOrReclaim,
  QUOTA_WRITE_FAILED,
} from '../localStorageQuota';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  let throwOn: string | null = null;
  let sessionWrites = 0;
  const api = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (k === throwOn) {
        if (k === 'council-sessions-v3') sessionWrites += 1;
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      if (k === 'council-sessions-v3') sessionWrites += 1;
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    _store: store,
    get throwOn() {
      return throwOn;
    },
    set throwOn(key: string | null) {
      throwOn = key;
    },
    get sessionWrites() {
      return sessionWrites;
    },
  };
  (globalThis as unknown as { localStorage: typeof api }).localStorage = api;
  return api;
}

let mock: ReturnType<typeof installLocalStorageMock>;

beforeEach(() => {
  mock = installLocalStorageMock();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('isQuotaExceeded', () => {
  it('recognizes DOMException QuotaExceededError and the setItem message', () => {
    const dom = new DOMException(
      "Failed to execute 'setItem' on 'Storage': Setting the value of 'council-sessions-v3' exceeded the quota.",
      'QuotaExceededError'
    );
    expect(isQuotaExceeded(dom)).toBe(true);
    expect(isQuotaExceeded(new Error("Setting the value of 'x' exceeded the quota."))).toBe(true);
    expect(isQuotaExceeded(new Error('network down'))).toBe(false);
  });
});

describe('reclaim + retry', () => {
  it('drops only reclaimable caches, never sessions', () => {
    mock.setItem('council-sessions-v3', 'keep-me');
    mock.setItem('openrouter_models_cache_v2', 'big-catalog');
    mock.setItem('nexus-missions-archive-v1', 'old-runs');
    const dropped = reclaimLocalStorageCaches();
    expect(dropped).toEqual(['openrouter_models_cache_v2', 'nexus-missions-archive-v1']);
    expect(mock.getItem('council-sessions-v3')).toBe('keep-me');
    expect(mock.getItem('openrouter_models_cache_v2')).toBeNull();
  });

  it('retries setItem after reclaim', () => {
    mock.setItem('openrouter_models_cache_v2', 'catalog');
    let first = true;
    mock.setItem = (k: string, v: string) => {
      if (k === 'council-sessions-v3' && first) {
        first = false;
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      mock._store.set(k, String(v));
    };
    setItemOrReclaim('council-sessions-v3', 'payload');
    expect(mock.getItem('council-sessions-v3')).toBe('payload');
    expect(mock.getItem('openrouter_models_cache_v2')).toBeNull();
    expect(first).toBe(false);
  });

  it('surfaces a human error if the retry is still over quota', () => {
    mock.throwOn = 'council-sessions-v3';
    expect(() => setItemOrReclaim('council-sessions-v3', 'payload')).toThrow(QUOTA_WRITE_FAILED);
  });
});
