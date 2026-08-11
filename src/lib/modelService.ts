import { RawOpenRouterModel, updatePresetsFromFetchedModels } from './presets';
import {
  getCachedModelsWithMetadata,
  setCachedModels,
  RecommendationMetadata,
  STALE_THRESHOLD_MS,
} from './modelCache';
import { mapOpenRouterModels, MappedModels } from './modelMapper';

export interface RefreshRecommendationsOptions {
  force?: boolean;
}

export interface RefreshRecommendationsResult {
  models: RawOpenRouterModel[];
  mapped: MappedModels;
  metadata: RecommendationMetadata;
  fromCache: boolean;
}

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
      const [newestRes, throughputRes, latencyRes] = await Promise.all([
        fetch('/api/council/models?sort=newest', { signal }),
        fetch('/api/council/models?sort=throughput-high-to-low', { signal }),
        fetch('/api/council/models?sort=latency-low-to-high', { signal }),
      ]);

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

      // Never blank existing results on failure!
      if (cachedModels && cachedModels.length > 0) {
        updatePresetsFromFetchedModels(cachedModels);
        const mapped = mapOpenRouterModels(cachedModels);
        return {
          models: cachedModels,
          mapped,
          metadata: {
            updatedAt: cachedMeta.updatedAt,
            lastSuccessfulRefresh: cachedMeta.lastSuccessfulRefresh,
            cacheStatus: 'stale',
            sourceStatus: 'error',
            errorMessage: err.message || 'Unknown network error',
          },
          fromCache: true,
        };
      }

      throw err;
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
