import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  calculateCallCost,
  formatCost,
  countTotalSessionCost,
  countRoundCost,
} from '../archivist';
import { CouncilRound } from '../../types';

describe('Archivist utility tests', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty string or nullish input', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(null as any)).toBe(0);
    });

    it('estimates tokens proportionally based on character count', () => {
      const shortText = 'Hello world!';
      const tokens = estimateTokens(shortText);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(Math.ceil(shortText.length / 4));
    });

    it('estimates larger text accurately', () => {
      const longText = 'a'.repeat(400);
      expect(estimateTokens(longText)).toBe(100);
    });
  });

  describe('calculateCallCost', () => {
    it('calculates free models as $0.00', () => {
      expect(calculateCallCost(1000, 500, 'google/gemini-2.0-flash-exp:free')).toBe(0);
      expect(calculateCallCost(5000, 2000, 'deepseek/deepseek-r1:free')).toBe(0);
    });

    it('calculates cost for known paid models', () => {
      const cost = calculateCallCost(1000000, 1000000, 'anthropic/claude-3.5-sonnet');
      expect(cost).toBeGreaterThan(0);
    });

    it('handles unknown models with fallback pricing', () => {
      const cost = calculateCallCost(1000, 500, 'custom/unknown-model');
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatCost', () => {
    it('formats $0 cost clearly', () => {
      expect(formatCost(0)).toBe('$0.0000');
    });

    it('formats micro-costs with appropriate precision', () => {
      expect(formatCost(0.00045)).toBe('$0.0004');
      expect(formatCost(0.1234)).toBe('$0.1234');
      expect(formatCost(1.50)).toBe('$1.5000');
    });
  });

  describe('countRoundCost and countTotalSessionCost', () => {
    const mockRound: CouncilRound = {
      id: 'round-1',
      userQuery: 'Test question',
      timestamp: Date.now(),
      synthesis: {
        content: 'Summary synthesis content',
        status: 'completed',
        model: 'google/gemini-2.5-pro',
      },
      deliberation: {
        stage1: {
          skeptic: { personaId: 'skeptic', content: 'Test response content for skeptic', status: 'completed', model: 'google/gemini-2.5-flash' },
        },
        stage2: {},
      },
    };

    it('calculates round cost correctly', () => {
      const metrics = countRoundCost(mockRound);
      expect(metrics.totalTokens).toBeGreaterThan(0);
      expect(metrics.totalCost).toBeGreaterThanOrEqual(0);
    });

    it('calculates session total cost across multiple rounds', () => {
      const rounds = [
        mockRound,
        {
          ...mockRound,
          id: 'round-2',
        },
      ];
      const sessionMetrics = countTotalSessionCost(rounds);
      expect(sessionMetrics.totalTokens).toBeGreaterThan(countRoundCost(mockRound).totalTokens);
    });
  });
});
