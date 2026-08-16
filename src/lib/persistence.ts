import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  doc,
  setDoc,
  getDoc,
  getDocFromServer,
  collection,
  query,
  getDocs,
  deleteDoc,
  Firestore,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  User,
  Auth,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import config from '../../firebase-applet-config.json';
import { Session, Settings, Persona, AttachedTextFile, CouncilRound } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentAuth = getFirebaseAuth();
  const currentUser = currentAuth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo: currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Deep sanitization function that recursively strips undefined keys and converts non-serializables
 * so Firestore `setDoc` will NEVER fail with "Unsupported field value: undefined".
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined || data === null) {
    return null as unknown as T;
  }
  if (typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean as T;
}

export interface PersistedSession {
  id: string;
  userId: string;
  title: string;
  rounds: any[];
  settings?: any;
  createdAt: number;
  updatedAt: number;
  shareToken?: string;
  presetId?: any;
  personas?: Persona[];
  synthesizer?: Persona;
  customModels?: Record<string, string>;
  synthesizerModel?: string;
  attachedFiles?: AttachedTextFile[];
}

export interface UserCloudData {
  settings?: Settings;
  personas?: Persona[];
  synthesizer?: Persona;
  updatedAt?: number;
}

export interface AuthErrorInfo {
  code: string;
  message: string;
  hostname: string;
  origin: string;
  authDomain: string;
  projectId: string;
  durationMs: number;
  isQuickDismissal: boolean;
}

export class FirebaseAuthError extends Error {
  authInfo: AuthErrorInfo;

  constructor(message: string, authInfo: AuthErrorInfo) {
    super(message);
    this.name = 'FirebaseAuthError';
    this.authInfo = authInfo;
  }
}

function resolveFirebaseConfig() {
  const env = import.meta.env;

  const projectId = env.VITE_FIREBASE_PROJECT_ID || config.projectId || '';

  // VITE_FIREBASE_DATABASE_ID support:
  // If VITE_FIREBASE_DATABASE_ID is provided, use it.
  // If VITE_FIREBASE_PROJECT_ID overrides config.projectId, do not reuse a named database ID from another project.
  let firestoreDatabaseId: string | undefined = undefined;
  if (env.VITE_FIREBASE_DATABASE_ID !== undefined && env.VITE_FIREBASE_DATABASE_ID !== '') {
    firestoreDatabaseId = env.VITE_FIREBASE_DATABASE_ID;
  } else if (!env.VITE_FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID === config.projectId) {
    firestoreDatabaseId = config.firestoreDatabaseId || undefined;
  }

  return {
    apiKey: env.VITE_FIREBASE_API_KEY || config.apiKey || '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || config.authDomain || (projectId ? `${projectId}.firebaseapp.com` : ''),
    projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || config.storageBucket || (projectId ? `${projectId}.firebasestorage.app` : ''),
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || config.messagingSenderId || '',
    appId: env.VITE_FIREBASE_APP_ID || config.appId || '',
    firestoreDatabaseId,
  };
}

const firebaseConfig = resolveFirebaseConfig();

export function getFirebaseActiveConfig() {
  return {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    storageBucket: firebaseConfig.storageBucket,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || '(default)',
    hostname: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
    origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
  };
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let persistenceInitialized = false;
let isLoginInFlight = false;

function isOfflineOrUnavailableError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const code = (error as any)?.code;
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('client is offline') ||
    msg.includes('network error')
  );
}

export function initPersistence(): boolean {
  if (getApps().length === 0) {
    try {
      if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        console.warn("Firebase configuration incomplete. Persistence will be localStorage-only.");
        persistenceInitialized = false;
        return false;
      }
      app = initializeApp(firebaseConfig);
      try {
        db = initializeFirestore(app, {
          ignoreUndefinedProperties: true,
        }, firebaseConfig.firestoreDatabaseId || undefined);
      } catch {
        db = firebaseConfig.firestoreDatabaseId ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : getFirestore(app);
      }

      auth = getAuth(app);
      try {
        setPersistence(auth, browserLocalPersistence).catch(() => {});
      } catch {}

      persistenceInitialized = true;
      console.log('Firebase persistence initialized successfully.');
      console.log('Firebase active project:', firebaseConfig.projectId, 'Database:', firebaseConfig.firestoreDatabaseId || '(default)');

      return true;
    } catch (e) {
      console.error("Failed to initialize Firebase:", e);
      persistenceInitialized = false;
      return false;
    }
  }

  try {
    app = getApps()[0];
    if (!db) {
      try {
        db = initializeFirestore(app, {
          ignoreUndefinedProperties: true,
        }, firebaseConfig.firestoreDatabaseId || undefined);
      } catch {
        db = firebaseConfig.firestoreDatabaseId ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : getFirestore(app);
      }
    }
    if (!auth) {
      auth = getAuth(app);
      try {
        setPersistence(auth, browserLocalPersistence).catch(() => {});
      } catch {}
    }
    persistenceInitialized = true;
    return true;
  } catch (e) {
    console.error("Failed to retrieve Firebase app references:", e);
    persistenceInitialized = false;
    return false;
  }
}

export function isPersistenceEnabled(): boolean {
  if (!persistenceInitialized) {
    initPersistence();
  }
  return persistenceInitialized;
}

export function getFirebaseAuth(): Auth | null {
  if (!auth) initPersistence();
  return auth;
}

export async function getFirebaseIdToken(): Promise<string | null> {
  const currentAuth = getFirebaseAuth();
  if (currentAuth && currentAuth.currentUser) {
    try {
      return await currentAuth.currentUser.getIdToken();
    } catch {
      return null;
    }
  }
  return null;
}

export function getFirebaseDb(): Firestore | null {
  if (!db) initPersistence();
  return db;
}

export function migrateLocalSession(raw: any): Session {
  if (!raw || typeof raw !== 'object') {
    return {
      id: `session_${Date.now()}`,
      title: 'New Session',
      rounds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : `session_${Date.now()}`;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Untitled Deliberation';
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  const rounds: CouncilRound[] = Array.isArray(raw.rounds) ? raw.rounds : [];

  return {
    id,
    title,
    rounds,
    createdAt,
    updatedAt,
    userId: typeof raw.userId === 'string' ? raw.userId : undefined,
    presetId: raw.presetId,
    budgetPolicy: raw.budgetPolicy,
    personas: Array.isArray(raw.personas) ? raw.personas : undefined,
    synthesizer: raw.synthesizer,
    customModels: raw.customModels && typeof raw.customModels === 'object' ? raw.customModels : undefined,
    synthesizerModel: typeof raw.synthesizerModel === 'string' ? raw.synthesizerModel : undefined,
    attachedFiles: Array.isArray(raw.attachedFiles) ? raw.attachedFiles : undefined,
  };
}

export async function syncCouncilSession(session: PersistedSession): Promise<string> {
  if (!db) initPersistence();
  const sanitized = sanitizeForFirestore(session);

  try {
    localStorage.setItem('council_local_backup_' + session.id, JSON.stringify(sanitized));
  } catch (e) {
    console.warn('Failed to store local backup session:', e);
  }

  if (!db || !session.userId) {
    return session.shareToken || session.id;
  }

  try {
    await setDoc(doc(db, 'users', session.userId, 'sessions', session.id), sanitized, { merge: true });
    return session.shareToken || session.id;
  } catch (e: any) {
    if (isOfflineOrUnavailableError(e)) {
      console.warn('Firestore offline: session stored in local backup.', session.id);
      return session.shareToken || session.id;
    }
    console.warn('Firestore setDoc failed, retained in local storage:', e);
    return session.shareToken || session.id;
  }
}

export async function loadUserSessions(userId: string): Promise<PersistedSession[]> {
  if (!db) initPersistence();
  if (!db || !userId) return [];

  try {
    const sessionsRef = collection(db, 'users', userId, 'sessions');
    const q = query(sessionsRef);
    const querySnapshot = await getDocs(q);
    const sessions: PersistedSession[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as PersistedSession;
      if (data && data.id) {
        sessions.push(data);
      }
    });
    // Sort by updatedAt descending
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return sessions;
  } catch (e: any) {
    if (isOfflineOrUnavailableError(e)) {
      console.warn('Firestore offline: using local sessions cache.');
      return [];
    }
    console.warn('Could not load user sessions from Firestore:', e);
    return [];
  }
}

export async function deleteCloudSession(userId: string, sessionId: string): Promise<void> {
  if (!db) initPersistence();
  if (!db || !userId || !sessionId) return;
  try {
    await deleteDoc(doc(db, 'users', userId, 'sessions', sessionId));
  } catch (e: any) {
    if (isOfflineOrUnavailableError(e)) {
      console.warn('Firestore offline: session deletion deferred.');
      return;
    }
    console.warn('Failed to delete cloud session:', e);
  }
}

export async function syncUserSettings(
  userId: string,
  settings?: Settings,
  personas?: Persona[],
  synthesizer?: Persona
): Promise<void> {
  if (!db) initPersistence();
  if (!userId) return;

  const payload: UserCloudData = {
    updatedAt: Date.now(),
  };
  if (settings) payload.settings = settings;
  if (personas) payload.personas = personas;
  if (synthesizer) payload.synthesizer = synthesizer;

  const sanitized = sanitizeForFirestore(payload);

  // Always mirror to local storage
  try {
    localStorage.setItem(`council_user_settings_${userId}`, JSON.stringify(sanitized));
  } catch {}

  if (!db) return;

  try {
    await setDoc(doc(db, 'users', userId, 'settings', 'global_preferences'), sanitized, { merge: true });
  } catch (e: any) {
    if (isOfflineOrUnavailableError(e)) {
      console.warn('Firestore offline: user settings saved to local storage.');
      return;
    }
    console.warn('Failed to sync user settings to Firestore (saved locally):', e);
  }
}

export async function loadUserSettings(userId: string): Promise<UserCloudData | null> {
  if (!db) initPersistence();

  // Check local cache first as instantaneous fallback
  let localData: UserCloudData | null = null;
  try {
    const raw = localStorage.getItem(`council_user_settings_${userId}`);
    if (raw) {
      localData = JSON.parse(raw);
    }
  } catch {}

  if (!db || !userId) return localData;

  try {
    const snap = await getDoc(doc(db, 'users', userId, 'settings', 'global_preferences'));
    if (snap.exists()) {
      const data = snap.data() as UserCloudData;
      // Update local mirror
      try {
        localStorage.setItem(`council_user_settings_${userId}`, JSON.stringify(data));
      } catch {}
      return data;
    }
    return localData;
  } catch (e: any) {
    if (isOfflineOrUnavailableError(e)) {
      console.warn('Firestore offline: loaded user settings from local backup.');
      return localData;
    }
    console.warn('Could not load user settings from Firestore (using local fallback):', e);
    return localData;
  }
}

export async function loginWithGoogle(): Promise<User | null> {
  if (isLoginInFlight) {
    console.warn('[FirebaseAuth] A login operation is already in flight.');
    return null;
  }

  if (!auth) initPersistence();
  if (!auth) {
    const initErr = new Error('[auth/not-initialized] Firebase Auth is not initialized. Please verify Firebase project configuration.');
    console.error('[FirebaseAuth] Login failed:', initErr);
    throw initErr;
  }

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'unknown';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
  const startTime = Date.now();
  isLoginInFlight = true;

  console.log('[FirebaseAuth] Starting Google sign-in process...', {
    hostname,
    origin,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
  });

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    console.log('[FirebaseAuth] Attempting signInWithPopup...');
    const result = await signInWithPopup(auth, provider);
    const durationMs = Date.now() - startTime;
    console.log('[FirebaseAuth] signInWithPopup succeeded for user:', {
      user: result?.user?.email || result?.user?.uid,
      durationMs,
    });
    return result?.user || null;
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    const code = error?.code || 'auth/unknown';
    const rawMessage = error?.message || 'Google sign-in failed.';
    const isQuickDismissal = durationMs < 2500;

    const authInfo: AuthErrorInfo = {
      code,
      message: rawMessage,
      hostname,
      origin,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
      durationMs,
      isQuickDismissal,
    };

    // Diagnostic console logging without printing tokens, secrets, or API keys
    if (code === 'auth/popup-closed-by-user' && !isQuickDismissal) {
      console.info('[FirebaseAuth] User closed sign-in popup:', {
        code: authInfo.code,
        durationMs: authInfo.durationMs,
      });
    } else {
      console.warn('[FirebaseAuth] Authentication notice:', {
        code: authInfo.code,
        message: authInfo.message,
        hostname: authInfo.hostname,
        origin: authInfo.origin,
        authDomain: authInfo.authDomain,
        projectId: authInfo.projectId,
        durationMs: authInfo.durationMs,
        isQuickDismissal: authInfo.isQuickDismissal,
      });
    }

    let customMessage = rawMessage;
    if (code === 'auth/unauthorized-domain') {
      customMessage = `Unauthorized domain '${hostname}'. Please add this exact hostname to Firebase Console → Authentication → Settings → Authorized domains.`;
    } else if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      customMessage = `Google Sign-In provider is disabled in Firebase. Enable Google under Firebase Console → Authentication → Sign-in method.`;
    } else if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid' || code === 'auth/configuration-not-found') {
      customMessage = `Firebase configuration error for Project ID '${firebaseConfig.projectId}' and Auth Domain '${firebaseConfig.authDomain}'. Please verify your client configuration.`;
    } else if (code === 'auth/popup-blocked') {
      customMessage = `Sign-in popup was blocked by the browser. Click below to continue using redirect authentication.`;
    } else if (code === 'auth/popup-closed-by-user') {
      if (isQuickDismissal) {
        customMessage = `Sign-in popup closed immediately before completing login (${durationMs}ms). This is usually caused by iframe restrictions or popup blockers. Click below to continue using redirect.`;
      } else {
        customMessage = `Sign-in popup was closed before completing login.`;
      }
    } else if (code === 'auth/cancelled-popup-request') {
      customMessage = `Sign-in popup request was cancelled or superseded by another action. Click below to continue using redirect.`;
    } else if (code === 'auth/network-request-failed') {
      customMessage = `Network error connecting to Firebase Authentication. Please check your internet connection or firewall/CORS settings.`;
    }

    throw new FirebaseAuthError(customMessage, authInfo);
  } finally {
    isLoginInFlight = false;
  }
}

export async function loginWithGoogleRedirect(): Promise<void> {
  if (isLoginInFlight) {
    console.warn('[FirebaseAuth] A login operation is already in flight.');
    return;
  }

  if (!auth) initPersistence();
  if (!auth) {
    throw new Error('[auth/not-initialized] Firebase Auth is not initialized.');
  }

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'unknown';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown';
  isLoginInFlight = true;

  console.log('[FirebaseAuth] User initiated direct signInWithRedirect...', {
    hostname,
    origin,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
  });

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithRedirect(auth, provider);
  } catch (error: any) {
    isLoginInFlight = false;
    const code = error?.code || 'auth/unknown';
    const rawMessage = error?.message || 'Redirect sign-in failed.';
    console.error('[FirebaseAuth] Direct signInWithRedirect failed:', {
      code,
      message: rawMessage,
      hostname,
      origin,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
    });
    throw new FirebaseAuthError(rawMessage, {
      code,
      message: rawMessage,
      hostname,
      origin,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
      durationMs: 0,
      isQuickDismissal: false,
    });
  }
}

export async function handleAuthRedirectResult(): Promise<User | null> {
  if (!auth) initPersistence();
  if (!auth) {
    console.warn('[FirebaseAuth] Auth not initialized during handleAuthRedirectResult.');
    return null;
  }

  try {
    console.log('[FirebaseAuth] Checking for pending redirect authentication result...');
    const result = await getRedirectResult(auth);
    if (result?.user) {
      console.log('[FirebaseAuth] Successfully recovered user from redirect sign-in:', result.user.email || result.user.uid);
      return result.user;
    }
    console.log('[FirebaseAuth] No pending redirect authentication result found.');
    return null;
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const code = error?.code || '';
    if (errMsg.includes('closing') || errMsg.includes('hidden')) {
      console.warn('[FirebaseAuth] Google redirect sign-in skipped: Database is closing/hidden (iframe context).');
    } else {
      console.error('[FirebaseAuth] Error resolving redirect authentication result:', {
        code,
        message: errMsg,
        error,
      });
    }
    return null;
  }
}

export async function logout(): Promise<void> {
  if (!auth) initPersistence();
  if (auth) {
    await signOut(auth);
  }
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  if (!auth) initPersistence();
  if (!auth) {
    console.warn("Firebase Auth not initialized for auth change listener.");
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}
