import type { Session, CouncilRound } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';
import { preferIncomingRound, stripSessionsBodies } from './evidence';
import { isDefaultTitle } from './titleUtils';
import {
  addTombstone,
  applyTombstones,
  DRIVE_UNREAD_MESSAGE,
  mergeTombstones,
  type Tombstone,
} from './syncContract';
import { mergeBibles } from './bibleClaims';
import {
  mergeNexusDocs,
  parseNexusDriveDoc,
  sanitizeMissionForStorage,
  type NexusDriveDoc,
  type PersistedMission,
} from './nexusMission';
import { evidenceBlobFileName } from './evidenceDrive';

export type { Tombstone };

/**
 * Google Drive persistence layer using the Drive REST API with tokens from
 * Google Identity Services (GIS). The access token lives in a module-level
 * variable ONLY — it is never written to localStorage or sessionStorage.
 */

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file',
];

const DRIVE_SCOPE_STRING = DRIVE_SCOPES.join(' ');
const SESSION_FILE_NAME = 'council-sessions.json';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

const GOOGLE_AUTH_STORAGE_KEY = 'council_google_auth_v2';

let accessToken: string | null = null;
let currentUserEmail: string | null = null;

interface PersistedGoogleAuth {
  token: string;
  email: string | null;
  expiresAt: number;
}

function saveStoredAuth(token: string, expiresInSeconds: number = 3600, email?: string | null): void {
  accessToken = token;
  if (email !== undefined) {
    currentUserEmail = email;
  }
  // Store with a 2-minute safety margin
  const ttlSec = Math.max(60, (expiresInSeconds || 3600) - 120);
  const authData: PersistedGoogleAuth = {
    token,
    email: currentUserEmail,
    expiresAt: Date.now() + ttlSec * 1000,
  };
  try {
    sessionStorage.setItem(GOOGLE_AUTH_STORAGE_KEY, JSON.stringify(authData));
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GOOGLE_AUTH_STORAGE_KEY, JSON.stringify(authData));
    }
  } catch {
    // ignore
  }
  markDriveWanted();
}

function loadStoredAuth(): { token: string; email: string | null } | null {
  if (accessToken) {
    return { token: accessToken, email: currentUserEmail };
  }
  let raw: string | null = null;
  try {
    raw = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(GOOGLE_AUTH_STORAGE_KEY) : null) ||
          (typeof localStorage !== 'undefined' ? localStorage.getItem(GOOGLE_AUTH_STORAGE_KEY) : null);
  } catch {
    // ignore
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedGoogleAuth;
    if (parsed && typeof parsed.token === 'string' && parsed.token.length > 0) {
      if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
        accessToken = parsed.token;
        currentUserEmail = parsed.email || null;
        return { token: parsed.token, email: currentUserEmail };
      }
    }
  } catch {
    // ignore
  }

  // Expired or invalid - clear it
  clearStoredAuth(false);
  return null;
}

function clearStoredAuth(fullSignOut: boolean = true): void {
  accessToken = null;
  currentUserEmail = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GOOGLE_AUTH_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GOOGLE_AUTH_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  if (fullSignOut) {
    clearDriveWanted();
  }
}

export interface SignInOptions {
  prompt?: 'select_account' | 'consent' | 'consent select_account' | '' | 'none';
}

function getClientId(): string {
  const envId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
  const firebaseId = (firebaseConfig as any)?.oAuthClientId || '';
  const customId = typeof window !== 'undefined' ? localStorage.getItem('council_custom_google_client_id') || '' : '';
  const clientId = (envId && envId !== 'YOUR_GOOGLE_OAUTH_CLIENT_ID') ? envId : (firebaseId || customId);
  if (!clientId) {
    throw new Error('Google Drive Cloud Sync requires a Google OAuth Client ID. You can enter one in Storage & Cloud Sync settings, or your data is already safely saved in Local Storage.');
  }
  return clientId;
}

function getGisClientAsync(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window environment is not available.'));
  }
  if ((window as any).google?.accounts?.oauth2) {
    return Promise.resolve((window as any).google.accounts.oauth2);
  }
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 100;
      if ((window as any).google?.accounts?.oauth2) {
        clearInterval(interval);
        resolve((window as any).google.accounts.oauth2);
      } else if (elapsed >= 5000) {
        clearInterval(interval);
        reject(new Error('Google Identity Services client took too long to load. Please check your internet connection or reload the page.'));
      }
    }, 100);
  });
}

/**
 * Signs in with Google via GIS token client and resolves with the access token.
 * Default prompt is the account picker — only for a user click. Automatic
 * recovery must pass prompt: 'none' so GIS errors instead of opening a popup
 * ('' still pops up when the Google session has gone stale).
 */
export async function signInWithGoogle(options: SignInOptions = { prompt: 'select_account' }): Promise<string> {
  const clientId = getClientId();
  const oauth2 = await getGisClientAsync();
  // '' is "silent if possible, popup if not" in GIS — 'none' is the truly
  // silent mode: it errors instead of ever opening a popup. Automatic paths
  // (restore on load, mid-session token refresh) must use 'none' so a stale
  // Google session shows the amber banner, never a surprise popup.
  const silent = options.prompt === '' || options.prompt === 'none';

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(silent ? 'Silent Drive refresh timed out.' : 'Google sign-in timed out.')),
      silent ? 8000 : 120000
    );
    const finish = (fn: () => void) => {
      clearTimeout(timeout);
      fn();
    };
    try {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE_STRING,
        callback: async (response: any) => {
          if (response?.error) {
            if (response.error === 'popup_closed_by_user') {
              finish(() => reject(new Error('Google sign-in popup was closed before completing.')));
              return;
            }
            finish(() =>
              reject(new Error(response.error_description || response.error || 'Google sign-in failed.'))
            );
            return;
          }

          if (response?.access_token) {
            const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : parseInt(response.expires_in, 10) || 3599;
            saveStoredAuth(response.access_token, expiresIn, currentUserEmail);

            // Fetch user email/profile from Drive About endpoint
            try {
              const userRes = await fetch(`${DRIVE_API_BASE}/about?fields=user`, {
                headers: { Authorization: `Bearer ${response.access_token}` },
              });
              if (userRes.ok) {
                const data = await userRes.json();
                const email = data?.user?.emailAddress || data?.user?.displayName || null;
                if (email) {
                  currentUserEmail = email;
                  saveStoredAuth(response.access_token, expiresIn, email);
                }
              }
            } catch (err) {
              console.warn('[DrivePersistence] Could not fetch user profile details:', err);
            }

            notifyDriveAuthRestored();
            finish(() => resolve(response.access_token));
            return;
          }

          finish(() => reject(new Error('Google sign-in did not return an access token.')));
        },
      });

      // 'none' is truly silent (errors instead of popping). select_account is
    // only for a click.
      tokenClient.requestAccessToken({
        prompt: options.prompt !== undefined ? options.prompt : 'select_account',
      });
    } catch (err: any) {
      finish(() => reject(err instanceof Error ? err : new Error(err?.message || 'Google sign-in failed.')));
    }
  });
}

/**
 * Revokes the token and clears all stored session state.
 */
export async function signOutGoogle(): Promise<void> {
  const currentToken = accessToken || loadStoredAuth()?.token;
  if (currentToken) {
    try {
      const google = typeof window !== 'undefined' ? (window as any).google : null;
      if (google?.accounts?.oauth2?.revoke) {
        await new Promise<void>((resolve) => {
          google.accounts.oauth2.revoke(currentToken, () => resolve());
        });
      } else {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(currentToken)}`);
      }
    } catch (err) {
      console.warn('[DrivePersistence] Token revocation failed:', err);
    }
  }
  clearStoredAuth(true);
}

/** Returns true if an active non-expired token is present. */
export function isGoogleSignedIn(): boolean {
  const auth = loadStoredAuth();
  return Boolean(auth && auth.token && auth.token.length > 0);
}

/**
 * Returns the Google access token, if present and non-expired. Used by the API client
 * to prove identity to the server (owner gate) on same-origin requests only.
 */
export function getGoogleAccessToken(): string | null {
  const auth = loadStoredAuth();
  return auth ? auth.token : null;
}

/** Returns the email from the GIS credential response or cache if available. */
export function getCurrentUserEmail(): string | null {
  if (currentUserEmail) return currentUserEmail;
  const auth = loadStoredAuth();
  return auth ? auth.email : null;
}

function requireToken(): string {
  if (!isGoogleSignedIn()) {
    throw new Error('Not signed in to Google Drive.');
  }
  return accessToken as string;
}

interface DriveFileRef {
  id: string;
  etag?: string;
}

/**
 * Drive v3 list URL — must be files(id,name) only. v3 File resource has no etag field
 * in the list response that is valid for If-Match; ETag comes from the GET media header.
 * This function is exported so tests can assert the bundle never ships the bad fields combo.
 */
export function driveAppDataListUrl(fileName: string = SESSION_FILE_NAME): string {
  const q = encodeURIComponent(`name='${fileName}'`);
  // Never include etag — Drive v3 list with that extra field 400s and etag must come from GET header
  return `${DRIVE_API_BASE}/files?spaces=appDataFolder&fields=files(id,name)&q=${q}`;
}

async function findDriveFile(token: string, fileName: string = SESSION_FILE_NAME): Promise<DriveFileRef | null> {
  const url = driveAppDataListUrl(fileName);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status === 401) {
    throw new AuthError('Token expired');
  }
  if (!resp.ok) {
    throw new DriveUnreadError(`Failed to search Drive appDataFolder: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const files: Array<{ id: string; name: string }> = data.files || [];
  const match = files.find((f) => f.name === fileName);
  return match ? { id: match.id } : null;
}



class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class DriveUnreadError extends Error {
  constructor(message: string = DRIVE_UNREAD_MESSAGE) {
    super(message);
    this.name = 'DriveUnreadError';
  }
}

/** Token died. Local save is fine. Do not pop a Google picker while the owner sleeps. */
export class DriveAuthRequiredError extends Error {
  constructor(
    message: string = 'Drive sign-in expired. Local copy is still saving. Reconnect when you are at the keyboard.'
  ) {
    super(message);
    this.name = 'DriveAuthRequiredError';
  }
}

export const DRIVE_AUTH_REQUIRED_EVENT = 'council-drive-auth-required';
export const DRIVE_AUTH_RESTORED_EVENT = 'council-drive-auth-restored';

export function notifyDriveNeedsReauth(): void {
  try {
    window.dispatchEvent(new CustomEvent(DRIVE_AUTH_REQUIRED_EVENT));
  } catch {
    // non-browser
  }
}

export function notifyDriveAuthRestored(): void {
  try {
    window.dispatchEvent(new CustomEvent(DRIVE_AUTH_RESTORED_EVENT));
  } catch {
    // non-browser
  }
}

let ongoingSilentRefresh: Promise<string> | null = null;

/**
 * Attempt a silent token refresh via Google Identity Services (prompt: 'none').
 * Deduplicated so simultaneous requests (e.g. parallel council seats) share
 * one refresh request instead of firing multiple.
 */
export async function refreshOwnerTokenSilently(): Promise<string> {
  if (ongoingSilentRefresh) {
    return ongoingSilentRefresh;
  }

  ongoingSilentRefresh = (async () => {
    try {
      const token = await signInWithGoogle({ prompt: 'none' });
      notifyDriveAuthRestored();
      return token;
    } catch (err) {
      notifyDriveNeedsReauth();
      throw err;
    } finally {
      setTimeout(() => {
        ongoingSilentRefresh = null;
      }, 50);
    }
  })();

  return ongoingSilentRefresh;
}

/** Silent first. Interactive picker is only for a click. */
export function authRecoveryStep(silentAlreadyTried: boolean): 'silent' | 'banner' {
  return silentAlreadyTried ? 'banner' : 'silent';
}

/** Remember that this browser should try a silent Drive restore on the next load. Not a token. */
export const DRIVE_WANTED_KEY = 'council-drive-wanted';

export function isDriveWanted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DRIVE_WANTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markDriveWanted(): void {
  try {
    localStorage.setItem(DRIVE_WANTED_KEY, '1');
  } catch {
    // ignore
  }
}

export function clearDriveWanted(): void {
  try {
    localStorage.removeItem(DRIVE_WANTED_KEY);
  } catch {
    // ignore
  }
}

/**
 * Same-browser reopen: one silent GIS refresh, never a picker.
 * New device (brother's phone) has no wanted-flag → skip; they click Sign in once.
 */
export async function trySilentDriveRestore(): Promise<boolean> {
  if (isGoogleSignedIn()) {
    notifyDriveAuthRestored();
    return true;
  }
  if (!isDriveWanted()) return false;
  try {
    await signInWithGoogle({ prompt: 'none' });
    notifyDriveAuthRestored();
    return true;
  } catch {
    // Speculative background restore failed on page load; keep local storage active
    return false;
  }
}

class PreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreconditionError';
  }
}

/** Exhibit metadata only — never slice a body to fit Drive. */
function sanitizeForDrive(sessions: Session[]): Session[] {
  return stripSessionsBodies(sessions);
}

async function uploadSessionsMultipart(
  token: string,
  sessions: any,
  fileId?: string,
  fileName: string = SESSION_FILE_NAME,
  etag?: string
): Promise<void> {
  const metadata: Record<string, any> = {
    name: fileName,
    mimeType: 'application/json',
  };
  // 'parents' can only be provided when creating a new file (POST), never during PATCH/update
  if (!fileId) {
    metadata.parents = ['appDataFolder'];
  }
  const payload = JSON.stringify(sessions);

  const boundary = `council-boundary-${Date.now()}`;
  const bodyParts: string[] = [];
  bodyParts.push(`--${boundary}`);
  bodyParts.push('Content-Type: application/json; charset=UTF-8');
  bodyParts.push('');
  bodyParts.push(JSON.stringify(metadata));
  bodyParts.push(`--${boundary}`);
  bodyParts.push('Content-Type: application/json');
  bodyParts.push('');
  bodyParts.push(payload);
  bodyParts.push(`--${boundary}--`);

  const url = fileId
    ? `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': `multipart/related; boundary=${boundary}`,
  };
  if (fileId && etag) headers['If-Match'] = etag;

  const resp = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers,
    body: bodyParts.join('\r\n'),
  });

  if (resp.status === 412) {
    throw new PreconditionError(`Drive file ${fileName} changed under us`);
  }

  if (!resp.ok) {
    let errorDetail = '';
    try {
      const errJson = await resp.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = `HTTP ${resp.status}`;
    }
    throw new Error(`Failed to ${fileId ? 'update' : 'create'} Drive file (${fileName}): ${errorDetail}`);
  }
}

export interface SessionDriveDoc {
  version: 2;
  sessions: Session[];
  deleted: Tombstone[];
}

export function parseSessionDriveDoc(raw: unknown): SessionDriveDoc {
  if (Array.isArray(raw)) {
    return { version: 2, sessions: raw as Session[], deleted: [] };
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).sessions)) {
    const deleted = Array.isArray((raw as any).deleted) ? (raw as any).deleted : [];
    return { version: 2, sessions: (raw as any).sessions, deleted };
  }
  return { version: 2, sessions: [], deleted: [] };
}

async function readDriveJson(
  token: string,
  fileName: string
): Promise<{ missing: true } | { missing: false; file: DriveFileRef; raw: unknown }> {
  const file = await findDriveFile(token, fileName);
  if (!file) return { missing: true };

  const resp = await fetch(`${DRIVE_API_BASE}/files/${file.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 401) throw new AuthError('Token expired');
  if (resp.status === 404) return { missing: true };
  if (!resp.ok) {
    throw new DriveUnreadError(`Failed to read Drive file (${fileName}): HTTP ${resp.status}`);
  }
  // ETag for If-Match must come from GET header, not from list fields (v3 File has no etag in list)
  const etagHeader = resp.headers.get('ETag') || resp.headers.get('etag') || undefined;
  try {
    const text = await resp.text();
    return { missing: false, file: { id: file.id, etag: etagHeader }, raw: text ? JSON.parse(text) : null };
  } catch {
    throw new DriveUnreadError(`Drive file (${fileName}) was not readable JSON.`);
  }
}

async function withAuthRetry<T>(op: (token: string) => Promise<T>): Promise<T> {
  try {
    return await op(requireToken());
  } catch (err: any) {
    if (!(err instanceof AuthError)) throw err;
    clearStoredAuth(false);
    try {
      await signInWithGoogle({ prompt: 'none' });
      notifyDriveAuthRestored();
      return await op(requireToken());
    } catch {
      notifyDriveNeedsReauth();
      throw new DriveAuthRequiredError();
    }
  }
}

export async function loadSessionDriveDoc(): Promise<SessionDriveDoc> {
  if (!isGoogleSignedIn()) return { version: 2, sessions: [], deleted: [] };
  const read = await withAuthRetry((token) => readDriveJson(token, SESSION_FILE_NAME));
  if (read.missing) return { version: 2, sessions: [], deleted: [] };
  return parseSessionDriveDoc(read.raw);
}

/**
 * Loads sessions from Drive. Distinguishes unread from empty: throws
 * DriveUnreadError so callers must not treat a failed GET as "Drive is empty."
 */
export async function loadSessionsFromDrive(): Promise<Session[]> {
  const doc = await loadSessionDriveDoc();
  return applyTombstones(doc.sessions, doc.deleted);
}

/**
 * Merge-before-put. If Drive cannot be read, does not write.
 * Concurrent PUTs retry on etag 412 (max 3).
 */
export async function saveSessionsToDrive(
  sessions: Session[],
  deleted: Tombstone[] = []
): Promise<SessionDriveDoc> {
  const local: SessionDriveDoc = {
    version: 2,
    sessions: sanitizeForDrive(sessions),
    deleted: mergeTombstones(deleted),
  };

  return withAuthRetry(async (token) => {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await readDriveJson(token, SESSION_FILE_NAME);
      const remote = read.missing ? { version: 2 as const, sessions: [] as Session[], deleted: [] as Tombstone[] } : parseSessionDriveDoc(read.raw);
      const merged = mergeSessionDocs(local, remote);
      const envelope: SessionDriveDoc = {
        version: 2,
        sessions: sanitizeForDrive(merged.sessions),
        deleted: merged.deleted,
      };
      try {
        await uploadSessionsMultipart(
          token,
          envelope,
          read.missing ? undefined : read.file.id,
          SESSION_FILE_NAME,
          read.missing ? undefined : read.file.etag
        );
        return envelope;
      } catch (err: any) {
        if (err instanceof PreconditionError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new DriveUnreadError('Drive changed on another device and could not be merged after 3 tries.');
  });
}

/**
 * Tombstone + merge-before-put. Never filters a remote list and writes it back
 * without unioning the other device's new threads.
 */
export async function deleteSessionFromDrive(sessionId: string): Promise<void> {
  if (!isGoogleSignedIn()) return;
  await saveSessionsToDrive([], addTombstone([], sessionId));
}

// ---------------------------------------------------------------------------
// Oracle (living assistant) Drive sync — threads + Bibles in the appDataFolder.
// ---------------------------------------------------------------------------

const ORACLE_FILE_NAME = 'council-oracle.json';

export interface OracleDrivePayload {
  version: number;
  updatedAt: number;
  threads: any[];
  globalBible: any;
  deleted?: Tombstone[];
}

export function parseOracleDriveDoc(raw: unknown): OracleDrivePayload {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).threads)) {
    return { version: 2, updatedAt: 0, threads: [], globalBible: null, deleted: [] };
  }
  const doc = raw as any;
  return {
    version: 2,
    updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : 0,
    threads: doc.threads,
    globalBible: doc.globalBible || null,
    deleted: Array.isArray(doc.deleted) ? doc.deleted : [],
  };
}

export async function loadOracleDriveDoc(): Promise<OracleDrivePayload | null> {
  if (!isGoogleSignedIn()) return null;
  const read = await withAuthRetry((token) => readDriveJson(token, ORACLE_FILE_NAME));
  if (read.missing) return { version: 2, updatedAt: 0, threads: [], globalBible: null, deleted: [] };
  return parseOracleDriveDoc(read.raw);
}

export async function loadOracleFromDrive(): Promise<{ threads: any[]; globalBible: any; deleted: Tombstone[] } | null> {
  const doc = await loadOracleDriveDoc();
  if (!doc) return null;
  return {
    threads: applyTombstones(doc.threads || [], doc.deleted),
    globalBible: doc.globalBible || null,
    deleted: doc.deleted || [],
  };
}

export async function saveOracleToDrive(
  threads: any[],
  globalBible: any,
  deleted: Tombstone[] = []
): Promise<OracleDrivePayload> {
  const local: OracleDrivePayload = {
    version: 2,
    updatedAt: Date.now(),
    threads,
    globalBible,
    deleted: mergeTombstones(deleted),
  };

  return withAuthRetry(async (token) => {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await readDriveJson(token, ORACLE_FILE_NAME);
      const remote = read.missing
        ? { version: 2, updatedAt: 0, threads: [], globalBible: null, deleted: [] as Tombstone[] }
        : parseOracleDriveDoc(read.raw);
      const merged = mergeOracleDocs(local, remote);
      const envelope: OracleDrivePayload = {
        version: 2,
        updatedAt: Date.now(),
        threads: merged.threads,
        globalBible: merged.globalBible,
        deleted: merged.deleted,
      };
      try {
        await uploadSessionsMultipart(
          token,
          envelope,
          read.missing ? undefined : read.file.id,
          ORACLE_FILE_NAME,
          read.missing ? undefined : read.file.etag
        );
        return envelope;
      } catch (err: any) {
        if (err instanceof PreconditionError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new DriveUnreadError('Oracle Drive file changed and could not be merged after 3 tries.');
  });
}

/**
 * Migrates a legacy local-storage session object into the current Session shape.
 */
export function migrateLocalSession(legacy: any): Session {
  const now = Date.now();
  const rawRounds: any[] = Array.isArray(legacy?.rounds) ? legacy.rounds : [];
  return {
    id: legacy?.id || `session_${now}`,
    title: legacy?.title || 'Migrated Deliberation',
    rounds: rawRounds.map((r: any) => ({
      ...r,
      timestamp: r.timestamp || r.createdAt || now,
      deliberation: r.deliberation || { stage1: {}, stage2: {} },
      synthesis: r.synthesis || { content: '', status: 'idle' },
    })),
    personas: Array.isArray(legacy?.personas) ? legacy.personas : [],
    synthesizer: legacy?.synthesizer || undefined,
    activePresetId: legacy?.activePresetId || undefined,
    contextSummary: legacy?.contextSummary || undefined,
    createdAt: legacy?.createdAt || now,
    updatedAt: legacy?.updatedAt || now,
  };
}

export interface MergeResult<T> {
  merged: T[];
  addedCount: number;
  updatedCount: number;
  deleted: Tombstone[];
}

/**
 * Union of sessions by id. Rounds merge by exhibit identity (preferIncomingRound),
 * never by synthesis string length. Tombstones drop an id unless a later edit undeletes it.
 */
export function mergeSessions(
  baseSessions: Session[],
  incomingSessions: Session[],
  baseDeleted: Tombstone[] = [],
  incomingDeleted: Tombstone[] = []
): MergeResult<Session> {
  let addedCount = 0;
  let updatedCount = 0;
  const deleted = mergeTombstones(baseDeleted, incomingDeleted);

  const sessionMap = new Map<string, Session>();
  baseSessions.forEach((s) => {
    if (s && s.id) sessionMap.set(s.id, s);
  });

  for (const incoming of incomingSessions) {
    if (!incoming || !incoming.id) continue;

    const existing = sessionMap.get(incoming.id);
    if (!existing) {
      sessionMap.set(incoming.id, incoming);
      addedCount++;
    } else {
      const roundMap = new Map<string, CouncilRound>();
      (existing.rounds || []).forEach((r) => {
        if (r && r.id) roundMap.set(r.id, r);
      });

      for (const r of incoming.rounds || []) {
        if (!r || !r.id) continue;
        const existingRound = roundMap.get(r.id);
        if (!existingRound) {
          roundMap.set(r.id, r);
        } else if (preferIncomingRound(existingRound, r)) {
          roundMap.set(r.id, r);
        }
      }

      const mergedRounds = Array.from(roundMap.values()).sort(
        (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
      );

      const bestTitle = !isDefaultTitle(existing.title)
        ? existing.title
        : !isDefaultTitle(incoming.title)
        ? incoming.title
        : existing.title || incoming.title || 'Deliberation';

      const mergedSession: Session = {
        ...existing,
        ...incoming,
        title: bestTitle,
        rounds: mergedRounds,
        personas: incoming.personas?.length ? incoming.personas : existing.personas,
        synthesizer: incoming.synthesizer || existing.synthesizer,
        activePresetId: incoming.activePresetId || existing.activePresetId,
        handoff: incoming.handoff || existing.handoff,
        updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0),
      };

      sessionMap.set(incoming.id, mergedSession);
      updatedCount++;
    }
  }

  const merged = applyTombstones(
    Array.from(sessionMap.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    deleted
  );

  return { merged, addedCount, updatedCount, deleted };
}

export function mergeSessionDocs(local: SessionDriveDoc, remote: SessionDriveDoc): SessionDriveDoc {
  const result = mergeSessions(local.sessions || [], remote.sessions || [], local.deleted, remote.deleted);
  return { version: 2, sessions: result.merged, deleted: result.deleted };
}

/**
 * Union of Oracle threads by id. Messages union by id (keep both devices'
 * turns). Tombstones drop a thread unless a later edit undeletes it.
 */
export function mergeOracleThreads(
  baseThreads: any[],
  incomingThreads: any[],
  baseDeleted: Tombstone[] = [],
  incomingDeleted: Tombstone[] = []
): MergeResult<any> {
  let addedCount = 0;
  let updatedCount = 0;
  const deleted = mergeTombstones(baseDeleted, incomingDeleted);

  const threadMap = new Map<string, any>();
  baseThreads.forEach((t) => {
    if (t && t.id) threadMap.set(t.id, t);
  });

  for (const incoming of incomingThreads) {
    if (!incoming || !incoming.id) continue;
    const existing = threadMap.get(incoming.id);
    if (!existing) {
      threadMap.set(incoming.id, incoming);
      addedCount++;
    } else {
      const msgMap = new Map<string, any>();
      (existing.messages || []).forEach((m: any) => {
        if (m && m.id) msgMap.set(m.id, m);
      });

      for (const m of incoming.messages || []) {
        if (!m || !m.id) continue;
        if (!msgMap.has(m.id)) {
          msgMap.set(m.id, m);
        } else {
          const ex = msgMap.get(m.id);
          if ((m.content || '').length >= (ex.content || '').length) {
            msgMap.set(m.id, m);
          }
        }
      }

      const mergedMessages = Array.from(msgMap.values()).sort(
        (a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0)
      );

      const incomingValidTitle = !isDefaultTitle(incoming.title);
      const existingValidTitle = !isDefaultTitle(existing.title);

      // Mode / model / rosters belong to whoever edited last. Spreading incoming
      // unconditionally was snapping a live Direct click back to a stale
      // Auto-Rotate copy on every Drive save.
      const incomingNewer = (incoming.updatedAt || 0) > (existing.updatedAt || 0);
      const newer = incomingNewer ? incoming : existing;
      const older = incomingNewer ? existing : incoming;

      const mergedThread = {
        ...older,
        ...newer,
        title: incomingValidTitle ? incoming.title : existingValidTitle ? existing.title : incoming.title || existing.title || 'New Conversation',
        messages: mergedMessages,
        bible: mergeBibles(existing.bible, incoming.bible),
        updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0),
      };

      threadMap.set(incoming.id, mergedThread);
      updatedCount++;
    }
  }

  const merged = applyTombstones(
    Array.from(threadMap.values()).sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    deleted
  );

  return { merged, addedCount, updatedCount, deleted };
}

export function mergeOracleDocs(local: OracleDrivePayload, remote: OracleDrivePayload): OracleDrivePayload {
  const result = mergeOracleThreads(local.threads || [], remote.threads || [], local.deleted, remote.deleted);
  return {
    version: 2,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    threads: result.merged,
    globalBible: mergeBibles(local.globalBible, remote.globalBible),
    deleted: result.deleted,
  };
}

// ---------------------------------------------------------------------------
// Nexus Lab Drive sync — active mission + archive. JSON is metadata-only.
// Extracted exhibit text is a separate hash-addressed appData file.
// ---------------------------------------------------------------------------

const NEXUS_FILE_NAME = 'council-nexus.json';

export type { NexusDriveDoc, PersistedMission };

export async function loadNexusDriveDoc(): Promise<NexusDriveDoc | null> {
  if (!isGoogleSignedIn()) return null;
  const read = await withAuthRetry((token) => readDriveJson(token, NEXUS_FILE_NAME));
  if (read.missing) return { version: 2, updatedAt: 0, mission: null, archive: [], deleted: [] };
  return parseNexusDriveDoc(read.raw);
}

export async function saveNexusToDrive(
  mission: PersistedMission | null,
  archive: PersistedMission[] = [],
  deleted: Tombstone[] = []
): Promise<NexusDriveDoc> {
  const local: NexusDriveDoc = {
    version: 2,
    updatedAt: Date.now(),
    mission: mission ? sanitizeMissionForStorage(mission) : null,
    archive: archive.map(sanitizeMissionForStorage),
    deleted,
  };

  return withAuthRetry(async (token) => {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await readDriveJson(token, NEXUS_FILE_NAME);
      const remote = read.missing
        ? { version: 2 as const, updatedAt: 0, mission: null, archive: [] as PersistedMission[], deleted: [] }
        : parseNexusDriveDoc(read.raw);
      const envelope = mergeNexusDocs(local, remote);
      envelope.updatedAt = Date.now();
      try {
        await uploadSessionsMultipart(
          token,
          envelope,
          read.missing ? undefined : read.file.id,
          NEXUS_FILE_NAME,
          read.missing ? undefined : read.file.etag
        );
        return envelope;
      } catch (err: any) {
        if (err instanceof PreconditionError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new DriveUnreadError('Nexus Drive file changed and could not be merged after 3 tries.');
  });
}

// ---------------------------------------------------------------------------
// Exhibit bodies — separate hash-addressed files. Never in the JSON envelope.
// ---------------------------------------------------------------------------

async function uploadPlainTextMultipart(token: string, fileName: string, text: string): Promise<void> {
  const metadata = {
    name: fileName,
    mimeType: 'text/plain',
    parents: ['appDataFolder'],
  };
  const boundary = `council-blob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
    `--${boundary}--`,
  ].join('\r\n');

  const resp = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (resp.status === 401) throw new AuthError('Token expired');
  if (!resp.ok) {
    let errorDetail = '';
    try {
      const errJson = await resp.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = `HTTP ${resp.status}`;
    }
    throw new Error(`Failed to create Drive blob (${fileName}): ${errorDetail}`);
  }
}

/**
 * Writes extracted UTF-8 to appDataFolder/council-blob-<id>.txt.
 * Hash-addressed: if the file already exists we do not rewrite it.
 * Never called with original PDF bytes. No-op when signed out.
 */
export async function saveEvidenceBlobToDrive(id: string, body: string): Promise<void> {
  const fileName = evidenceBlobFileName(id);
  if (!fileName || body == null) return;
  if (!isGoogleSignedIn()) return;
  await withAuthRetry(async (token) => {
    const existing = await findDriveFile(token, fileName);
    if (existing) return;
    await uploadPlainTextMultipart(token, fileName, body);
  });
}

/**
 * Fetches extracted UTF-8 for an evidence id. Missing file → null.
 * Unreadable Drive → DriveUnreadError (fail closed; do not invent a stub).
 */
export async function loadEvidenceBlobFromDrive(id: string): Promise<string | null> {
  const fileName = evidenceBlobFileName(id);
  if (!fileName) return null;
  if (!isGoogleSignedIn()) return null;
  return withAuthRetry(async (token) => {
    const file = await findDriveFile(token, fileName);
    if (!file) return null;
    const resp = await fetch(`${DRIVE_API_BASE}/files/${file.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) throw new AuthError('Token expired');
    if (resp.status === 404) return null;
    if (!resp.ok) {
      throw new DriveUnreadError(`Failed to read Drive blob (${fileName}): HTTP ${resp.status}`);
    }
    return resp.text();
  });
}
