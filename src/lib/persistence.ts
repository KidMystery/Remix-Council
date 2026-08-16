import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  doc,
  setDoc,
  getDoc,
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
import { Session, Settings, Persona, AttachedTextFile } from '../types';

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

function resolveFirebaseConfig() {
  const env = import.meta.env;

  return {
    apiKey: env.VITE_FIREBASE_API_KEY || config.apiKey || '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || config.authDomain || '',
    projectId: env.VITE_FIREBASE_PROJECT_ID || config.projectId || '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || config.storageBucket || '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || config.messagingSenderId || '',
    appId: env.VITE_FIREBASE_APP_ID || config.appId || '',
  };
}

const firebaseConfig = resolveFirebaseConfig();

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let persistenceInitialized = false;

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
        }, config.firestoreDatabaseId || undefined);
      } catch {
        db = config.firestoreDatabaseId ? getFirestore(app, config.firestoreDatabaseId) : getFirestore(app);
      }

      auth = getAuth(app);
      try {
        setPersistence(auth, browserLocalPersistence).catch(() => {});
      } catch {}

      persistenceInitialized = true;
      console.log('Firebase persistence initialized successfully.');
      console.log('Firebase active project:', firebaseConfig.projectId);
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
        }, config.firestoreDatabaseId || undefined);
      } catch {
        db = config.firestoreDatabaseId ? getFirestore(app, config.firestoreDatabaseId) : getFirestore(app);
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

export function getFirebaseDb(): Firestore | null {
  if (!db) initPersistence();
  return db;
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

export async function loginWithGoogle(): Promise<User | 'redirecting' | null> {
  if (!auth) initPersistence();
  if (!auth) {
    throw new Error('Firebase Auth is not initialized. Check Firebase config.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user || null;
  } catch (error: any) {
    const code = error?.code || '';

    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'Unauthorized domain. Add your domain to Firebase Authentication → Settings → Authorized domains.'
      );
    }

    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/web-storage-unsupported' ||
      code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, provider);
      return 'redirecting';
    }

    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Google sign-in popup closed before login completed.');
    }

    throw new Error(error?.message || 'Google sign-in failed.');
  }
}

export async function handleAuthRedirectResult(): Promise<User | null> {
  if (!auth) initPersistence();
  if (!auth) return null;

  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    if (errMsg.includes('closing') || errMsg.includes('hidden')) {
      console.warn('Google redirect sign-in skipped: Database is closing/hidden (iframe context).');
    } else {
      console.error('Failed to complete Google redirect sign-in:', error);
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
