import type { Session } from '../types';

/**
 * Google Drive persistence layer using the Drive REST API with tokens from
 * Google Identity Services (GIS). The access token lives in a module-level
 * variable ONLY — it is never written to localStorage or sessionStorage.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SESSION_FILE_NAME = 'council-sessions.json';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

let accessToken: string | null = null;
let currentUserEmail: string | null = null;

function getClientId(): string {
  const clientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';
  if (!clientId) {
    throw new Error('Google Drive sync is not configured. Set VITE_GOOGLE_CLIENT_ID to enable it.');
  }
  return clientId;
}

function getGisClient(): any {
  const google = (window as any).google;
  if (!google?.accounts?.oauth2) {
    throw new Error('Google Identity Services is not loaded. Check the GIS script tag in index.html.');
  }
  return google.accounts.oauth2;
}

/**
 * Signs in with Google via GIS token client and resolves with the access token.
 */
export function signInWithGoogle(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const clientId = getClientId();
      const oauth2 = getGisClient();

      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response: any) => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error || 'Google sign-in failed.'));
            return;
          }
          if (response?.access_token) {
            accessToken = response.access_token;
            if (response.email) {
              currentUserEmail = response.email;
            }
            resolve(response.access_token);
            return;
          }
          reject(new Error('Google sign-in did not return an access token.'));
        },
      });

      tokenClient.requestAccessToken();
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
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`);
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

async function findSessionsFile(token: string): Promise<string | null> {
  const url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${SESSION_FILE_NAME}'`)}`;
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
  return files.find((f) => f.name === SESSION_FILE_NAME)?.id || null;
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function sanitizeForDrive(sessions: Session[]): Session[] {
  const MAX_CONTENT_CHARS = 5000;
  return sessions.map((s) => ({
    ...s,
    rounds: (s.rounds || []).map((r) => {
      if (!r.attachedTextFiles || r.attachedTextFiles.length === 0) {
        return { ...r, attachedTextFiles: [] };
      }
      return {
        ...r,
        attachedTextFiles: r.attachedTextFiles.map((f) => {
          if (!f.content || f.content.length <= MAX_CONTENT_CHARS) return { ...f };
          const originalLength = f.content.length;
          return {
            ...f,
            content: `${f.content.slice(0, MAX_CONTENT_CHARS)}\n[Truncated for storage: ${originalLength} chars]`,
          };
        }),
      };
    }),
  }));
}

async function uploadSessionsMultipart(token: string, sessions: Session[], fileId?: string): Promise<void> {
  const metadata = {
    name: SESSION_FILE_NAME,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
  };
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
    throw new Error(`Failed to ${fileId ? 'update' : 'create'} Drive sessions file: HTTP ${resp.status}`);
  }
}

/**
 * Persists all sessions to the Drive appDataFolder, truncating attached file
 * contents to 5000 chars for storage. The in-memory sessions are never mutated.
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
