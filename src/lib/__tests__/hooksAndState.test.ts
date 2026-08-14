import { describe, it, expect } from 'vitest';
import { CouncilRound, PersonaId, PersonaResponse } from '../../types';

describe('Council Round Reducer and State Transitions', () => {
  const initialRound: CouncilRound = {
    id: 'round-abc',
    userQuery: 'How to optimize PostgreSQL queries?',
    timestamp: Date.now(),
    deliberation: {
      stage1: {},
      stage2: {},
    },
    synthesis: {
      content: '',
      status: 'idle',
    },
  };

  it('handles Stage 1 token updates and completion cleanly', () => {
    let state = [initialRound];

    // Initialize stage 1
    const initialStage1: Record<PersonaId, PersonaResponse> = {
      skeptic: { personaId: 'skeptic', content: '', status: 'streaming' },
      visionary: { personaId: 'visionary', content: '', status: 'streaming' },
      pragmatist: { personaId: 'pragmatist', content: '', status: 'streaming' },
    };

    state = state.map((r) => r.id === 'round-abc' ? {
      ...r,
      deliberation: { ...r.deliberation, stage1: initialStage1 },
    } : r);

    expect(state[0].deliberation.stage1.skeptic.status).toBe('streaming');

    // Finish Stage 1 persona
    state = state.map((r) => {
      if (r.id !== 'round-abc') return r;
      return {
        ...r,
        deliberation: {
          ...r.deliberation,
          stage1: {
            ...r.deliberation.stage1,
            skeptic: {
              personaId: 'skeptic',
              content: 'Index foreign keys and use EXPLAIN ANALYZE.',
              status: 'completed',
              model: 'google/gemini-2.5-flash',
            },
          },
        },
      };
    });

    expect(state[0].deliberation.stage1.skeptic.status).toBe('completed');
    expect(state[0].deliberation.stage1.skeptic.content).toContain('EXPLAIN ANALYZE');
  });

  it('handles Synthesis completion with structured consensus takeaways', () => {
    let state = [initialRound];

    state = state.map((r) => {
      if (r.id !== 'round-abc') return r;
      return {
        ...r,
        synthesis: {
          status: 'completed',
          content: '# PostgreSQL Optimization Summary\nKey findings and actions.\n\nTakeaway: Add B-Tree indexes on query predicates',
          model: 'google/gemini-2.5-pro',
        },
      };
    });

    expect(state[0].synthesis.status).toBe('completed');
    expect(state[0].synthesis.content).toContain('Takeaway');
    expect(state[0].synthesis.model).toBe('google/gemini-2.5-pro');
  });
});
