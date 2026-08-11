import { useReducer, useCallback } from 'react';
import { CouncilRound, PersonaId, PersonaResponse } from '../types';

export type CouncilAction =
  | { type: 'SET_ROUNDS'; payload: CouncilRound[] }
  | { type: 'ADD_ROUND'; payload: CouncilRound }
  | { type: 'DELETE_ROUND'; payload: { roundId: string } }
  | { type: 'UPDATE_STAGE1_TOKEN'; payload: { roundId: string; personaId: PersonaId; chunk: string } }
  | { type: 'FINISH_STAGE1_PERSONA'; payload: { roundId: string; personaId: PersonaId; content: string } }
  | { type: 'ERROR_STAGE1_PERSONA'; payload: { roundId: string; personaId: PersonaId; error: string } }
  | { type: 'START_STAGE2'; payload: { roundId: string; initialStage2: Record<PersonaId, PersonaResponse> } }
  | { type: 'UPDATE_STAGE2_TOKEN'; payload: { roundId: string; personaId: PersonaId; chunk: string } }
  | { type: 'FINISH_STAGE2_PERSONA'; payload: { roundId: string; personaId: PersonaId; content: string } }
  | { type: 'ERROR_STAGE2_PERSONA'; payload: { roundId: string; personaId: PersonaId; error: string } }
  | { type: 'START_SYNTHESIS'; payload: { roundId: string } }
  | { type: 'UPDATE_SYNTHESIS_TOKEN'; payload: { roundId: string; chunk: string } }
  | { type: 'FINISH_SYNTHESIS'; payload: { roundId: string } }
  | { type: 'ERROR_SYNTHESIS'; payload: { roundId: string; error: string } };

function councilReducer(state: CouncilRound[], action: CouncilAction): CouncilRound[] {
  switch (action.type) {
    case 'SET_ROUNDS':
      return action.payload;

    case 'ADD_ROUND':
      return [...state, action.payload];

    case 'DELETE_ROUND': {
      return state.filter((r) => r.id !== action.payload.roundId);
    }

    case 'UPDATE_STAGE1_TOKEN': {
      const { roundId, personaId, chunk } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        const existing = r.deliberation?.stage1?.[personaId];
        return {
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [personaId]: {
                ...existing,
                personaId,
                content: (existing?.content || '') + chunk,
                status: 'streaming',
              },
            },
          },
        };
      });
    }

    case 'FINISH_STAGE1_PERSONA': {
      const { roundId, personaId, content } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        const existing = r.deliberation?.stage1?.[personaId];
        return {
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [personaId]: { ...existing, personaId, content, status: 'completed' },
            },
          },
        };
      });
    }

    case 'ERROR_STAGE1_PERSONA': {
      const { roundId, personaId, error } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        const existing = r.deliberation?.stage1?.[personaId];
        return {
          ...r,
          deliberation: {
            ...r.deliberation,
            stage1: {
              ...r.deliberation?.stage1,
              [personaId]: {
                ...existing,
                personaId,
                status: 'error',
                error,
              },
            },
          },
        };
      });
    }

    case 'START_STAGE2': {
      const { roundId, initialStage2 } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: initialStage2,
          },
        };
      });
    }

    case 'UPDATE_STAGE2_TOKEN': {
      const { roundId, personaId, chunk } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        const existing = r.deliberation?.stage2?.[personaId];
        return {
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [personaId]: {
                ...existing,
                personaId,
                content: (existing?.content || '') + chunk,
                status: 'streaming',
              },
            },
          },
        };
      });
    }

    case 'FINISH_STAGE2_PERSONA': {
      const { roundId, personaId, content } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        const existing = r.deliberation?.stage2?.[personaId];
        return {
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [personaId]: { ...existing, personaId, content, status: 'completed' },
            },
          },
        };
      });
    }

    case 'ERROR_STAGE2_PERSONA': {
      const { roundId, personaId, error } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        const existing = r.deliberation?.stage2?.[personaId];
        return {
          ...r,
          deliberation: {
            ...r.deliberation,
            stage2: {
              ...r.deliberation?.stage2,
              [personaId]: {
                ...existing,
                personaId,
                status: 'error',
                error,
              },
            },
          },
        };
      });
    }

    case 'START_SYNTHESIS': {
      const { roundId } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          synthesis: { content: '', status: 'streaming' },
        };
      });
    }

    case 'UPDATE_SYNTHESIS_TOKEN': {
      const { roundId, chunk } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          synthesis: {
            ...r.synthesis,
            content: (r.synthesis?.content || '') + chunk,
          },
        };
      });
    }

    case 'FINISH_SYNTHESIS': {
      const { roundId } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          synthesis: { ...r.synthesis, status: 'completed' },
        };
      });
    }

    case 'ERROR_SYNTHESIS': {
      const { roundId, error } = action.payload;
      return state.map((r) => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          synthesis: { ...r.synthesis, status: 'error', error },
        };
      });
    }

    default:
      return state;
  }
}

export function useCouncilReducer(initialRounds: CouncilRound[] = []) {
  const [rounds, dispatch] = useReducer(councilReducer, initialRounds);

  const setRounds = useCallback((roundsList: CouncilRound[]) => {
    dispatch({ type: 'SET_ROUNDS', payload: roundsList });
  }, []);

  return { rounds, dispatch, setRounds };
}
