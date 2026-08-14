import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, query, getDocs, deleteDoc, Firestore } from 'firebase/firestore';
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
} from 'firebase/auth';
import config from '../../firebase-applet-config.json';
import { Session, Settings, Persona } from '../types';

export interface PersistedSession {
  id: string;
  userId: string;
  title: string;
  rounds: any[];
  settings?: any;
  createdAt: number;
  updatedAt: number;
  shareToken?: string;
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

export function initPersistence(): boolean {
  if (getApps().length === 0) {
    try {
      if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        console.warn("Firebase configuration incomplete. Persistence will be localStorage-only.");
        persistenceInitialized = false;
        return false;
      }
      app = initializeApp(firebaseConfig);
      db = config.firestoreDatabaseId ? getFirestore(app, config.firestoreDatabaseId) : getFirestore(app);
      auth = getAuth(app);
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
    db = config.firestoreDatabaseId ? getFirestore(app, config.firestoreDatabaseId) : getFirestore(app);
    auth = getAuth(app);
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
  if (!db || !session.userId) {
    try {
      localStorage.setItem('council_local_backup_' + session.id, JSON.stringify(session));
    } catch (e) {
      console.warn('Failed to store local backup session:', e);
    }
    return session.shareToken || session.id;
  }

  try {
    await setDoc(doc(db, 'users', session.userId, 'sessions', session.id), session, { merge: true });
    return session.shareToken || session.id;
  } catch (e) {
    console.warn('Firestore setDoc failed, attempting localStorage fallback:', e);
    try {
      localStorage.setItem('council_local_backup_' + session.id, JSON.stringify(session));
    } catch {}
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
      sessions.push(doc.data() as PersistedSession);
    });
    return sessions;
  } catch (e) {
    console.error('Failed to load user sessions from Firestore:', e);
    return [];
  }
}

export async function deleteCloudSession(userId: string, sessionId: string): Promise<void> {
  if (!db) initPersistence();
  if (!db || !userId || !sessionId) return;
  try {
    await deleteDoc(doc(db, 'users', userId, 'sessions', sessionId));
  } catch (e) {
    console.error('Failed to delete cloud session:', e);
  }
}

export async function syncUserSettings(
  userId: string,
  settings?: Settings,
  personas?: Persona[],
  synthesizer?: Persona
): Promise<void> {
  if (!db) initPersistence();
  if (!db || !userId) return;

  const payload: UserCloudData = {
    updatedAt: Date.now(),
  };
  if (settings) payload.settings = settings;
  if (personas) payload.personas = personas;
  if (synthesizer) payload.synthesizer = synthesizer;

  try {
    await setDoc(doc(db, 'users', userId, 'settings', 'global_preferences'), payload, { merge: true });
  } catch (e) {
    console.error('Failed to sync user settings to Firestore:', e);
  }
}

export async function loadUserSettings(userId: string): Promise<UserCloudData | null> {
  if (!db) initPersistence();
  if (!db || !userId) return null;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'settings', 'global_preferences'));
    if (snap.exists()) {
      return snap.data() as UserCloudData;
    }
    return null;
  } catch (e) {
    console.error('Failed to load user settings from Firestore:', e);
    return null;
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
        'Unauthorized domain. Add your Railway URL to Firebase Authentication → Settings → Authorized domains.'
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
    console.error('Failed to complete Google redirect sign-in:', error);
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
