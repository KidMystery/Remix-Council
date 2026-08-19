import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  type Firestore,
} from 'firebase/firestore';
import type { CouncilSession, AutonomousMission, FallbackAuditLog } from '../types';

const env = (import.meta as any).env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
  auth = getAuth(app);
  db = getFirestore(app);
}

// Authentication
export function initPersistence() {
  return { app, auth, db };
}

export async function getFirebaseIdToken(): Promise<string | null> {
  if (!auth?.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch (error) {
    console.error('[Auth] Error getting ID token:', error);
    return null;
  }
}

export async function loginWithGoogle(): Promise<User | null> {
  if (!auth) throw new Error('Firebase Auth is not configured.');
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (popupError: any) {
    console.warn('[Auth] Popup sign-in fallback to redirect:', popupError);
    await signInWithRedirect(auth, provider);
    return null;
  }
}

export async function handleAuthRedirectResult(): Promise<User | null> {
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error) {
    console.error('[Auth] Redirect sign-in error:', error);
    throw error;
  }
}

export async function logout(): Promise<void> {
  if (auth) await fbSignOut(auth);
}

export function getFirebaseAuth(): Auth | null {
  return auth;
}

export function getFirestoreDB(): Firestore | null {
  return db;
}

// Cloud Session Persistence
export async function saveSessionToFirestore(session: CouncilSession, userId: string = 'global_owner'): Promise<void> {
  if (!db) return;
  const sessionRef = doc(db, 'council_sessions', session.id);
  await setDoc(sessionRef, {
    ...session,
    userId,
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function fetchSessionsFromFirestore(userId: string = 'global_owner'): Promise<CouncilSession[]> {
  if (!db) return [];
  try {
    const sessionsCol = collection(db, 'council_sessions');
    const q = query(sessionsCol, where('userId', '==', userId), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as CouncilSession);
  } catch {
    try {
      const sessionsCol = collection(db, 'council_sessions');
      const q = query(sessionsCol, where('userId', '==', userId));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((d) => d.data() as CouncilSession);
      return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch {
      return [];
    }
  }
}

export async function deleteSessionFromFirestore(sessionId: string): Promise<void> {
  if (!db) return;
  const sessionRef = doc(db, 'council_sessions', sessionId);
  await deleteDoc(sessionRef);
}

// Cloud Autonomous Mission Persistence
export async function saveMissionToFirestore(mission: AutonomousMission, userId: string = 'global_owner'): Promise<void> {
  if (!db) return;
  const missionRef = doc(db, 'autonomous_missions', mission.id);
  await setDoc(missionRef, {
    ...mission,
    userId,
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function fetchMissionFromFirestore(missionId: string): Promise<AutonomousMission | null> {
  if (!db) return null;
  const missionRef = doc(db, 'autonomous_missions', missionId);
  const snap = await getDoc(missionRef);
  return snap.exists() ? (snap.data() as AutonomousMission) : null;
}

// Cloud Audit Log Persistence
export async function saveAuditLogToFirestore(auditLog: FallbackAuditLog): Promise<void> {
  if (!db) return;
  const logRef = doc(db, 'council_audit_logs', auditLog.id);
  const cleanDoc: Record<string, any> = {};
  for (const [key, value] of Object.entries(auditLog)) {
    if (value !== undefined) {
      cleanDoc[key] = value;
    }
  }
  await setDoc(logRef, cleanDoc);
}

export async function fetchAuditLogsFromFirestore(limitCount: number = 50): Promise<FallbackAuditLog[]> {
  if (!db) return [];
  try {
    const logsCol = collection(db, 'council_audit_logs');
    const q = query(logsCol, orderBy('timestamp', 'desc'), limit(limitCount));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as FallbackAuditLog);
  } catch {
    return [];
  }
}
