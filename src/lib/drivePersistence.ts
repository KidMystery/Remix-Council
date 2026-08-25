import type { Session, CouncilRound } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';
import { preferIncomingRound, stripSessionsBodies } from './evidence';

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

async function findSessionsFile(token: string, fileName: string = SESSION_FILE_NAME): Promise<string | null> {
  const url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${fileName}'`)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status === 401) {
    throw new AuthError('Token expired');
  }
  if (!resp.ok) {
    throw new Error(`Failed to search Drive appDataFolder: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const files: Array<{ id: string; name: string }> = data.files || [];
  return files.find((f) => f.name === fileName)?.id || null;
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
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
  fileName: string = SESSION_FILE_NAME
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

  const resp = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: bodyParts.join('\r\n'),
  });

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

/**
 * Persists session JSON to Drive appDataFolder. File bodies are stripped
 * (IndexedDB on this device holds the blobs). In-memory sessions are not mutated.
 */
export async function saveSessionsToDrive(sessions: Session[]): Promise<void> {
  const token = requireToken();
  const sanitized = sanitizeForDrive(sessions);

  try {
    const fileId = await findSessionsFile(token);
    await uploadSessionsMultipart(token, sanitized, fileId || undefined);
  } catch (err: any) {
    if (err instanceof AuthError) {
      // Token expired — re-authenticate once and retry.
      await signInWithGoogle();
      const freshToken = requireToken();
      const fileId = await findSessionsFile(freshToken);
      await uploadSessionsMultipart(freshToken, sanitized, fileId || undefined);
      return;
    }
    throw err;
  }
}

/**
 * Loads sessions from the Drive appDataFolder. Returns [] when the file is
 * missing or any error occurs.
 */
export async function loadSessionsFromDrive(): Promise<Session[]> {
  if (!isGoogleSignedIn()) return [];

  try {
    const token = requireToken();
    const fileId = await findSessionsFile(token);
    if (!fileId) return [];

    const resp = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return [];

    const text = await resp.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[DrivePersistence] Failed to load sessions from Drive:', err);
    return [];
  }
}

/**
 * Removes a session from Drive by loading, filtering, and saving back.
 */
export async function deleteSessionFromDrive(sessionId: string): Promise<void> {
  if (!isGoogleSignedIn()) return;
  const sessions = await loadSessionsFromDrive();
  const remaining = sessions.filter((s) => s.id !== sessionId);
  await saveSessionsToDrive(remaining);
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
}

export async function saveOracleToDrive(threads: any[], globalBible: any): Promise<void> {
  const token = requireToken();
  const payload: OracleDrivePayload = {
    version: 1,
    updatedAt: Date.now(),
    threads,
    globalBible,
  };

  try {
    const fileId = await findSessionsFile(token, ORACLE_FILE_NAME);
    await uploadSessionsMultipart(token, payload as any, fileId || undefined, ORACLE_FILE_NAME);
  } catch (err: any) {
    if (err instanceof AuthError) {
      await signInWithGoogle();
      const freshToken = requireToken();
      const fileId = await findSessionsFile(freshToken, ORACLE_FILE_NAME);
      await uploadSessionsMultipart(freshToken, payload as any, fileId || undefined, ORACLE_FILE_NAME);
      return;
    }
    throw err;
  }
}

export async function loadOracleFromDrive(): Promise<{ threads: any[]; globalBible: any } | null> {
  if (!isGoogleSignedIn()) return null;

  try {
    const token = requireToken();
    const fileId = await findSessionsFile(token, ORACLE_FILE_NAME);
    if (!fileId) return null;

    const resp = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;

    const text = await resp.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.threads)) return null;
    return { threads: parsed.threads, globalBible: parsed.globalBible || null };
  } catch (err) {
    console.warn('[DrivePersistence] Failed to load Oracle data from Drive:', err);
    return null;
  }
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
}

/**
 * Intelligently merges base sessions with incoming sessions.
 * Preserves existing sessions, updates existing matching sessions with newer rounds,
 * and adds new sessions without deleting or overwriting anything.
 */
export function mergeSessions(
  baseSessions: Session[],
  incomingSessions: Session[]
): MergeResult<Session> {
  let addedCount = 0;
  let updatedCount = 0;

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
      // Merge rounds by round ID
      const roundMap = new Map<string, CouncilRound>();
      (existing.rounds || []).forEach((r) => {
        if (r && r.id) roundMap.set(r.id, r);
      });

      for (const r of incoming.rounds || []) {
        if (!r || !r.id) continue;
        const existingRound = roundMap.get(r.id);
        if (!existingRound) {
          roundMap.set(r.id, r);
        } else {
          // If incoming round has more synthesis or deliberation content, prefer incoming
          const incomingContentLen =
            (r.synthesis?.content || '').length +
            Object.keys(r.deliberation?.stage1 || {}).length +
            Object.keys(r.deliberation?.stage2 || {}).length;
          const existingContentLen =
            (existingRound.synthesis?.content || '').length +
            Object.keys(existingRound.deliberation?.stage1 || {}).length +
            Object.keys(existingRound.deliberation?.stage2 || {}).length;

          if (incomingContentLen >= existingContentLen) {
            roundMap.set(r.id, r);
          }
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
        updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0, Date.now()),
      };

      sessionMap.set(incoming.id, mergedSession);
      updatedCount++;
    }
  }

  // Sort sessions by latest updatedAt first
  const merged = Array.from(sessionMap.values()).sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );

  return { merged, addedCount, updatedCount };
}

/**
 * Intelligently merges base Oracle threads with incoming threads.
 */
export function mergeOracleThreads(
  baseThreads: any[],
  incomingThreads: any[]
): MergeResult<any> {
  let addedCount = 0;
  let updatedCount = 0;

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
      // Merge messages by ID
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

      const mergedThread = {
        ...existing,
        ...incoming,
        title:
          incoming.title && incoming.title !== 'New Consultation'
            ? incoming.title
            : existing.title,
        messages: mergedMessages,
        updatedAt: Math.max(existing.updatedAt || 0, incoming.updatedAt || 0, Date.now()),
      };

      threadMap.set(incoming.id, mergedThread);
      updatedCount++;
    }
  }

  const merged = Array.from(threadMap.values()).sort(
    (a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );

  return { merged, addedCount, updatedCount };
}
