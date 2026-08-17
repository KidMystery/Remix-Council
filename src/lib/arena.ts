import { z } from 'zod';

export interface ArenaModelStats {
  modelName: string;
  arenaModelId?: string;
  eloRating: number;
  confidenceInterval: [number, number];
  normalizedScore: number; // 0.0 - 1.0
  percentile?: number;
  rank?: number;
}

export const arenaDatasetSchema = z.object({
  dataset: z.string().default('lmsys/chatbot-arena-leaderboard'),
  models: z.array(z.string()).optional(),
});

// Map of common OpenRouter / API model IDs to Arena model aliases
const MODEL_NAME_ALIASES: Record<string, string[]> = {
  'openai/gpt-4o': ['gpt-4o', 'gpt-4o-2024-05-13', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20'],
  'openai/gpt-4o-mini': ['gpt-4o-mini', 'gpt-4o-mini-2024-07-18'],
  'openai/o1': ['o1', 'o1-2024-12-17'],
  'openai/o3-mini': ['o3-mini', 'o3-mini-high'],
  'anthropic/claude-3.7-sonnet': ['claude-3-7-sonnet-20250219', 'claude-3-7-sonnet', 'claude-3.7-sonnet'],
  'anthropic/claude-3.5-sonnet': ['claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620', 'claude-3.5-sonnet'],
  'anthropic/claude-3.5-haiku': ['claude-3-5-haiku-20241022', 'claude-3-5-haiku'],
  'google/gemini-2.5-flash': ['gemini-2.5-flash', 'gemini-2.0-flash-exp', 'gemini-2.0-flash'],
  'google/gemini-2.5-pro': ['gemini-2.5-pro', 'gemini-2.0-pro-exp-02-05'],
  'google/gemini-3.7-flash': ['gemini-3.7-flash', 'gemini-2.5-flash'],
  'deepseek/deepseek-r1': ['deepseek-r1', 'deepseek-reasoner'],
  'deepseek/deepseek-chat': ['deepseek-v3', 'deepseek-chat'],
  'meta-llama/llama-3.3-70b-instruct': ['llama-3.3-70b-instruct', 'meta-llama-3.3-70b-instruct'],
  'meta-llama/llama-3.1-405b-instruct': ['llama-3.1-405b-instruct', 'meta-llama-3.1-405b-instruct'],
  'qwen/qwen-2.5-72b-instruct': ['qwen2.5-72b-instruct', 'qwen-2.5-72b-instruct'],
};

/**
 * Normalizes Elo ratings into a 0.0 - 1.0 scale with statistical ranking and bounds.
 */
export function normalizeEloScores(models: { modelName: string; eloRating: number; confidenceInterval?: [number, number]; arenaModelId?: string }[]): ArenaModelStats[] {
  if (!models || models.length === 0) return [];

  const validModels = models.filter(m => typeof m.eloRating === 'number' && !isNaN(m.eloRating));
  if (validModels.length === 0) return [];

  const maxElo = Math.max(...validModels.map(m => m.eloRating));
  const minElo = Math.min(...validModels.map(m => m.eloRating));
  const eloRange = maxElo - minElo;

  // Sort descending by rating
  const sorted = [...validModels].sort((a, b) => b.eloRating - a.eloRating);

  return sorted.map((m, index) => {
    let normalizedScore = 0.5;
    if (eloRange > 0) {
      normalizedScore = (m.eloRating - minElo) / eloRange;
    }

    const percentile = sorted.length > 1
      ? Math.round(((sorted.length - 1 - index) / (sorted.length - 1)) * 100)
      : 100;

    const ci: [number, number] = m.confidenceInterval || [
      Math.round(m.eloRating - 12),
      Math.round(m.eloRating + 12),
    ];

    return {
      modelName: m.modelName,
      arenaModelId: m.arenaModelId || m.modelName,
      eloRating: Math.round(m.eloRating),
      confidenceInterval: ci,
      normalizedScore: parseFloat(normalizedScore.toFixed(4)),
      percentile,
      rank: index + 1,
    };
  });
}

// In-memory cache for HF dataset
let cachedArenaStats: ArenaModelStats[] | null = null;
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Fetches and normalizes data from the Arena leaderboard dataset on HuggingFace.
 */
export async function fetchNormalizedArenaStats(targetModels?: string[]): Promise<ArenaModelStats[]> {
  const now = Date.now();
  let baseStats: ArenaModelStats[] = [];

  if (cachedArenaStats && (now - lastFetchTimestamp) < CACHE_TTL_MS) {
    baseStats = cachedArenaStats;
  } else {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      // Attempting to hit HF datasets server for LMSYS leaderboard
      const res = await fetch(
        'https://datasets-server.huggingface.co/rows?dataset=lmsys/chatbot-arena-leaderboard&config=default&split=train&offset=0&length=100',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.rows) && data.rows.length > 0) {
          const parsed = data.rows.map((row: any) => {
            const rawModel = row.row?.model || row.row?.model_name || '';
            const elo = Number(row.row?.elo || row.row?.rating || row.row?.arena_elo || 1150);
            const ciLower = Number(row.row?.ci_lower || elo - 12);
            const ciUpper = Number(row.row?.ci_upper || elo + 12);

            return {
              modelName: rawModel,
              arenaModelId: rawModel,
              eloRating: elo,
              confidenceInterval: [ciLower, ciUpper] as [number, number],
            };
          });

          baseStats = normalizeEloScores(parsed);
          cachedArenaStats = baseStats;
          lastFetchTimestamp = now;
        }
      }
    } catch (err) {
      console.warn('[Arena] Failed to fetch HF dataset rows, using comprehensive baseline leaderboard:', err);
    }
  }

  // If HF fetch returned nothing, use robust baseline benchmark table
  if (baseStats.length === 0) {
    const baseline = [
      { modelName: 'anthropic/claude-3.7-sonnet', arenaModelId: 'claude-3-7-sonnet', eloRating: 1320, confidenceInterval: [1308, 1332] as [number, number] },
      { modelName: 'openai/o1', arenaModelId: 'o1-2024-12-17', eloRating: 1315, confidenceInterval: [1303, 1327] as [number, number] },
      { modelName: 'deepseek/deepseek-r1', arenaModelId: 'deepseek-r1', eloRating: 1302, confidenceInterval: [1290, 1314] as [number, number] },
      { modelName: 'anthropic/claude-3.5-sonnet', arenaModelId: 'claude-3-5-sonnet-20241022', eloRating: 1290, confidenceInterval: [1278, 1302] as [number, number] },
      { modelName: 'openai/gpt-4o', arenaModelId: 'gpt-4o-2024-11-20', eloRating: 1287, confidenceInterval: [1275, 1299] as [number, number] },
      { modelName: 'google/gemini-2.5-pro', arenaModelId: 'gemini-2.5-pro', eloRating: 1280, confidenceInterval: [1268, 1292] as [number, number] },
      { modelName: 'google/gemini-3.7-flash', arenaModelId: 'gemini-3.7-flash', eloRating: 1275, confidenceInterval: [1263, 1287] as [number, number] },
      { modelName: 'google/gemini-2.5-flash', arenaModelId: 'gemini-2.5-flash', eloRating: 1265, confidenceInterval: [1253, 1277] as [number, number] },
      { modelName: 'meta-llama/llama-3.3-70b-instruct', arenaModelId: 'llama-3.3-70b-instruct', eloRating: 1255, confidenceInterval: [1243, 1267] as [number, number] },
      { modelName: 'openai/gpt-4o-mini', arenaModelId: 'gpt-4o-mini-2024-07-18', eloRating: 1242, confidenceInterval: [1230, 1254] as [number, number] },
      { modelName: 'qwen/qwen-2.5-72b-instruct', arenaModelId: 'qwen2.5-72b-instruct', eloRating: 1230, confidenceInterval: [1218, 1242] as [number, number] },
      { modelName: 'deepseek/deepseek-chat', arenaModelId: 'deepseek-v3', eloRating: 1225, confidenceInterval: [1213, 1237] as [number, number] },
      { modelName: 'anthropic/claude-3.5-haiku', arenaModelId: 'claude-3-5-haiku-20241022', eloRating: 1218, confidenceInterval: [1206, 1230] as [number, number] },
      { modelName: 'meta-llama/llama-3.1-70b-instruct', arenaModelId: 'llama-3.1-70b-instruct', eloRating: 1210, confidenceInterval: [1198, 1222] as [number, number] },
    ];
    baseStats = normalizeEloScores(baseline);
  }

  // Filter or match requested target models
  if (targetModels && targetModels.length > 0) {
    const matchedStats: ArenaModelStats[] = [];

    for (const target of targetModels) {
      const directMatch = baseStats.find(
        b => b.modelName.toLowerCase() === target.toLowerCase() ||
             b.arenaModelId?.toLowerCase() === target.toLowerCase()
      );

      if (directMatch) {
        matchedStats.push({ ...directMatch, modelName: target });
        continue;
      }

      // Check alias mapping
      const aliases = MODEL_NAME_ALIASES[target] || [];
      const aliasMatch = baseStats.find(b =>
        aliases.some(alias => b.modelName.toLowerCase().includes(alias.toLowerCase()) || b.arenaModelId?.toLowerCase().includes(alias.toLowerCase()))
      );

      if (aliasMatch) {
        matchedStats.push({ ...aliasMatch, modelName: target });
        continue;
      }

      // Fallback estimate for unranked or custom models
      matchedStats.push({
        modelName: target,
        arenaModelId: target,
        eloRating: 1180,
        confidenceInterval: [1160, 1200],
        normalizedScore: 0.5,
      });
    }

    return normalizeEloScores(matchedStats);
  }

  return baseStats;
}

