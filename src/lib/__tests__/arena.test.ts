import { describe, it, expect, vi } from 'vitest';
import { normalizeEloScores, fetchNormalizedArenaStats } from '../arena';

describe('Arena.ai HuggingFace dataset integration & normalization layer', () => {
  it('normalizes Elo scores correctly into 0.0 - 1.0 range and assigns percentiles & ranks', () => {
    const sampleModels = [
      { modelName: 'anthropic/claude-3.7-sonnet', eloRating: 1320 },
      { modelName: 'openai/gpt-4o', eloRating: 1280 },
      { modelName: 'google/gemini-2.5-flash', eloRating: 1240 },
    ];

    const normalized = normalizeEloScores(sampleModels);

    expect(normalized).toHaveLength(3);
    // Highest rating gets 1.0
    expect(normalized[0].modelName).toBe('anthropic/claude-3.7-sonnet');
    expect(normalized[0].normalizedScore).toBe(1.0);
    expect(normalized[0].rank).toBe(1);
    expect(normalized[0].percentile).toBe(100);

    // Lowest rating gets 0.0
    expect(normalized[2].modelName).toBe('google/gemini-2.5-flash');
    expect(normalized[2].normalizedScore).toBe(0.0);
    expect(normalized[2].rank).toBe(3);
    expect(normalized[2].percentile).toBe(0);

    // Middle rating gets 0.5 (1280 is midway between 1240 and 1320)
    expect(normalized[1].normalizedScore).toBe(0.5);
    expect(normalized[1].confidenceInterval).toHaveLength(2);
  });

  it('handles empty input gracefully', () => {
    expect(normalizeEloScores([])).toEqual([]);
  });

  it('handles single model normalization by defaulting to 0.5', () => {
    const result = normalizeEloScores([{ modelName: 'deepseek/deepseek-r1', eloRating: 1300 }]);
    expect(result).toHaveLength(1);
    expect(result[0].normalizedScore).toBe(0.5);
    expect(result[0].rank).toBe(1);
  });

  it('fetches normalized Arena statistics and handles target model filtering with aliases', async () => {
    const stats = await fetchNormalizedArenaStats(['openai/gpt-4o', 'anthropic/claude-3.7-sonnet']);

    expect(stats.length).toBeGreaterThanOrEqual(2);
    const gpt4o = stats.find(s => s.modelName === 'openai/gpt-4o');
    const claude = stats.find(s => s.modelName === 'anthropic/claude-3.7-sonnet');

    expect(gpt4o).toBeDefined();
    expect(claude).toBeDefined();
    expect(gpt4o?.eloRating).toBeGreaterThan(1200);
    expect(claude?.eloRating).toBeGreaterThan(1200);
  });

  it('returns full baseline leaderboard when no target models are specified', async () => {
    const fullLeaderboard = await fetchNormalizedArenaStats();
    expect(fullLeaderboard.length).toBeGreaterThan(5);
    expect(fullLeaderboard[0].rank).toBe(1);
    expect(fullLeaderboard[0].normalizedScore).toBe(1.0);
  });
});
