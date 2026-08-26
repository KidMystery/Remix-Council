import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  authRecoveryStep,
  DriveAuthRequiredError,
  DRIVE_WANTED_KEY,
  isDriveWanted,
  markDriveWanted,
  clearDriveWanted,
  trySilentDriveRestore,
} from '../drivePersistence';

function installLocalStorage() {
  const store = new Map<string, string>();
  const api = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as unknown as { localStorage: typeof api }).localStorage = api;
  return api;
}

describe('Drive auth recovery', () => {
  it('tries a silent refresh first, then a banner — never an unattended picker', () => {
    expect(authRecoveryStep(false)).toBe('silent');
    expect(authRecoveryStep(true)).toBe('banner');
  });

  it('names the error so the lab can keep running locally', () => {
    const err = new DriveAuthRequiredError();
    expect(err.name).toBe('DriveAuthRequiredError');
    expect(err.message).toMatch(/Local copy is still saving/i);
    expect(err.message).toMatch(/Reconnect/i);
  });
});

describe('Drive wanted flag (same-browser reopen, not a token)', () => {
  beforeEach(() => {
    installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('remembers that this browser asked for Drive and can forget it', () => {
    expect(isDriveWanted()).toBe(false);
    markDriveWanted();
    expect(isDriveWanted()).toBe(true);
    expect(localStorage.getItem(DRIVE_WANTED_KEY)).toBe('1');
    clearDriveWanted();
    expect(isDriveWanted()).toBe(false);
  });

  it('skips silent restore on a new device that never signed in', async () => {
    expect(isDriveWanted()).toBe(false);
    await expect(trySilentDriveRestore()).resolves.toBe(false);
  });
});
