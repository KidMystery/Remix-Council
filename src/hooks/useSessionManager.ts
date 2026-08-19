import { useState, useEffect, useRef, useCallback } from 'react';
import type { CouncilSession, CouncilRound } from '../types';
import {
  saveSessionToFirestore,
  fetchSessionsFromFirestore,
  deleteSessionFromFirestore,
} from '../lib/persistence';

export function useSessionManager() {
  const [sessions, setSessions] = useState<CouncilSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pendingWritesRef = useRef<CouncilSession | null>(null);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load sessions from Firestore on initialization
  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const loaded = await fetchSessionsFromFirestore();
        if (isMounted) {
          setSessions(loaded);
          if (loaded.length > 0) {
            setActiveSessionId(loaded[0].id);
          }
        }
      } catch (err) {
        console.error('[SessionManager] Error loading sessions from Firestore:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  // Throttled Firestore persistence: at most 1 write per 750ms
  const persistSessionThrottled = useCallback((session: CouncilSession) => {
    pendingWritesRef.current = session;
    if (!throttleTimeoutRef.current) {
      throttleTimeoutRef.current = setTimeout(async () => {
        if (pendingWritesRef.current) {
          try {
            await saveSessionToFirestore(pendingWritesRef.current);
          } catch (e) {
            console.error('[SessionManager] Firestore write error:', e);
          }
          pendingWritesRef.current = null;
        }
        throttleTimeoutRef.current = null;
      }, 750);
    }
  }, []);

  // Explicit flush on round completion
  const flushSessionPersistence = useCallback(async (session: CouncilSession) => {
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }
    pendingWritesRef.current = null;
    try {
      await saveSessionToFirestore(session);
    } catch (e) {
      console.error('[SessionManager] Explicit Firestore flush error:', e);
    }
  }, []);

  const createSession = useCallback(async (title: string = 'New Deliberation'): Promise<CouncilSession> => {
    const newSession: CouncilSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      rounds: [],
      personas: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    await flushSessionPersistence(newSession);
    return newSession;
  }, [flushSessionPersistence]);

  const updateRoundInSession = useCallback(
    (sessionId: string, updatedRound: CouncilRound) => {
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
          const updatedSession = {
            ...s,
            rounds: nextRounds,
            updatedAt: Date.now(),
          };
          persistSessionThrottled(updatedSession);
          return updatedSession;
        });
        return next;
      });
    },
    [persistSessionThrottled]
  );

  const completeAndFlushRound = useCallback(
    async (sessionId: string, finishedRound: CouncilRound) => {
      let targetSession: CouncilSession | null = null;
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id !== sessionId) return s;
          const roundIdx = s.rounds.findIndex((r) => r.id === finishedRound.id);
          const nextRounds = [...s.rounds];
          if (roundIdx >= 0) {
            nextRounds[roundIdx] = finishedRound;
          } else {
            nextRounds.push(finishedRound);
          }
          targetSession = {
            ...s,
            rounds: nextRounds,
            updatedAt: Date.now(),
          };
          return targetSession;
        });
        return next;
      });

      if (targetSession) {
        await flushSessionPersistence(targetSession);
      }
    },
    [flushSessionPersistence]
  );

  const deleteSession = useCallback(async (sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[0]?.id || null);
      }
      return next;
    });
    try {
      await deleteSessionFromFirestore(sessionId);
    } catch (err) {
      console.error('[SessionManager] Failed to delete session from Firestore:', err);
    }
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;

  return {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    isLoading,
    createSession,
    updateRoundInSession,
    completeAndFlushRound,
    deleteSession,
  };
}
