import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session, CouncilRound, Persona } from '../types';
import {
  saveSessionsToDrive,
  loadSessionsFromDrive,
  deleteSessionFromDrive,
  isGoogleSignedIn,
  signInWithGoogle,
  signOutGoogle,
} from '../lib/drivePersistence';

const LOCAL_STORAGE_KEY = 'council-sessions-v3';
const LOCAL_WRITE_THROTTLE_MS = 750;
const DRIVE_WRITE_THROTTLE_MS = 5000;
const LOCAL_CONTENT_MAX_CHARS = 2000;

/** Strips attached file contents to the given char cap for storage safety. */
function sanitizeForStorage(sessions: Session[], maxContentChars: number): Session[] {
  return sessions.map((s) => ({
    ...s,
    rounds: (s.rounds || []).map((r) => ({
      ...r,
      attachedTextFiles: (r.attachedTextFiles || []).map((f) => ({
        ...f,
        content: f.content && f.content.length > maxContentChars
          ? f.content.slice(0, maxContentChars)
          : f.content || '',
      })),
    })),
  }));
}

function loadFromLocalStorage(): Session[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[SessionManager] Failed to parse local session cache:', err);
    return [];
  }
}

function persistToLocalStorage(sessions: Session[]): void {
  try {
    const sanitized = sanitizeForStorage(sessions, LOCAL_CONTENT_MAX_CHARS);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (err) {
    console.warn('[SessionManager] Local storage write failed (quota?):', err);
  }
}

export function useSessionManager() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveDestination, setSaveDestination] = useState<'cloud' | 'local' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sessionsRef = useRef<Session[]>([]);
  sessionsRef.current = sessions;

  // ---- Throttled localStorage persistence (max 1 write per 750ms) ----
  const pendingLocalRef = useRef<Session[] | null>(null);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeLocalThrottled = useCallback((next: Session[]) => {
    pendingLocalRef.current = next;
    setIsSaving(true);
    if (localTimerRef.current) return;
    localTimerRef.current = setTimeout(() => {
      localTimerRef.current = null;
      if (pendingLocalRef.current) {
        try {
          persistToLocalStorage(pendingLocalRef.current);
          setLastSavedAt(Date.now());
          setSaveDestination(isGoogleSignedIn() ? 'cloud' : 'local');
          setSaveError(null);
        } catch (err: any) {
          setSaveError(err?.message || 'Failed to save to local storage');
        } finally {
          setIsSaving(false);
          pendingLocalRef.current = null;
        }
      } else {
        setIsSaving(false);
      }
    }, LOCAL_WRITE_THROTTLE_MS);
  }, []);

  // ---- Throttled Drive persistence (max 1 write per 5000ms) ----
  const pendingDriveRef = useRef<Session[] | null>(null);
  const driveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeDriveThrottled = useCallback((next: Session[]) => {
    if (!isGoogleSignedIn()) return;
    pendingDriveRef.current = next;
    if (driveTimerRef.current) return;
    driveTimerRef.current = setTimeout(() => {
      driveTimerRef.current = null;
      if (pendingDriveRef.current && isGoogleSignedIn()) {
        const payload = pendingDriveRef.current;
        pendingDriveRef.current = null;
        setIsSyncing(true);
        saveSessionsToDrive(payload)
          .then(() => {
            setLastSavedAt(Date.now());
            setSaveDestination('cloud');
            setSaveError(null);
          })
          .catch((err) => {
            console.warn('[SessionManager] Drive throttled write error:', err);
            setSaveError('Drive sync error');
          })
          .finally(() => setIsSyncing(false));
      }
    }, DRIVE_WRITE_THROTTLE_MS);
  }, []);

  // ---- Immediate flush to both localStorage and Drive ----
  const flushNow = useCallback(async () => {
    const current = sessionsRef.current;
    if (localTimerRef.current) {
      clearTimeout(localTimerRef.current);
      localTimerRef.current = null;
    }
    if (driveTimerRef.current) {
      clearTimeout(driveTimerRef.current);
      driveTimerRef.current = null;
    }
    pendingLocalRef.current = null;
    pendingDriveRef.current = null;
    setIsSaving(true);

    try {
      if (current.length > 0) {
        persistToLocalStorage(current);
        setLastSavedAt(Date.now());
        setSaveDestination(isGoogleSignedIn() ? 'cloud' : 'local');
        setSaveError(null);
      }
      if (isGoogleSignedIn() && current.length > 0) {
        setIsSyncing(true);
        await saveSessionsToDrive(current);
        setLastSavedAt(Date.now());
        setSaveDestination('cloud');
        setSaveError(null);
      }
    } catch (err: any) {
      console.warn('[SessionManager] Flush error:', err);
      setSaveError(err?.message || 'Error flushing session save');
    } finally {
      setIsSaving(false);
      setIsSyncing(false);
    }
  }, []);

  // ---- Load: Drive first when signed in, else localStorage ----
  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      let loaded: Session[] | null = null;
      let loadedFromCloud = false;

      if (isGoogleSignedIn()) {
        setIsSyncing(true);
        try {
          const driveSessions = await loadSessionsFromDrive();
          if (driveSessions.length > 0) {
            loaded = driveSessions;
            loadedFromCloud = true;
          }
        } catch (err) {
          console.warn('[SessionManager] Drive load failed; falling back to local cache:', err);
        } finally {
          setIsSyncing(false);
        }
      }

      if (loaded === null) {
        loaded = loadFromLocalStorage();
        loadedFromCloud = false;
      }

      if (isMounted) {
        setSessions(loaded);
        if (loaded.length > 0) {
          setActiveSessionId((prev) => prev && loaded.some((s) => s.id === prev) ? prev : loaded[0].id);
          const newestTime = loaded.reduce((max, s) => Math.max(max, s.updatedAt || 0), 0);
          setLastSavedAt(newestTime > 0 ? newestTime : Date.now());
          setSaveDestination(loadedFromCloud ? 'cloud' : 'local');
        } else {
          setActiveSessionId(null);
          setLastSavedAt(Date.now());
          setSaveDestination('local');
        }
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const createSession = useCallback((
    title: string = 'New Deliberation',
    personas: Persona[] = [],
    synthesizer?: Persona,
    activePresetId?: string
  ): Session => {
    const newSession: Session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      rounds: [],
      personas,
      synthesizer,
      activePresetId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSessions((prev) => {
      const next = [newSession, ...prev];
      writeLocalThrottled(next);
      writeDriveThrottled(next);
      return next;
    });
    setActiveSessionId(newSession.id);
    return newSession;
  }, [writeLocalThrottled, writeDriveThrottled]);

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[0]?.id || null);
      }
      writeLocalThrottled(next);
      writeDriveThrottled(next);
      return next;
    });
    if (isGoogleSignedIn()) {
      setIsSyncing(true);
      deleteSessionFromDrive(sessionId)
        .catch((err) => console.warn('[SessionManager] Drive delete error:', err))
        .finally(() => setIsSyncing(false));
    }
  }, [activeSessionId, writeLocalThrottled, writeDriveThrottled]);

  /** Clears the round history of a session (defaults to the active session). */
  const clearSessionHistory = useCallback((sessionId?: string) => {
    const targetId = sessionId || activeSessionId;
    if (!targetId) return;
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === targetId ? { ...s, rounds: [], updatedAt: Date.now() } : s
      );
      writeLocalThrottled(next);
      writeDriveThrottled(next);
      return next;
    });
  }, [activeSessionId, writeLocalThrottled, writeDriveThrottled]);

  const clearAllSessions = useCallback(() => {
    setSessions([]);
    setActiveSessionId(null);
    writeLocalThrottled([]);
    writeDriveThrottled([]);
  }, [writeLocalThrottled, writeDriveThrottled]);

  const upsertRound = useCallback((
    sessionId: string,
    updatedRound: CouncilRound,
    throttle: boolean
  ) => {
    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        const roundIdx = s.rounds.findIndex((r) => r.id === updatedRound.id);
        const nextRounds = [...s.rounds];
        if (roundIdx >= 0) {
          nextRounds[roundIdx] = updatedRound;
        } else {
          nextRounds.push(updatedRound);
        }
        return {
          ...s,
          rounds: nextRounds,
          updatedAt: Date.now(),
        };
      });

      if (throttle) {
        writeLocalThrottled(next);
        writeDriveThrottled(next);
      } else {
        persistToLocalStorage(next);
        if (isGoogleSignedIn()) {
          setIsSyncing(true);
          saveSessionsToDrive(next)
            .catch((err) => console.warn('[SessionManager] Drive immediate write error:', err))
            .finally(() => setIsSyncing(false));
        }
      }

      return next;
    });
  }, [writeLocalThrottled, writeDriveThrottled]);

  /** Adds a round to the active session (streaming-time updates are throttled). */
  const addRoundToActiveSession = useCallback((round: CouncilRound) => {
    if (!activeSessionId) return;
    upsertRound(activeSessionId, round, true);
  }, [activeSessionId, upsertRound]);

  /** Upserts a round into a session (throttled — used during streaming). */
  const updateRoundInActiveSession = useCallback((sessionId: string, round: CouncilRound) => {
    upsertRound(sessionId, round, true);
  }, [upsertRound]);

  const deleteRoundFromActiveSession = useCallback((roundId: string) => {
    if (!activeSessionId) return;
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, rounds: s.rounds.filter((r) => r.id !== roundId), updatedAt: Date.now() }
          : s
      );
      writeLocalThrottled(next);
      writeDriveThrottled(next);
      return next;
    });
  }, [activeSessionId, writeLocalThrottled, writeDriveThrottled]);

  const exportSessionsJSON = useCallback((): string => {
    return JSON.stringify(sessionsRef.current, null, 2);
  }, []);

  const importSessionsJSON = useCallback((jsonString: string): { success: boolean; message: string; count: number } => {
    let parsed: any;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err: any) {
      return { success: false, message: `Invalid JSON: ${err?.message || 'could not parse input.'}`, count: 0 };
    }

    let list: any[];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sessions)) {
      list = parsed.sessions;
    } else {
      return {
        success: false,
        message: 'Invalid import format: expected a JSON array of sessions or an object with a "sessions" array.',
        count: 0,
      };
    }

    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s || typeof s.id !== 'string' || s.id.trim() === '') {
        return { success: false, message: `Invalid session at index ${i}: missing string "id".`, count: 0 };
      }
      if (!Array.isArray(s.rounds)) {
        return { success: false, message: `Invalid session "${s.id}": "rounds" must be an array.`, count: 0 };
      }
    }

    const imported = list as Session[];
    setSessions(imported);
    setActiveSessionId(imported[0]?.id || null);
    persistToLocalStorage(imported);
    writeDriveThrottled(imported);
    return { success: true, message: `Imported ${imported.length} session(s).`, count: imported.length };
  }, [writeDriveThrottled]);

  const signIn = useCallback(async (): Promise<void> => {
    await signInWithGoogle();
    setIsSyncing(true);
    try {
      const driveSessions = await loadSessionsFromDrive();
      if (driveSessions.length > 0) {
        setSessions(driveSessions);
        setActiveSessionId(driveSessions[0].id);
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await signOutGoogle();
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;

  return {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    selectSession,
    deleteSession,
    clearSessionHistory,
    clearAllSessions,
    addRoundToActiveSession,
    updateRoundInActiveSession,
    deleteRoundFromActiveSession,
    exportSessionsJSON,
    importSessionsJSON,
    isSignedIn: isGoogleSignedIn(),
    signIn,
    signOut,
    isSyncing,
    isSaving,
    lastSavedAt,
    saveDestination,
    saveError,
    autoSaveState: {
      lastSavedAt,
      isSaving,
      isSyncing,
      destination: saveDestination,
      error: saveError,
    },
    flushNow,
    isLoading,
  };
}
