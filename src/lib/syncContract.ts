/**
 * Drive write contract.
 *
 * One rule: never PUT a device's list over Drive without reading first.
 * Deletes are first-class (tombstones). A missing GET is not an empty Drive.
 *
 * Debug: if a thread vanished after you switched laptops, look at `deleted`
 * on the Drive envelope and at the merge tests in syncContract.test.ts.
 */

export interface Tombstone {
  id: string;
  deletedAt: number;
}

export const MAX_TOMBSTONES = 200;

export function mergeTombstones(a: Tombstone[] = [], b: Tombstone[] = []): Tombstone[] {
  const latest = new Map<string, number>();
  const now = Date.now();
  for (const t of [...a, ...b]) {
    if (!t || typeof t.id !== 'string' || !t.id.trim()) continue;
    let at = typeof t.deletedAt === 'number' && Number.isFinite(t.deletedAt) ? t.deletedAt : 0;
    // Clock-skew defense for thread undelete: never trust a future tombstone
    // from a device with a fast clock, as it would block local undeletes.
    if (at > now) {
      at = now;
    }
    const prev = latest.get(t.id) || 0;
    if (at > prev) latest.set(t.id, at);
  }
  return Array.from(latest.entries())
    .map(([id, deletedAt]) => ({ id, deletedAt }))
    .sort((x, y) => y.deletedAt - x.deletedAt)
    .slice(0, MAX_TOMBSTONES);
}

export function addTombstone(stones: Tombstone[] = [], id: string, deletedAt: number = Date.now()): Tombstone[] {
  if (!id) return mergeTombstones(stones);
  return mergeTombstones(stones, [{ id, deletedAt }]);
}

/** A later edit undeletes. A delete at/after updatedAt wins. */
export function isTombstoned(
  id: string,
  updatedAt: number | undefined,
  stones: Tombstone[] | undefined
): boolean {
  if (!id || !stones || stones.length === 0) return false;
  const t = stones.find((s) => s.id === id);
  if (!t) return false;
  return t.deletedAt >= (updatedAt || 0);
}

export function applyTombstones<T extends { id: string; updatedAt?: number }>(
  items: T[],
  stones: Tombstone[] | undefined
): T[] {
  if (!stones || stones.length === 0) return items;
  return items.filter((item) => !isTombstoned(item.id, item.updatedAt, stones));
}

export const DRIVE_UNREAD_MESSAGE =
  'Drive unread — local copy was not uploaded, so the other device is safe.';

export const AGENT_LOST_ON_REDEPLOY =
  'Mission lost on redeploy (this server has no persistent volume).';
