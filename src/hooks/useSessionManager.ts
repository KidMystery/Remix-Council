import { useState, useEffect, useCallback, useRef } from 'react';
import { Session, CouncilRound, Persona, AttachedTextFile } from '../types';
import type { PresetId } from '../lib/presets';
import { summarizeTitle } from '../lib/titleUtils';
import {
  isPersistenceEnabled,
  syncCouncilSession,
  loadUserSessions,
  deleteCloudSession,
  subscribeToUserSessions,
  PersistedSession,
  isOfflineOrUnavailableError,
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
          const sanitizedSessions: Session[] = parsed.sessions.map((s: any) => ({
            ...s,
            title: typeof s?.title === 'string' && s.title.trim() ? s.title : 'New Deliberation',
          }));
          return {
            sessions: sanitizedSessions,
            activeSessionId: parsed.activeSessionId || (sanitizedSessions[0]?.id ?? null),
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

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const isCloudSyncEnabled = isPersistenceEnabled() && user !== null && !!user.uid;
  const userId = user?.uid || null;
  const loadedUserRef = useRef<string | null>(null);
  const lastSyncCheckRef = useRef<number>(0);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Bidirectional merge function between Firestore cloud sessions and local sessions
  const mergeCloudAndLocalSessions = useCallback(async (currentUserId: string, silent = false) => {
    if (!currentUserId || !isPersistenceEnabled()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    if (!silent) setIsSyncing(true);

    try {
      const cloudSessions = await loadUserSessions(currentUserId);
      const cloudMap = new Map(cloudSessions.map((s) => [s.id, s]));

      setData((prev) => {
        const localMap = new Map(prev.sessions.map((s) => [s.id, s]));
        const mergedSessions: Session[] = [];
        const sessionsToUpload: Session[] = [];
        let newActiveSessionId = prev.activeSessionId;

        // Process all cloud sessions
        cloudSessions.forEach((cloudSess) => {
          const localSess = localMap.get(cloudSess.id);
          if (localSess) {
            // Compare timestamps
            if ((cloudSess.updatedAt || 0) >= (localSess.updatedAt || 0)) {
              mergedSessions.push({
                id: cloudSess.id,
                title: cloudSess.title,
                rounds: cloudSess.rounds || [],
                createdAt: cloudSess.createdAt || Date.now(),
                updatedAt: cloudSess.updatedAt || Date.now(),
                userId: currentUserId,
                presetId: cloudSess.presetId || localSess.presetId,
                personas: cloudSess.personas || localSess.personas,
                synthesizer: cloudSess.synthesizer || localSess.synthesizer,
                customModels: cloudSess.customModels || localSess.customModels,
                synthesizerModel: cloudSess.synthesizerModel || localSess.synthesizerModel,
                attachedFiles: cloudSess.attachedFiles || localSess.attachedFiles,
              });
            } else {
              // Local has newer changes: keep local and queue for upload
              const updatedLocal = { ...localSess, userId: currentUserId };
              mergedSessions.push(updatedLocal);
              sessionsToUpload.push(updatedLocal);
            }
          } else {
            // New cloud session not present locally
            mergedSessions.push({
              id: cloudSess.id,
              title: cloudSess.title,
              rounds: cloudSess.rounds || [],
              createdAt: cloudSess.createdAt || Date.now(),
              updatedAt: cloudSess.updatedAt || Date.now(),
              userId: currentUserId,
              presetId: cloudSess.presetId,
              personas: cloudSess.personas,
              synthesizer: cloudSess.synthesizer,
              customModels: cloudSess.customModels,
              synthesizerModel: cloudSess.synthesizerModel,
              attachedFiles: cloudSess.attachedFiles,
            });
          }
        });

        // Process all local sessions that are not yet in cloud
        prev.sessions.forEach((localSess) => {
          if (!cloudMap.has(localSess.id)) {
            const adoptedSession = { ...localSess, userId: currentUserId };
            mergedSessions.push(adoptedSession);
            sessionsToUpload.push(adoptedSession);
          }
        });

        // Sort all by updatedAt descending
        mergedSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        if (!newActiveSessionId || !mergedSessions.some((s) => s.id === newActiveSessionId)) {
          newActiveSessionId = mergedSessions[0]?.id || null;
        }

        // Upload any local sessions that need to be backed up to cloud
        if (sessionsToUpload.length > 0) {
          // Process uploads sequentially or in small batches to prevent Firestore quota exhaustion
          const uploadConcurrently = async () => {
            for (let i = 0; i < sessionsToUpload.length; i += 5) {
              const batch = sessionsToUpload.slice(i, i + 5);
              await Promise.allSettled(batch.map((s) => 
                syncCouncilSession({
                id: s.id,
                userId: currentUserId,
                title: s.title,
                rounds: s.rounds,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                presetId: s.presetId,
                personas: s.personas,
                synthesizer: s.synthesizer,
                customModels: s.customModels,
                synthesizerModel: s.synthesizerModel,
                attachedFiles: s.attachedFiles,
              })
              ));
            }
          };
          uploadConcurrently().catch((err) => console.warn('Background batch sync encountered an issue:', err));
        }

        return {
          sessions: mergedSessions,
          activeSessionId: newActiveSessionId,
        };
      });

      setLastSyncedAt(Date.now());
      lastSyncCheckRef.current = Date.now();
    } catch (e: any) {
      if (isOfflineOrUnavailableError(e)) {
        console.warn('Cloud sync skipped: Database offline or closing/hidden.');
      } else {
        console.error('Failed to load and merge cloud sessions:', e);
      }
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }, []);

  // Effect for cloud load and merging whenever user logs in or auth resolves, using real-time subscription
  useEffect(() => {
    if (userId && isCloudSyncEnabled) {
      if (loadedUserRef.current !== userId) {
        loadedUserRef.current = userId;
        // Do an initial merge (which also handles local->cloud upload of un-synced items)
        mergeCloudAndLocalSessions(userId, false);
      }

      // Start real-time subscription for subsequent updates
      const unsubscribe = subscribeToUserSessions(userId, (cloudSessions) => {
        setData((prev) => {
          const localMap = new Map(prev.sessions.map((s) => [s.id, s]));
          const mergedSessions: Session[] = [];
          const sessionsToUpload: Session[] = [];
          let newActiveSessionId = prev.activeSessionId;

          cloudSessions.forEach((cloudSess) => {
            const localSess = localMap.get(cloudSess.id);
            if (localSess) {
              if ((cloudSess.updatedAt || 0) >= (localSess.updatedAt || 0)) {
                mergedSessions.push({
                  ...cloudSess,
                  userId,
                  rounds: cloudSess.rounds || [],
                  presetId: cloudSess.presetId || localSess.presetId,
                  personas: cloudSess.personas || localSess.personas,
                  synthesizer: cloudSess.synthesizer || localSess.synthesizer,
                  customModels: cloudSess.customModels || localSess.customModels,
                  synthesizerModel: cloudSess.synthesizerModel || localSess.synthesizerModel,
                  attachedFiles: cloudSess.attachedFiles || localSess.attachedFiles,
                });
              } else {
                const updatedLocal = { ...localSess, userId };
                mergedSessions.push(updatedLocal);
                sessionsToUpload.push(updatedLocal);
              }
            } else {
              mergedSessions.push({ ...cloudSess, userId, rounds: cloudSess.rounds || [] });
            }
          });

          prev.sessions.forEach((localSess) => {
            if (!cloudSessions.some(c => c.id === localSess.id)) {
              const adoptedSession = { ...localSess, userId };
              mergedSessions.push(adoptedSession);
              sessionsToUpload.push(adoptedSession);
            }
          });

          mergedSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

          if (!newActiveSessionId || !mergedSessions.some((s) => s.id === newActiveSessionId)) {
            newActiveSessionId = mergedSessions[0]?.id || null;
          }

          if (sessionsToUpload.length > 0) {
            const uploadConcurrently = async () => {
              for (let i = 0; i < sessionsToUpload.length; i += 5) {
                const batch = sessionsToUpload.slice(i, i + 5);
                await Promise.allSettled(batch.map((s) => syncCouncilSession(s as any)));
              }
            };
            uploadConcurrently().catch((err) => console.warn('Background batch sync encountered an issue:', err));
          }

          return {
            sessions: mergedSessions,
            activeSessionId: newActiveSessionId,
          };
        });
        setLastSyncedAt(Date.now());
      });

      return () => {
        unsubscribe();
      };
    } else {
      loadedUserRef.current = null;
    }
  }, [userId, isCloudSyncEnabled, mergeCloudAndLocalSessions]);

  // Window Focus / Visibility Change Listener to automatically refresh sessions when returning on mobile/tab switch
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!userId || !isCloudSyncEnabled) return;
      const now = Date.now();
      // Throttle background refresh to at most once every 10 seconds
      if (now - lastSyncCheckRef.current > 10000) {
        lastSyncCheckRef.current = now;
        mergeCloudAndLocalSessions(userId, true);
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [userId, isCloudSyncEnabled, mergeCloudAndLocalSessions]);

  // Save to localStorage immediately whenever data changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save council sessions to localStorage', e);
    }
  }, [data]);

  const syncWithCloud = useCallback(async () => {
    if (!userId || !isCloudSyncEnabled) return;
    await mergeCloudAndLocalSessions(userId, false);
  }, [userId, isCloudSyncEnabled, mergeCloudAndLocalSessions]);

  const activeSession = data.sessions.find((s) => s.id === data.activeSessionId);

  const updateActiveSessionConfig = useCallback((config: {
    presetId?: PresetId;
    personas?: Persona[];
    synthesizer?: Persona;
    customModels?: Record<string, string>;
    synthesizerModel?: string;
  }) => {
    setData((prev) => {
      const activeIndex = prev.sessions.findIndex((s) => s.id === prev.activeSessionId);
      if (activeIndex === -1) return prev;

      const sessions = [...prev.sessions];
      const targetSession = sessions[activeIndex];
      const updatedSession = {
        ...targetSession,
        presetId: config.presetId !== undefined ? config.presetId : targetSession.presetId,
        personas: config.personas !== undefined ? config.personas : targetSession.personas,
        synthesizer: config.synthesizer !== undefined ? config.synthesizer : targetSession.synthesizer,
        customModels: config.customModels !== undefined ? config.customModels : targetSession.customModels,
        synthesizerModel: config.synthesizerModel !== undefined ? config.synthesizerModel : targetSession.synthesizerModel,
        updatedAt: Date.now(),
      };
      sessions[activeIndex] = updatedSession;

      if (isCloudSyncEnabled && userId) {
        syncCouncilSession({
          id: updatedSession.id,
          userId,
          title: updatedSession.title,
          rounds: updatedSession.rounds,
          createdAt: updatedSession.createdAt,
          updatedAt: updatedSession.updatedAt,
          presetId: updatedSession.presetId,
          personas: updatedSession.personas,
          synthesizer: updatedSession.synthesizer,
          customModels: updatedSession.customModels,
          synthesizerModel: updatedSession.synthesizerModel,
          attachedFiles: updatedSession.attachedFiles,
        });
      }

      return {
        ...prev,
        sessions,
      };
    });
  }, [isCloudSyncEnabled, userId]);

  const updateActiveSessionFiles = useCallback((files: AttachedTextFile[] | undefined) => {
    setData((prev) => {
      const activeIndex = prev.sessions.findIndex((s) => s.id === prev.activeSessionId);
      if (activeIndex === -1) return prev;

      const sessions = [...prev.sessions];
      const targetSession = sessions[activeIndex];
      const updatedSession = {
        ...targetSession,
        attachedFiles: files,
        updatedAt: Date.now(),
      };
      sessions[activeIndex] = updatedSession;

      if (isCloudSyncEnabled && userId) {
        syncCouncilSession({
          id: updatedSession.id,
          userId,
          title: updatedSession.title,
          rounds: updatedSession.rounds,
          createdAt: updatedSession.createdAt,
          updatedAt: updatedSession.updatedAt,
          presetId: updatedSession.presetId,
          personas: updatedSession.personas,
          synthesizer: updatedSession.synthesizer,
          customModels: updatedSession.customModels,
          synthesizerModel: updatedSession.synthesizerModel,
          attachedFiles: updatedSession.attachedFiles,
        });
      }

      return {
        ...prev,
        sessions,
      };
    });
  }, [isCloudSyncEnabled, userId]);

  const createNewSession = useCallback((initialTitle?: string): Session => {
    const cleanTitle = typeof initialTitle === 'string' && initialTitle.trim() ? initialTitle.trim() : 'New Deliberation';
    const newSession: Session = {
      id: `session-${Date.now()}`,
      title: cleanTitle,
      rounds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      userId: userId || undefined,
    };

    setData((prev) => ({
      sessions: [newSession, ...prev.sessions],
      activeSessionId: newSession.id,
    }));

    if (isCloudSyncEnabled && userId) {
      syncCouncilSession({
        id: newSession.id,
        userId,
        title: newSession.title,
        rounds: [],
        createdAt: newSession.createdAt,
        updatedAt: newSession.updatedAt,
      });
    }

    return newSession;
  }, [isCloudSyncEnabled, userId]);

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
      await Promise.allSettled(allCloudSessions.map((s) => deleteCloudSession(userId, s.id)));
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
        if (isCloudSyncEnabled && userId) {
          syncCouncilSession({
            id: newSession.id,
            userId,
            title: newSession.title,
            rounds: newSession.rounds,
            createdAt: newSession.createdAt,
            updatedAt: newSession.updatedAt,
          });
        }
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
          userId: userId || targetSession.userId,
        };
        sessions[activeIndex] = updatedSession;
        if (isCloudSyncEnabled && userId) {
          syncCouncilSession({
            id: updatedSession.id,
            userId,
            title: updatedSession.title,
            rounds: updatedSession.rounds,
            createdAt: updatedSession.createdAt,
            updatedAt: updatedSession.updatedAt,
            presetId: updatedSession.presetId,
            personas: updatedSession.personas,
            synthesizer: updatedSession.synthesizer,
            customModels: updatedSession.customModels,
            synthesizerModel: updatedSession.synthesizerModel,
            attachedFiles: updatedSession.attachedFiles,
          });
        }
        return {
          ...prev,
          sessions,
        };
      }
    });
  }, [isCloudSyncEnabled, userId]);

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

      const updatedSession: Session = {
        ...targetSession,
        rounds: updatedRounds,
        updatedAt: Date.now(),
        userId: userId || targetSession.userId,
      };
      sessions[activeIndex] = updatedSession;

      if (isCloudSyncEnabled && userId) {
        syncCouncilSession({
          id: updatedSession.id,
          userId,
          title: updatedSession.title,
          rounds: updatedSession.rounds,
          createdAt: updatedSession.createdAt,
          updatedAt: updatedSession.updatedAt,
          presetId: updatedSession.presetId,
          personas: updatedSession.personas,
          synthesizer: updatedSession.synthesizer,
          customModels: updatedSession.customModels,
          synthesizerModel: updatedSession.synthesizerModel,
          attachedFiles: updatedSession.attachedFiles,
        });
      }

      return {
        ...prev,
        sessions,
      };
    });
  }, [isCloudSyncEnabled, userId]);

  const deleteRoundFromActiveSession = useCallback((roundId: string) => {
    setData((prev) => {
      const activeIndex = prev.sessions.findIndex((s) => s.id === prev.activeSessionId);
      if (activeIndex === -1) return prev;

      const sessions = [...prev.sessions];
      const targetSession = sessions[activeIndex];
      const updatedRounds = targetSession.rounds.filter((r) => r.id !== roundId);

      const updatedSession: Session = {
        ...targetSession,
        rounds: updatedRounds,
        updatedAt: Date.now(),
      };
      sessions[activeIndex] = updatedSession;

      if (isCloudSyncEnabled && userId) {
        syncCouncilSession({
          id: updatedSession.id,
          userId,
          title: updatedSession.title,
          rounds: updatedSession.rounds,
          createdAt: updatedSession.createdAt,
          updatedAt: updatedSession.updatedAt,
          presetId: updatedSession.presetId,
          personas: updatedSession.personas,
          synthesizer: updatedSession.synthesizer,
          customModels: updatedSession.customModels,
          synthesizerModel: updatedSession.synthesizerModel,
          attachedFiles: updatedSession.attachedFiles,
        });
      }

      return {
        ...prev,
        sessions,
      };
    });
  }, [isCloudSyncEnabled, userId]);

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

      if (!Array.isArray(parsed)) {
        return { success: false, count: 0, error: 'Invalid schema: imported data must be an array of sessions.' };
      }

      for (const s of parsed) {
        if (!s || typeof s.id !== 'string' || !Array.isArray(s.rounds)) {
          return { success: false, count: 0, error: 'Invalid session schema: every session must have a string id and an array of rounds.' };
        }
      }
      
      importedSessions = parsed;

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
    updateActiveSessionConfig,
    updateActiveSessionFiles,
    deleteRoundFromActiveSession,
    exportSessionsJSON,
    importSessionsJSON,
    syncWithCloud,
    isSyncing,
    lastSyncedAt,
  };
}

export function usePersistRounds(
  rounds: CouncilRound[],
  persist: (rounds: CouncilRound[]) => void,
  delay = 750
) {
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef(rounds);

  latestRef.current = rounds;

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      persist(latestRef.current);
      timerRef.current = null;
    }, delay);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [rounds, persist, delay]);
}
