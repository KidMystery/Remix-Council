import { useState, useEffect, useCallback, useRef } from 'react';
import { Session, CouncilRound } from '../types';
import { summarizeTitle } from '../lib/titleUtils';
import {
  isPersistenceEnabled,
  syncCouncilSession,
  loadUserSessions,
  deleteCloudSession,
} from '../lib/persistence';
import { User } from 'firebase/auth';

const STORAGE_KEY = 'council-sessions-v2';

interface StoredData {
  sessions: Session[];
  activeSessionId: string | null;
}

export function useSessionManager(user: User | null = null) {
  const [data, setData] = useState<StoredData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.sessions)) {
          return {
            sessions: parsed.sessions,
            activeSessionId: parsed.activeSessionId || (parsed.sessions[0]?.id ?? null),
          };
        }
      }
    } catch (e) {
      console.warn('Failed to parse council sessions from localStorage', e);
    }
    return {
      sessions: [],
      activeSessionId: null,
    };
  });

  const isCloudSyncEnabled = isPersistenceEnabled() && user !== null && !!user.uid;
  const userId = user?.uid || null;
  const loadedUserRef = useRef<string | null>(null);

  // Effect for cloud load and merging whenever user logs in
  useEffect(() => {
    const loadAndMergeSessions = async () => {
      if (!userId || !isCloudSyncEnabled) {
        return;
      }

      try {
        const cloudSessions = await loadUserSessions(userId);
        if (cloudSessions.length === 0) return;

        setData((prev) => {
          const cloudMap = new Map(cloudSessions.map((s) => [s.id, s]));
          const localMap = new Map(prev.sessions.map((s) => [s.id, s]));

          const mergedSessions: Session[] = [];
          let newActiveSessionId = prev.activeSessionId;

          // Add/update sessions from cloud
          cloudSessions.forEach((cloudSess) => {
            const localSess = localMap.get(cloudSess.id);
            if (localSess) {
              if (cloudSess.updatedAt > localSess.updatedAt) {
                mergedSessions.push({
                  id: cloudSess.id,
                  title: cloudSess.title,
                  rounds: cloudSess.rounds,
                  createdAt: cloudSess.createdAt,
                  updatedAt: cloudSess.updatedAt,
                  userId: cloudSess.userId,
                });
              } else {
                mergedSessions.push(localSess);
              }
            } else {
              mergedSessions.push({
                id: cloudSess.id,
                title: cloudSess.title,
                rounds: cloudSess.rounds,
                createdAt: cloudSess.createdAt,
                updatedAt: cloudSess.updatedAt,
                userId: cloudSess.userId,
              });
            }
          });

          // Add local-only sessions
          prev.sessions.forEach((localSess) => {
            if (!cloudMap.has(localSess.id)) {
              mergedSessions.push(localSess);
            }
          });

          // Sort by updatedAt descending
          mergedSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

          if (!newActiveSessionId || !mergedSessions.some((s) => s.id === newActiveSessionId)) {
            newActiveSessionId = mergedSessions[0]?.id || null;
          }

          return {
            sessions: mergedSessions,
            activeSessionId: newActiveSessionId,
          };
        });
      } catch (e) {
        console.error('Failed to load and merge cloud sessions:', e);
      }
    };

    if (userId && loadedUserRef.current !== userId) {
      loadedUserRef.current = userId;
      loadAndMergeSessions();
    }
  }, [userId, isCloudSyncEnabled]);

  // Save to localStorage and cloud whenever data changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save council sessions to localStorage', e);
    }

    if (isCloudSyncEnabled && userId) {
      data.sessions.forEach(async (session) => {
        await syncCouncilSession({
          id: session.id,
          userId: userId,
          title: session.title,
          rounds: session.rounds,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      });
    }
  }, [data, isCloudSyncEnabled, userId]);

  const activeSession = data.sessions.find((s) => s.id === data.activeSessionId);

  const createNewSession = useCallback((initialTitle?: string): Session => {
    const newSession: Session = {
      id: `session-${Date.now()}`,
      title: initialTitle || 'New Deliberation',
      rounds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      userId: userId || undefined,
    };

    setData((prev) => ({
      sessions: [newSession, ...prev.sessions],
      activeSessionId: newSession.id,
    }));

    return newSession;
  }, [userId]);

  const selectSession = useCallback((id: string) => {
    setData((prev) => ({
      ...prev,
      activeSessionId: id,
    }));
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    setData((prev) => {
      const nextSessions = prev.sessions.filter((s) => s.id !== id);
      const nextActiveId = prev.activeSessionId === id
        ? (nextSessions[0]?.id ?? null)
        : prev.activeSessionId;

      if (isCloudSyncEnabled && userId) {
        deleteCloudSession(userId, id);
      }

      return {
        sessions: nextSessions,
        activeSessionId: nextActiveId,
      };
    });
  }, [isCloudSyncEnabled, userId]);

  const clearSessionHistory = useCallback(async (sessionId?: string) => {
    setData((prev) => {
      const targetId = sessionId || prev.activeSessionId;
      if (!targetId) return prev;

      const sessions = prev.sessions.map((s) => {
        if (s.id === targetId) {
          return {
            ...s,
            rounds: [],
            updatedAt: Date.now(),
          };
        }
        return s;
      });

      if (isCloudSyncEnabled && userId) {
        const clearedSession = sessions.find((s) => s.id === targetId);
        if (clearedSession) {
          syncCouncilSession({
            id: clearedSession.id,
            userId: userId,
            title: clearedSession.title,
            rounds: [],
            createdAt: clearedSession.createdAt,
            updatedAt: clearedSession.updatedAt,
          });
        }
      }

      return {
        ...prev,
        sessions,
      };
    });
  }, [isCloudSyncEnabled, userId]);

  const clearAllSessions = useCallback(async () => {
    if (isCloudSyncEnabled && userId) {
      const allCloudSessions = await loadUserSessions(userId);
      await Promise.all(allCloudSessions.map((s) => deleteCloudSession(userId, s.id)));
    }

    setData({
      sessions: [],
      activeSessionId: null,
    });
    localStorage.removeItem(STORAGE_KEY);
  }, [isCloudSyncEnabled, userId]);

  const addRoundToActiveSession = useCallback((round: CouncilRound) => {
    setData((prev) => {
      let activeId = prev.activeSessionId;
      let sessions = [...prev.sessions];
      let activeIndex = sessions.findIndex((s) => s.id === activeId);

      if (activeIndex === -1) {
        const newSession: Session = {
          id: `session-${Date.now()}`,
          title: summarizeTitle(round.userQuery),
          rounds: [round],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          userId: userId || undefined,
        };
        return {
          sessions: [newSession, ...sessions],
          activeSessionId: newSession.id,
        };
      } else {
        const targetSession = sessions[activeIndex];
        const isFirstRound = targetSession.rounds.length === 0;
        const updatedSession: Session = {
          ...targetSession,
          title: isFirstRound && (targetSession.title === 'New Deliberation' || !targetSession.title)
            ? summarizeTitle(round.userQuery)
            : targetSession.title,
          rounds: [...targetSession.rounds, round],
          updatedAt: Date.now(),
        };
        sessions[activeIndex] = updatedSession;
        return {
          ...prev,
          sessions,
        };
      }
    });
  }, [userId]);

  const updateRoundInActiveSession = useCallback((roundId: string, updateFn: (round: CouncilRound) => CouncilRound) => {
    setData((prev) => {
      const activeIndex = prev.sessions.findIndex((s) => s.id === prev.activeSessionId);
      if (activeIndex === -1) return prev;

      const sessions = [...prev.sessions];
      const targetSession = sessions[activeIndex];
      const roundIndex = targetSession.rounds.findIndex((r) => r.id === roundId);
      if (roundIndex === -1) return prev;

      const updatedRounds = [...targetSession.rounds];
      updatedRounds[roundIndex] = updateFn(updatedRounds[roundIndex]);

      sessions[activeIndex] = {
        ...targetSession,
        rounds: updatedRounds,
        updatedAt: Date.now(),
      };

      return {
        ...prev,
        sessions,
      };
    });
  }, []);

  const deleteRoundFromActiveSession = useCallback((roundId: string) => {
    setData((prev) => {
      const activeIndex = prev.sessions.findIndex((s) => s.id === prev.activeSessionId);
      if (activeIndex === -1) return prev;

      const sessions = [...prev.sessions];
      const targetSession = sessions[activeIndex];
      const updatedRounds = targetSession.rounds.filter((r) => r.id !== roundId);

      sessions[activeIndex] = {
        ...targetSession,
        rounds: updatedRounds,
        updatedAt: Date.now(),
      };

      return {
        ...prev,
        sessions,
      };
    });
  }, []);

  const exportSessionsJSON = useCallback(() => {
    const bundle = {
      version: '2.0',
      exportedAt: Date.now(),
      sessions: data.sessions,
      activeSessionId: data.activeSessionId,
    };
    const jsonStr = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `council-chamber-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const importSessionsJSON = useCallback((jsonContent: string): { success: boolean; count: number; error?: string } => {
    try {
      const parsed = JSON.parse(jsonContent);
      let importedSessions: Session[] = [];
      let activeId: string | null = null;

      if (Array.isArray(parsed)) {
        importedSessions = parsed;
      } else if (parsed && Array.isArray(parsed.sessions)) {
        importedSessions = parsed.sessions;
        activeId = parsed.activeSessionId || null;
      } else {
        return { success: false, count: 0, error: 'Invalid JSON structure.' };
      }

      if (importedSessions.length === 0) {
        return { success: false, count: 0, error: 'No sessions found in file.' };
      }

      setData((prev) => {
        const existingIds = new Set(prev.sessions.map((s) => s.id));
        const merged = [...prev.sessions];
        importedSessions.forEach((s) => {
          if (!existingIds.has(s.id)) {
            merged.push(s);
          } else {
            const idx = merged.findIndex((m) => m.id === s.id);
            if (idx !== -1) merged[idx] = s;
          }
        });
        const nextActiveId = activeId || importedSessions[0]?.id || prev.activeSessionId;
        return {
          sessions: merged,
          activeSessionId: nextActiveId,
        };
      });

      return { success: true, count: importedSessions.length };
    } catch (err: any) {
      return { success: false, count: 0, error: err.message || 'Failed to parse JSON file.' };
    }
  }, []);

  return {
    sessions: data.sessions,
    activeSessionId: data.activeSessionId,
    activeSession,
    createNewSession,
    selectSession,
    deleteSession,
    clearSessionHistory,
    clearAllSessions,
    addRoundToActiveSession,
    updateRoundInActiveSession,
    deleteRoundFromActiveSession,
    exportSessionsJSON,
    importSessionsJSON,
  };
}
