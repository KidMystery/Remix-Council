import { useState, useEffect, useCallback } from 'react';
import { Session, CouncilRound } from '../types';
import { summarizeTitle } from '../lib/titleUtils';

const STORAGE_KEY = 'council-sessions-v2';

interface StoredData {
  sessions: Session[];
  activeSessionId: string | null;
}

export function useSessionManager() {
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

  // Save to localStorage whenever data changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save council sessions to localStorage', e);
    }
  }, [data]);

  const activeSession = data.sessions.find((s) => s.id === data.activeSessionId);

  const createNewSession = useCallback((initialTitle?: string): Session => {
    const newSession: Session = {
      id: `session-${Date.now()}`,
      title: initialTitle || 'New Deliberation',
      rounds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setData((prev) => ({
      sessions: [newSession, ...prev.sessions],
      activeSessionId: newSession.id,
    }));

    return newSession;
  }, []);

  const selectSession = useCallback((id: string) => {
    setData((prev) => ({
      ...prev,
      activeSessionId: id,
    }));
  }, []);

  const deleteSession = useCallback((id: string) => {
    setData((prev) => {
      const nextSessions = prev.sessions.filter((s) => s.id !== id);
      const nextActiveId = prev.activeSessionId === id
        ? (nextSessions[0]?.id ?? null)
        : prev.activeSessionId;
      return {
        sessions: nextSessions,
        activeSessionId: nextActiveId,
      };
    });
  }, []);

  const clearSessionHistory = useCallback((sessionId?: string) => {
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

      return {
        ...prev,
        sessions,
      };
    });
  }, []);

  const clearAllSessions = useCallback(() => {
    setData({
      sessions: [],
      activeSessionId: null,
    });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const addRoundToActiveSession = useCallback((round: CouncilRound) => {
    setData((prev) => {
      let activeId = prev.activeSessionId;
      let sessions = [...prev.sessions];
      let activeIndex = sessions.findIndex((s) => s.id === activeId);

      if (activeIndex === -1) {
        // Create a new session automatically if none is active
        const newSession: Session = {
          id: `session-${Date.now()}`,
          title: summarizeTitle(round.userQuery),
          rounds: [round],
          createdAt: Date.now(),
          updatedAt: Date.now(),
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
  }, []);

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
  };
}
