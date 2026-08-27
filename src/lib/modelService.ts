import { authenticatedFetch } from "./apiClient";
import { RawOpenRouterModel, updatePresetsFromFetchedModels } from './presets';
import {
  getCachedModelsWithMetadata,
  setCachedModels,
  RecommendationMetadata,
  STALE_THRESHOLD_MS,
} from './modelCache';
import { mapOpenRouterModels, MappedModels } from './modelMapper';
import { retryWithExponentialBackoff, isTransientError } from './retryUtils';

export interface RefreshRecommendationsOptions {
  force?: boolean;
}

export interface RefreshRecommendationsResult {
  models: RawOpenRouterModel[];
  mapped: MappedModels;
  metadata: RecommendationMetadata;
  fromCache: boolean;
}

export const FALLBACK_SEED_MODELS: RawOpenRouterModel[] = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', pricing: { prompt: '0.00000015', completion: '0.0000006' }, context_length: 1048576 },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', pricing: { prompt: '0.00000125', completion: '0.000005' }, context_length: 1048576 },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', pricing: { prompt: '0.00000025', completion: '0.000001' }, context_length: 1048576 },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 200000 },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 200000 },
  { id: 'openai/gpt-5.1', name: 'GPT-5.1', pricing: { prompt: '0.000005', completion: '0.000015' }, context_length: 128000 },
  { id: 'openai/gpt-4o', name: 'GPT-4o', pricing: { prompt: '0.0000025', completion: '0.00001' }, context_length: 128000 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', pricing: { prompt: '0.00000015', completion: '0.0000006' }, context_length: 128000 },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', pricing: { prompt: '0.00000055', completion: '0.00000219' }, context_length: 64000 },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 Chat', pricing: { prompt: '0.00000014', completion: '0.00000028' }, context_length: 64000 },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', pricing: { prompt: '0.00000013', completion: '0.0000004' }, context_length: 131072 },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra (Free)', pricing: { prompt: '0', completion: '0' }, context_length: 32768 },
  { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (Free)', pricing: { prompt: '0', completion: '0' }, context_length: 32768 },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Free)', pricing: { prompt: '0', completion: '0' }, context_length: 32768 },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen 3 Next 80B (Free)', pricing: { prompt: '0', completion: '0' }, context_length: 32768 },
];

let activeAbortController: AbortController | null = null;
let currentRefreshPromise: Promise<RefreshRecommendationsResult> | null = null;

/**
 * Refreshes model recommendations from OpenRouter API or cache.
 * - App load: Shows cached recommendations immediately if available; refreshes in background if stale (> 15 min).
 * - Manual refresh (force: true): Forces new server-side OpenRouter request, re-fetches all ranking lists in parallel,
 *   recalculates all four council presets, bypasses model-list cache, and preserves conversation history/settings.
 * - Prevents duplicate concurrent refreshes and uses AbortController to cancel stale requests.
 * - Never blanks existing results on failure.
 */
export async function refreshModelRecommendations(
  options: RefreshRecommendationsOptions = {}
): Promise<RefreshRecommendationsResult> {
  const { force = false } = options;

  // Prevent duplicate concurrent refreshes if a call with the same force mode is already running
  if (currentRefreshPromise && !force) {
    return currentRefreshPromise;
  }

  // Cancel any stale in-flight request if forcing a fresh refresh
  if (force && activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    currentRefreshPromise = null;
  }

  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  const { models: cachedModels, metadata: cachedMeta } = getCachedModelsWithMetadata();
  const now = Date.now();
  const age = now - (cachedMeta.updatedAt || 0);
  const isStale = age >= STALE_THRESHOLD_MS;

  // App load / non-forced check: return cached immediately if fresh (< 15 min)
  if (!force && cachedModels && cachedModels.length > 0 && !isStale) {
    updatePresetsFromFetchedModels(cachedModels);
    const mapped = mapOpenRouterModels(cachedModels);
    return {
      models: cachedModels,
      mapped,
      metadata: {
        ...cachedMeta,
        cacheStatus: 'fresh',
        sourceStatus: 'idle',
      },
      fromCache: true,
    };
  }

  // Execute network request
  const refreshPromise = (async (): Promise<RefreshRecommendationsResult> => {
    try {
      const [newestRes, throughputRes, latencyRes] = await retryWithExponentialBackoff(
        async () => {
          const [nRes, tRes, lRes] = await Promise.all([
            authenticatedFetch('/api/council/models?sort=newest', { signal }),
            authenticatedFetch('/api/council/models?sort=throughput-high-to-low', { signal }),
            authenticatedFetch('/api/council/models?sort=latency-low-to-high', { signal }),
          ]);

          if (!nRes.ok && isTransientError({ status: nRes.status })) {
            throw Object.assign(new Error(`OpenRouter API responded with status ${nRes.status}`), { status: nRes.status });
          }
          return [nRes, tRes, lRes];
        },
        {
          maxRetries: 2,
          initialDelayMs: 1000,
          maxDelayMs: 4000,
          signal,
          retryIf: isTransientError,
        }
      );

      if (!newestRes.ok) {
        throw new Error(`OpenRouter API responded with status ${newestRes.status}`);
      }

      const newestData = await newestRes.json();
      const throughputData = throughputRes.ok ? await throughputRes.json() : { data: [] };
      const latencyData = latencyRes.ok ? await latencyRes.json() : { data: [] };

      if (newestData && newestData.data && Array.isArray(newestData.data)) {
        const rawModels: RawOpenRouterModel[] = newestData.data;

        const throughputOrder: string[] = (throughputData.data || []).map((m: any) => m.id);
        const latencyOrder: string[] = (latencyData.data || []).map((m: any) => m.id);

        rawModels.forEach((m: any) => {
          const tIndex = throughputOrder.indexOf(m.id);
          const lIndex = latencyOrder.indexOf(m.id);
          m._throughput_rank = tIndex !== -1 ? tIndex : throughputOrder.length;
          m._latency_rank = lIndex !== -1 ? lIndex : latencyOrder.length;
        });

        // Recalculate all four council presets and update cache
        updatePresetsFromFetchedModels(rawModels);
        const newMeta = setCachedModels(rawModels);
        const mapped = mapOpenRouterModels(rawModels);

        return {
          models: rawModels,
          mapped,
          metadata: newMeta,
          fromCache: false,
        };
      } else {
        throw new Error('Invalid response format from OpenRouter API');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw err;
      }

      console.warn('refreshModelRecommendations failed:', err.message || err);

      // Gracefully fall back to cached models or predefined seed models
      const fallbackList: RawOpenRouterModel[] =
        cachedModels && cachedModels.length > 0 ? cachedModels : FALLBACK_SEED_MODELS;

      updatePresetsFromFetchedModels(fallbackList);
      const mapped = mapOpenRouterModels(fallbackList);
      return {
        models: fallbackList,
        mapped,
        metadata: {
          updatedAt: cachedMeta.updatedAt || Date.now(),
          lastSuccessfulRefresh: cachedMeta.lastSuccessfulRefresh,
          cacheStatus: 'stale',
          sourceStatus: 'error',
          errorMessage: err.message || 'Unknown network error',
        },
        fromCache: true,
      };
    } finally {
      currentRefreshPromise = null;
      activeAbortController = null;
    }
  })();

  currentRefreshPromise = refreshPromise;
  return refreshPromise;
}

/**
 * Backward compatibility wrapper around refreshModelRecommendations.
 */
export async function fetchAndProcessModels(
  forceRefresh = false
): Promise<{ models: RawOpenRouterModel[]; mapped: MappedModels }> {
  const result = await refreshModelRecommendations({ force: forceRefresh });
  return {
    models: result.models,
    mapped: result.mapped,
  };
}
