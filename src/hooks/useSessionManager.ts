import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session, CouncilRound, Persona } from '../types';
import { summarizeTitle } from '../lib/titleUtils';
import {
  saveSessionsToDrive,
  loadSessionsFromDrive,
  deleteSessionFromDrive,
  isGoogleSignedIn,
  signInWithGoogle,
  signOutGoogle,
  mergeSessions,
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
      if (isGoogleSignedIn()) {
        setIsSyncing(true);
        // Pre-fetch remote to merge so concurrent or remote changes are not overwritten
        let toSave = current;
        try {
          const remote = await loadSessionsFromDrive();
          if (remote.length > 0) {
            const { merged } = mergeSessions(current, remote);
            toSave = merged;
            setSessions(merged);
            persistToLocalStorage(merged);
          }
        } catch (e) {
          console.warn('[SessionManager] Non-fatal pre-fetch merge notice:', e);
        }
        await saveSessionsToDrive(toSave);
        setLastSavedAt(Date.now());
        setSaveDestination('cloud');
        setSaveError(null);
      }
    } catch (err: any) {
      console.warn('[SessionManager] Flush error:', err);
      setSaveError(err?.message || 'Error syncing to Google Drive');
      throw err;
    } finally {
      setIsSaving(false);
      setIsSyncing(false);
    }
  }, []);

  // ---- Load: Merge local storage cache with Drive on mount ----
  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      const local = loadFromLocalStorage();
      let unified = local;
      let loadedFromCloud = false;

      if (isGoogleSignedIn()) {
        setIsSyncing(true);
        try {
          const driveSessions = await loadSessionsFromDrive();
          if (driveSessions.length > 0) {
            const { merged } = mergeSessions(local, driveSessions);
            unified = merged;
            loadedFromCloud = true;
            persistToLocalStorage(merged);
          }
        } catch (err) {
          console.warn('[SessionManager] Drive load notice (using local cache):', err);
        } finally {
          setIsSyncing(false);
        }
      }

      if (isMounted) {
        setSessions(unified);
        if (unified.length > 0) {
          setActiveSessionId((prev) => (prev && unified.some((s) => s.id === prev) ? prev : unified[0].id));
          const newestTime = unified.reduce((max, s) => Math.max(max, s.updatedAt || 0), 0);
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

    const next = [newSession, ...sessionsRef.current];
    setSessions(next);
    setActiveSessionId(newSession.id);
    writeLocalThrottled(next);
    writeDriveThrottled(next);
    return newSession;
  }, [writeLocalThrottled, writeDriveThrottled]);

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const renameSession = useCallback((sessionId: string, title: string) => {
    const clean = (title || '').trim();
    if (!clean) return;
    const next = sessionsRef.current.map((s) =>
      s.id === sessionId ? { ...s, title: clean, updatedAt: Date.now() } : s
    );
    setSessions(next);
    writeLocalThrottled(next);
    writeDriveThrottled(next);
  }, [writeLocalThrottled, writeDriveThrottled]);

  const deleteSession = useCallback((sessionId: string) => {
    const next = sessionsRef.current.filter((s) => s.id !== sessionId);
    setSessions(next);
    setActiveSessionId((prev) => (prev === sessionId ? next[0]?.id || null : prev));
    writeLocalThrottled(next);
    writeDriveThrottled(next);
    if (isGoogleSignedIn()) {
      setIsSyncing(true);
      deleteSessionFromDrive(sessionId)
        .catch((err) => console.warn('[SessionManager] Drive delete error:', err))
        .finally(() => setIsSyncing(false));
    }
  }, [writeLocalThrottled, writeDriveThrottled]);

  /** Clears the round history of a session (defaults to the active session). */
  const clearSessionHistory = useCallback((sessionId?: string) => {
    const targetId = sessionId || activeSessionId;
    if (!targetId) return;
    const next = sessionsRef.current.map((s) =>
      s.id === targetId ? { ...s, rounds: [], updatedAt: Date.now() } : s
    );
    setSessions(next);
    writeLocalThrottled(next);
    writeDriveThrottled(next);
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
    const next = sessionsRef.current.map((s) => {
      if (s.id !== sessionId) return s;
      const roundIdx = s.rounds.findIndex((r) => r.id === updatedRound.id);
      const nextRounds = [...s.rounds];
      if (roundIdx >= 0) {
        nextRounds[roundIdx] = updatedRound;
      } else {
        nextRounds.push(updatedRound);
      }
      const isDefaultTitle =
        !s.title ||
        s.title.trim() === '' ||
        s.title === 'New Deliberation' ||
        s.title === 'Untitled Session';
      return {
        ...s,
        rounds: nextRounds,
        title: isDefaultTitle && nextRounds.length === 1
          ? summarizeTitle(nextRounds[0]?.userQuery)
          : s.title,
        updatedAt: Date.now(),
      };
    });

    setSessions(next);

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
    const next = sessionsRef.current.map((s) =>
      s.id === activeSessionId
        ? { ...s, rounds: s.rounds.filter((r) => r.id !== roundId), updatedAt: Date.now() }
        : s
    );
    setSessions(next);
    writeLocalThrottled(next);
    writeDriveThrottled(next);
  }, [activeSessionId, writeLocalThrottled, writeDriveThrottled]);

  const exportSessionsJSON = useCallback((): string => {
    return JSON.stringify(sessionsRef.current, null, 2);
  }, []);

  const importSessionsJSON = useCallback(
    (
      jsonString: string,
      mode: 'merge' | 'replace' = 'merge'
    ): { success: boolean; message: string; count: number; addedCount: number; updatedCount: number } => {
      let parsed: any;
      try {
        parsed = JSON.parse(jsonString);
      } catch (err: any) {
        return { success: false, message: `Invalid JSON: ${err?.message || 'could not parse input.'}`, count: 0, addedCount: 0, updatedCount: 0 };
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
          addedCount: 0,
          updatedCount: 0,
        };
      }

      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s || typeof s.id !== 'string' || s.id.trim() === '') {
          return { success: false, message: `Invalid session at index ${i}: missing string "id".`, count: 0, addedCount: 0, updatedCount: 0 };
        }
        if (!Array.isArray(s.rounds)) {
          return { success: false, message: `Invalid session "${s.id}": "rounds" must be an array.`, count: 0, addedCount: 0, updatedCount: 0 };
        }
      }

      const imported = list as Session[];
      let finalSessions: Session[];
      let addedCount = imported.length;
      let updatedCount = 0;

      if (mode === 'replace') {
        finalSessions = imported;
      } else {
        // Smart merge: preserves existing threads and updates matching ones
        const res = mergeSessions(sessionsRef.current, imported);
        finalSessions = res.merged;
        addedCount = res.addedCount;
        updatedCount = res.updatedCount;
      }

      setSessions(finalSessions);
      if (finalSessions.length > 0) {
        setActiveSessionId((prev) =>
          prev && finalSessions.some((s) => s.id === prev) ? prev : finalSessions[0].id
        );
      }
      persistToLocalStorage(finalSessions);
      writeDriveThrottled(finalSessions);

      const message =
        mode === 'replace'
          ? `Replaced all sessions with ${imported.length} imported session(s).`
          : `Imported successfully: ${addedCount} added, ${updatedCount} updated (${finalSessions.length} total sessions).`;

      return {
        success: true,
        message,
        count: finalSessions.length,
        addedCount,
        updatedCount,
      };
    },
    [writeDriveThrottled]
  );

  const signIn = useCallback(async (): Promise<void> => {
    await signInWithGoogle();
    setIsSyncing(true);
    try {
      const driveSessions = await loadSessionsFromDrive();
      if (driveSessions.length > 0) {
        // Merge drive sessions with current local sessions so neither is lost
        const { merged } = mergeSessions(sessionsRef.current, driveSessions);
        setSessions(merged);
        if (merged.length > 0) {
          setActiveSessionId((prev) =>
            prev && merged.some((s) => s.id === prev) ? prev : merged[0].id
          );
        }
        persistToLocalStorage(merged);
        await saveSessionsToDrive(merged);
      } else if (sessionsRef.current.length > 0) {
        // Drive was empty; upload current local sessions to Drive
        await saveSessionsToDrive(sessionsRef.current);
      }
      setLastSavedAt(Date.now());
      setSaveDestination('cloud');
      setSaveError(null);
    } catch (err: any) {
      console.warn('[SessionManager] Drive post-signin sync error:', err);
      setSaveError(err?.message || 'Drive sync error');
      throw err;
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
    renameSession,
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
