import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session, CouncilRound, Persona } from '../types';
import { summarizeTitle } from '../lib/titleUtils';
import {
  saveSessionsToDrive,
  loadSessionDriveDoc,
  deleteSessionFromDrive,
  isGoogleSignedIn,
  signInWithGoogle,
  signOutGoogle,
  mergeSessions,
  DriveUnreadError,
  DriveAuthRequiredError,
  DRIVE_AUTH_REQUIRED_EVENT,
  DRIVE_AUTH_RESTORED_EVENT,
  notifyDriveAuthRestored,
  trySilentDriveRestore,
  markDriveWanted,
  clearDriveWanted,
  type Tombstone,
} from '../lib/drivePersistence';
import {
  loadSessionsLocal,
  loadTombstonesLocal,
  loadTombstonesFromLocalStorage,
  persistSessionsLocal,
  persistTombstonesLocal,
} from '../lib/localSessionStore';
import { addTombstone, applyTombstones, DRIVE_UNREAD_MESSAGE, mergeTombstones } from '../lib/syncContract';

const LOCAL_WRITE_THROTTLE_MS = 750;
const DRIVE_WRITE_THROTTLE_MS = 5000;

function persistTombstones(stones: Tombstone[]): void {
  void persistTombstonesLocal(stones).catch((err) => {
    console.warn('[SessionManager] Could not persist delete marks:', err);
  });
}

function persistSessionsNow(sessions: Session[]): Promise<Session[]> {
  return persistSessionsLocal(sessions);
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
  const [driveNeedsReauth, setDriveNeedsReauth] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(() => isGoogleSignedIn());

  const sessionsRef = useRef<Session[]>([]);
  sessionsRef.current = sessions;
  const deletedRef = useRef<Tombstone[]>(loadTombstonesFromLocalStorage());

  useEffect(() => {
    const onNeed = () => setDriveNeedsReauth(true);
    const onOk = () => {
      setDriveNeedsReauth(false);
      setIsSignedIn(true);
    };
    window.addEventListener(DRIVE_AUTH_REQUIRED_EVENT, onNeed);
    window.addEventListener(DRIVE_AUTH_RESTORED_EVENT, onOk);
    return () => {
      window.removeEventListener(DRIVE_AUTH_REQUIRED_EVENT, onNeed);
      window.removeEventListener(DRIVE_AUTH_RESTORED_EVENT, onOk);
    };
  }, []);

  // ---- Throttled localStorage persistence (max 1 write per 750ms) ----
  const pendingLocalRef = useRef<Session[] | null>(null);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeLocalThrottled = useCallback((next: Session[]) => {
    pendingLocalRef.current = next;
    setIsSaving(true);
    if (localTimerRef.current) return;
    localTimerRef.current = setTimeout(() => {
      localTimerRef.current = null;
      const payload = pendingLocalRef.current;
      pendingLocalRef.current = null;
      if (!payload) {
        setIsSaving(false);
        return;
      }
      void persistSessionsNow(payload)
        .then(() => {
          setLastSavedAt(Date.now());
          setSaveDestination(isGoogleSignedIn() ? 'cloud' : 'local');
          setSaveError(null);
        })
        .catch((err: any) => {
          setSaveError(err?.message || 'Failed to save on this device');
        })
        .finally(() => setIsSaving(false));
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
        saveSessionsToDrive(payload, deletedRef.current)
          .then((doc) => {
            deletedRef.current = doc.deleted;
            persistTombstones(doc.deleted);
            sessionsRef.current = doc.sessions;
            setSessions(doc.sessions);
            setLastSavedAt(Date.now());
            setSaveDestination('cloud');
            setSaveError(null);
          })
          .catch((err) => {
            console.warn('[SessionManager] Drive throttled write error:', err);
            if (err instanceof DriveAuthRequiredError) {
              setDriveNeedsReauth(true);
              setSaveError(err.message);
              return;
            }
            setSaveError(err instanceof DriveUnreadError ? DRIVE_UNREAD_MESSAGE : 'Drive sync error');
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
        await persistSessionsNow(current);
        setLastSavedAt(Date.now());
        setSaveDestination(isGoogleSignedIn() ? 'cloud' : 'local');
        setSaveError(null);
      }
      if (isGoogleSignedIn()) {
        setIsSyncing(true);
        try {
          const doc = await saveSessionsToDrive(current, deletedRef.current);
          deletedRef.current = doc.deleted;
          persistTombstones(doc.deleted);
          sessionsRef.current = doc.sessions;
          setSessions(doc.sessions);
          await persistSessionsNow(doc.sessions);
          setLastSavedAt(Date.now());
          setSaveDestination('cloud');
          setSaveError(null);
          setDriveNeedsReauth(false);
        } catch (err: any) {
          if (err instanceof DriveAuthRequiredError) {
            setDriveNeedsReauth(true);
            setSaveError(err.message);
            return;
          }
          throw err;
        }
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

  // ---- Load: silent Drive restore (if this browser wanted it), then merge ----
  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      if (!isGoogleSignedIn()) {
        const restored = await trySilentDriveRestore();
        if (isMounted) setIsSignedIn(restored);
      } else if (isMounted) {
        setIsSignedIn(true);
      }

      const [local, stones] = await Promise.all([loadSessionsLocal(), loadTombstonesLocal()]);
      deletedRef.current = mergeTombstones(deletedRef.current, stones);
      let unified = local;
      let loadedFromCloud = false;

      if (isGoogleSignedIn()) {
        setIsSyncing(true);
        try {
          const remote = await loadSessionDriveDoc();
          const localDeleted = mergeTombstones(deletedRef.current, remote.deleted);
          const { merged, deleted } = mergeSessions(local, remote.sessions, localDeleted, remote.deleted);
          deletedRef.current = deleted;
          persistTombstones(deleted);
          unified = merged;
          loadedFromCloud = remote.sessions.length > 0 || remote.deleted.length > 0;
          await persistSessionsNow(merged);
        } catch (err) {
          console.warn('[SessionManager] Drive load notice (using local cache):', err);
          if (err instanceof DriveAuthRequiredError) {
            setDriveNeedsReauth(true);
          }
          unified = applyTombstones(local, deletedRef.current);
        } finally {
          setIsSyncing(false);
        }
      } else {
        unified = applyTombstones(local, deletedRef.current);
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
        setIsLoading(false);
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
    activePresetId?: string,
    extras?: { handoff?: Session['handoff'] }
  ): Session => {
    const newSession: Session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      rounds: [],
      personas,
      synthesizer,
      activePresetId,
      handoff: extras?.handoff,
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

  const patchSession = useCallback((sessionId: string, patch: Partial<Session>) => {
    const next = sessionsRef.current.map((s) =>
      s.id === sessionId ? { ...s, ...patch, id: s.id, updatedAt: Date.now() } : s
    );
    setSessions(next);
    writeLocalThrottled(next);
    writeDriveThrottled(next);
  }, [writeLocalThrottled, writeDriveThrottled]);

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
    deletedRef.current = addTombstone(deletedRef.current, sessionId);
    persistTombstones(deletedRef.current);
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
    const now = Date.now();
    for (const s of sessionsRef.current) {
      deletedRef.current = addTombstone(deletedRef.current, s.id, now);
    }
    persistTombstones(deletedRef.current);
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
      void persistSessionsNow(next).catch((err: any) => {
        setSaveError(err?.message || 'Failed to save on this device');
      });
      if (isGoogleSignedIn()) {
        setIsSyncing(true);
        saveSessionsToDrive(next, deletedRef.current)
          .then((doc) => {
            deletedRef.current = doc.deleted;
            persistTombstones(doc.deleted);
          })
          .catch((err) => {
            console.warn('[SessionManager] Drive immediate write error:', err);
            if (err instanceof DriveAuthRequiredError) {
              setDriveNeedsReauth(true);
              setSaveError(err.message);
              return;
            }
            setSaveError(err instanceof DriveUnreadError ? DRIVE_UNREAD_MESSAGE : 'Drive sync error');
          })
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
      void persistSessionsNow(finalSessions).catch((err: any) => {
        setSaveError(err?.message || 'Failed to save on this device');
      });
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
    markDriveWanted();
    setIsSignedIn(true);
    setIsSyncing(true);
    try {
      const remote = await loadSessionDriveDoc();
      const { merged, deleted } = mergeSessions(
        sessionsRef.current,
        remote.sessions,
        deletedRef.current,
        remote.deleted
      );
      deletedRef.current = deleted;
      persistTombstones(deleted);
      setSessions(merged);
      if (merged.length > 0) {
        setActiveSessionId((prev) =>
          prev && merged.some((s) => s.id === prev) ? prev : merged[0].id
        );
      }
      await persistSessionsNow(merged);
      await saveSessionsToDrive(merged, deleted);
      setLastSavedAt(Date.now());
      setSaveDestination('cloud');
      setSaveError(null);
      setDriveNeedsReauth(false);
      notifyDriveAuthRestored();
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
    clearDriveWanted();
    setIsSignedIn(false);
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;

  return {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    patchSession,
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
    isSignedIn,
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
    driveNeedsReauth,
    reconnectDrive: signIn,
  };
}
