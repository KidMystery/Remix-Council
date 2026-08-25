import type { Session, CouncilRound } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';
import { preferIncomingRound, stripSessionsBodies } from './evidence';
import {
  addTombstone,
  applyTombstones,
  DRIVE_UNREAD_MESSAGE,
  mergeTombstones,
  type Tombstone,
} from './syncContract';

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

let accessToken: string | null = null;
let currentUserEmail: string | null = null;

export interface SignInOptions {
  prompt?: 'select_account' | 'consent' | 'consent select_account' | '';
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
 * Explicitly uses prompt: 'select_account' so the user is presented with the Google
 * account selector and login screen rather than silently picking a predetermined profile.
 */
export async function signInWithGoogle(options: SignInOptions = { prompt: 'select_account' }): Promise<string> {
  const clientId = getClientId();
  const oauth2 = await getGisClientAsync();

  return new Promise<string>((resolve, reject) => {
    try {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE_STRING,
        callback: async (response: any) => {
          if (response?.error) {
            if (response.error === 'popup_closed_by_user') {
              reject(new Error('Google sign-in popup was closed before completing.'));
              return;
            }
            reject(new Error(response.error_description || response.error || 'Google sign-in failed.'));
            return;
          }

          if (response?.access_token) {
            accessToken = response.access_token;

            // Fetch user email/profile from Drive About endpoint
            try {
              const userRes = await fetch(`${DRIVE_API_BASE}/about?fields=user`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (userRes.ok) {
                const data = await userRes.json();
                if (data?.user?.emailAddress) {
                  currentUserEmail = data.user.emailAddress;
                } else if (data?.user?.displayName) {
                  currentUserEmail = data.user.displayName;
                }
              }
            } catch (err) {
              console.warn('[DrivePersistence] Could not fetch user profile details:', err);
            }

            resolve(response.access_token);
            return;
          }

          reject(new Error('Google sign-in did not return an access token.'));
        },
      });

      // Always request with prompt: 'select_account' so the user gets the Google account picker
      tokenClient.requestAccessToken({
        prompt: options.prompt !== undefined ? options.prompt : 'select_account',
      });
    } catch (err: any) {
      reject(err instanceof Error ? err : new Error(err?.message || 'Google sign-in failed.'));
    }
  });
}

/**
 * Revokes the in-memory token and clears it.
 */
export async function signOutGoogle(): Promise<void> {
  if (accessToken) {
    try {
      const google = typeof window !== 'undefined' ? (window as any).google : null;
      if (google?.accounts?.oauth2?.revoke) {
        await new Promise<void>((resolve) => {
          google.accounts.oauth2.revoke(accessToken, () => resolve());
        });
      } else {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`);
      }
    } catch (err) {
      console.warn('[DrivePersistence] Token revocation failed:', err);
    }
  }
  accessToken = null;
  currentUserEmail = null;
}

/** Returns true if an in-memory token is set and non-empty. */
export function isGoogleSignedIn(): boolean {
  return Boolean(accessToken && accessToken.length > 0);
}

/**
 * Returns the in-memory Google access token, if present. Used by the API client
 * to prove identity to the server (owner gate) on same-origin requests only.
 * Never persisted to storage.
 */
export function getGoogleAccessToken(): string | null {
  return accessToken;
}

/** Returns the email from the GIS credential response if available. */
export function getCurrentUserEmail(): string | null {
  return currentUserEmail;
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

async function findDriveFile(token: string, fileName: string = SESSION_FILE_NAME): Promise<DriveFileRef | null> {
  const url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&fields=files(id,name,etag)&q=${encodeURIComponent(`name='${fileName}'`)}`;
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
  const files: Array<{ id: string; name: string; etag?: string }> = data.files || [];
  const match = files.find((f) => f.name === fileName);
  return match ? { id: match.id, etag: match.etag } : null;
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
  try {
    const text = await resp.text();
    return { missing: false, file, raw: text ? JSON.parse(text) : null };
  } catch {
    throw new DriveUnreadError(`Drive file (${fileName}) was not readable JSON.`);
  }
}

async function withAuthRetry<T>(op: (token: string) => Promise<T>): Promise<T> {
  try {
    return await op(requireToken());
  } catch (err: any) {
    if (err instanceof AuthError) {
      await signInWithGoogle();
      return op(requireToken());
    }
    throw err;
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

      const isDefaultTitle = (t?: string) =>
        !t || t.trim() === '' || t === 'New Deliberation' || t === 'Untitled Session';

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

      const incomingTitle = incoming.title && incoming.title !== 'New Consultation' && incoming.title !== 'New Conversation';
      const existingTitle = existing.title && existing.title !== 'New Consultation' && existing.title !== 'New Conversation';

      const mergedThread = {
        ...existing,
        ...incoming,
        title: incomingTitle ? incoming.title : existingTitle ? existing.title : incoming.title || existing.title,
        messages: mergedMessages,
        bible:
          (incoming.bible?.updatedAt || 0) >= (existing.bible?.updatedAt || 0)
            ? incoming.bible || existing.bible
            : existing.bible,
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
  const localBibleAt = local.globalBible?.updatedAt || 0;
  const remoteBibleAt = remote.globalBible?.updatedAt || 0;
  return {
    version: 2,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
    threads: result.merged,
    globalBible: remoteBibleAt > localBibleAt ? remote.globalBible : local.globalBible || remote.globalBible,
    deleted: result.deleted,
  };
}
