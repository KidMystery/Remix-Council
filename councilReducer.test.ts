import { describe, it, expect } from 'vitest';
import { councilReducer, CouncilAction } from '../../hooks/useCouncilReducer';
import { CouncilRound } from '../../types';

describe('councilReducer', () => {
  const initialRound: CouncilRound = {
    id: 'round-1',
    userQuery: 'Test Query',
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

  it('handles START_STAGE1 and sets streaming status for personas', () => {
    const action: CouncilAction = {
      type: 'START_STAGE1',
      payload: {
        roundId: 'round-1',
        initialStage1: {
          skeptic: { personaId: 'skeptic', content: '', status: 'streaming' },
          visionary: { personaId: 'visionary', content: '', status: 'streaming' },
        },
      },
    };

    const state = councilReducer([initialRound], action);
    expect(state[0].deliberation?.stage1?.skeptic?.status).toBe('streaming');
    expect(state[0].deliberation?.stage1?.visionary?.status).toBe('streaming');
  });

  it('handles UPDATE_STAGE1_TOKEN', () => {
    const startingState: CouncilRound[] = [
      {
        ...initialRound,
        deliberation: {
          stage1: {
            skeptic: { personaId: 'skeptic', content: 'Hello', status: 'streaming' },
          },
          stage2: {},
        },
      },
    ];

    const action: CouncilAction = {
      type: 'UPDATE_STAGE1_TOKEN',
      payload: {
        roundId: 'round-1',
        personaId: 'skeptic',
        chunk: ' world!',
      },
    };

    const state = councilReducer(startingState, action);
    expect(state[0].deliberation?.stage1?.skeptic?.content).toBe('Hello world!');
    expect(state[0].deliberation?.stage1?.skeptic?.status).toBe('streaming');
  });

  it('handles FINISH_STAGE1_PERSONA with finishReason and metadata persistence', () => {
    const startingState: CouncilRound[] = [
      {
        ...initialRound,
        deliberation: {
          stage1: {
            skeptic: { personaId: 'skeptic', content: 'Initial', status: 'streaming' },
          },
          stage2: {},
        },
      },
    ];

    const action: CouncilAction = {
      type: 'FINISH_STAGE1_PERSONA',
      payload: {
        roundId: 'round-1',
        personaId: 'skeptic',
        content: 'Final comprehensive response',
        model: 'openai/gpt-4o',
        finishReason: 'stop',
        promptTokens: 100,
        completionTokens: 250,
        totalTokens: 350,
      },
    };

    const state = councilReducer(startingState, action);
    const personaResp = state[0].deliberation?.stage1?.skeptic;
    expect(personaResp?.status).toBe('completed');
    expect(personaResp?.content).toBe('Final comprehensive response');
    expect(personaResp?.model).toBe('openai/gpt-4o');
    expect(personaResp?.finishReason).toBe('stop');
    expect(personaResp?.promptTokens).toBe(100);
    expect(personaResp?.completionTokens).toBe(250);
    expect(personaResp?.totalTokens).toBe(350);
  });

  it('handles FINISH_STAGE1_PERSONA truncation flag when finishReason is length', () => {
    const action: CouncilAction = {
      type: 'FINISH_STAGE1_PERSONA',
      payload: {
        roundId: 'round-1',
        personaId: 'visionary',
        content: 'Truncated output...',
        finishReason: 'length',
      },
    };

    const state = councilReducer([initialRound], action);
    const personaResp = state[0].deliberation?.stage1?.visionary;
    expect(personaResp?.finishReason).toBe('length');
    expect(personaResp?.truncated).toBe(true);
  });

  it('handles FINISH_STAGE2_PERSONA with finishReason', () => {
    const action: CouncilAction = {
      type: 'FINISH_STAGE2_PERSONA',
      payload: {
        roundId: 'round-1',
        personaId: 'pragmatist',
        content: 'Peer review critique',
        model: 'anthropic/claude-3.5-haiku',
        finishReason: 'stop',
      },
    };

    const state = councilReducer([initialRound], action);
    const personaResp = state[0].deliberation?.stage2?.pragmatist;
    expect(personaResp?.status).toBe('completed');
    expect(personaResp?.content).toBe('Peer review critique');
    expect(personaResp?.model).toBe('anthropic/claude-3.5-haiku');
    expect(personaResp?.finishReason).toBe('stop');
  });

  it('handles FINISH_SYNTHESIS with finishReason and tokens', () => {
    const action: CouncilAction = {
      type: 'FINISH_SYNTHESIS',
      payload: {
        roundId: 'round-1',
        content: 'Final synthesized consensus',
        model: 'google/gemini-2.5-pro',
        finishReason: 'stop',
        totalTokens: 1200,
      },
    };

    const state = councilReducer([initialRound], action);
    expect(state[0].synthesis?.status).toBe('completed');
    expect(state[0].synthesis?.content).toBe('Final synthesized consensus');
    expect(state[0].synthesis?.model).toBe('google/gemini-2.5-pro');
    expect(state[0].synthesis?.finishReason).toBe('stop');
    expect(state[0].synthesis?.totalTokens).toBe(1200);
  });
});
