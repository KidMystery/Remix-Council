/**
 * localStorage is ~5 MB per origin. Session JSON must fail closed on exhibit
 * bodies (never slice). Caches and archives are reclaimable when a write
 * would otherwise blow the quota.
 */

export const RECLAIMABLE_STORAGE_KEYS = [
  'openrouter_models_cache_v2',
  'openrouter_models_cache',
  'nexus-missions-archive-v1',
] as const;

export const QUOTA_WRITE_FAILED =
  'Local storage is full (council-sessions-v3). The last good copy is still on this device. Delete old Chamber threads or export, then retry. Exhibit bodies were not sliced.';

export function isQuotaExceeded(err: unknown): boolean {
  if (!err) return false;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014;
  }
  const msg = String((err as { message?: string })?.message || err);
  return /quota|exceeded the quota|setItem/i.test(msg);
}

/** Drop catalog cache + nexus archive. Never touches sessions, oracle, or the live mission. */
export function reclaimLocalStorageCaches(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const dropped: string[] = [];
  for (const key of RECLAIMABLE_STORAGE_KEYS) {
    try {
      if (localStorage.getItem(key) != null) {
        localStorage.removeItem(key);
        dropped.push(key);
      }
    } catch {
      // private mode / disabled storage
    }
  }
  return dropped;
}

/** setItem, then drop reclaimable caches once and retry. Still throws on a second quota hit. */
export function setItemOrReclaim(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (!isQuotaExceeded(err)) throw err;
    const dropped = reclaimLocalStorageCaches();
    if (dropped.length > 0) {
      console.warn(`[storage] Quota recovery: dropped ${dropped.join(', ')} and retrying ${key}.`);
    }
    try {
      localStorage.setItem(key, value);
    } catch (retryErr) {
      if (isQuotaExceeded(retryErr)) {
        throw new Error(QUOTA_WRITE_FAILED);
      }
      throw retryErr;
    }
  }
}
