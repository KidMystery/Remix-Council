import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  authRecoveryStep,
  DriveAuthRequiredError,
  DRIVE_WANTED_KEY,
  isDriveWanted,
  markDriveWanted,
  clearDriveWanted,
  trySilentDriveRestore,
  isGoogleSignedIn,
  getGoogleAccessToken,
  getCurrentUserEmail,
  signOutGoogle,
} from '../drivePersistence';

function installStorage() {
  const store = new Map<string, string>();
  const api = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] || null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { localStorage: typeof api; sessionStorage: typeof api }).localStorage = api;
  (globalThis as unknown as { sessionStorage: typeof api }).sessionStorage = api;
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

describe('Drive wanted flag & token persistence across page reloads', () => {
  beforeEach(() => {
    installStorage();
  });
  afterEach(async () => {
    await signOutGoogle();
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
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

  it('restores auth state from cached storage across page refreshes without re-prompting', async () => {
    const validAuth = {
      token: 'ya29.test_valid_access_token_123',
      email: 'tester@example.com',
      expiresAt: Date.now() + 3600 * 1000,
    };
    sessionStorage.setItem('council_google_auth_v2', JSON.stringify(validAuth));
    markDriveWanted();

    expect(isGoogleSignedIn()).toBe(true);
    expect(getGoogleAccessToken()).toBe('ya29.test_valid_access_token_123');
    expect(getCurrentUserEmail()).toBe('tester@example.com');

    // Silent restore immediately succeeds without network calls
    const restored = await trySilentDriveRestore();
    expect(restored).toBe(true);
  });

  it('ignores and clears expired tokens on page refresh', async () => {
    const expiredAuth = {
      token: 'ya29.expired_token_456',
      email: 'tester@example.com',
      expiresAt: Date.now() - 10000, // expired 10 seconds ago
    };
    sessionStorage.setItem('council_google_auth_v2', JSON.stringify(expiredAuth));

    expect(isGoogleSignedIn()).toBe(false);
    expect(getGoogleAccessToken()).toBeNull();
    expect(sessionStorage.getItem('council_google_auth_v2')).toBeNull();
  });
});

