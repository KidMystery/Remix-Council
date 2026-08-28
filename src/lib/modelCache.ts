import { RawOpenRouterModel } from './presets';

const CACHE_KEY = 'openrouter_models_cache_v2';
const LEGACY_CACHE_KEY = 'openrouter_models_cache';
export const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
export const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export type CacheStatus = 'fresh' | 'stale' | 'cached';
export type SourceStatus = 'idle' | 'loading' | 'success' | 'error';

export interface RecommendationMetadata {
  updatedAt: number; // timestamp when models were saved
  lastSuccessfulRefresh: number | null; // timestamp of last successful OpenRouter response
  cacheStatus: CacheStatus;
  sourceStatus: SourceStatus;
  errorMessage?: string;
}

export interface CacheData {
  timestamp: number;
  lastSuccessfulRefresh: number;
  models: RawOpenRouterModel[];
}

/**
 * In-memory fallback cache to ensure synchronous, zero-quota-risk model access
 * throughout the runtime session.
 */
let inMemoryCache: CacheData | null = null;

/**
 * Strips verbose documentation, lengthy descriptions, and unneeded raw metadata
 * to shrink each model object from ~10KB down to ~150 bytes (a >95% reduction).
 */
export function pruneModelForCache(m: RawOpenRouterModel): RawOpenRouterModel {
  if (!m || !m.id) return m;

  const pruned: RawOpenRouterModel = {
    id: m.id,
    name: m.name || m.id,
  };

  if (m.pricing) {
    pruned.pricing = {
      prompt: m.pricing.prompt,
      completion: m.pricing.completion,
      request: m.pricing.request,
    };
  }

  if (typeof m.context_length === 'number') {
    pruned.context_length = m.context_length;
  }

  if (typeof m.created === 'number') {
    pruned.created = m.created;
  }

  if (m.benchmarks) {
    pruned.benchmarks = {
      intelligence: m.benchmarks.intelligence,
      arena_elo: m.benchmarks.arena_elo,
      elo: m.benchmarks.elo,
      coding: m.benchmarks.coding,
      agentic: m.benchmarks.agentic,
    };
  }

  if (m.architecture) {
    pruned.architecture = {
      ...(typeof m.architecture.modality === 'string' ? { modality: m.architecture.modality } : {}),
      ...(Array.isArray((m.architecture as any).input_modalities)
        ? { input_modalities: (m.architecture as any).input_modalities }
        : {}),
    } as any;
  }

  if (m.top_provider?.context_length) {
    pruned.top_provider = {
      context_length: m.top_provider.context_length,
    };
  }

  if ((m as any)._throughput_rank !== undefined) {
    (pruned as any)._throughput_rank = (m as any)._throughput_rank;
  }

  if ((m as any)._latency_rank !== undefined) {
    (pruned as any)._latency_rank = (m as any)._latency_rank;
  }

  return pruned;
}

export function getCachedModelsWithMetadata(): {
  models: RawOpenRouterModel[] | null;
  metadata: RecommendationMetadata;
} {
  const defaultMeta: RecommendationMetadata = {
    updatedAt: 0,
    lastSuccessfulRefresh: null,
    cacheStatus: 'stale',
    sourceStatus: 'idle',
  };

  const evaluateCache = (cached: CacheData): {
    models: RawOpenRouterModel[];
    metadata: RecommendationMetadata;
  } => {
    const now = Date.now();
    const age = now - (cached.timestamp || 0);

    let cacheStatus: CacheStatus = 'cached';
    if (age >= CACHE_TTL_MS || age >= STALE_THRESHOLD_MS) {
      cacheStatus = 'stale';
    } else {
      cacheStatus = 'fresh';
    }

    return {
      models: cached.models,
      metadata: {
        updatedAt: cached.timestamp || 0,
        lastSuccessfulRefresh: cached.lastSuccessfulRefresh || cached.timestamp || null,
        cacheStatus,
        sourceStatus: 'idle',
      },
    };
  };

  // 1. Check in-memory cache first
  if (inMemoryCache && Array.isArray(inMemoryCache.models) && inMemoryCache.models.length > 0) {
    return evaluateCache(inMemoryCache);
  }

  if (typeof localStorage === 'undefined') {
    return { models: null, metadata: defaultMeta };
  }

  let cachedStr: string | null = null;
  try {
    cachedStr = localStorage.getItem(CACHE_KEY);
    if (!cachedStr) {
      cachedStr = localStorage.getItem(LEGACY_CACHE_KEY);
    }
  } catch {
    return { models: null, metadata: defaultMeta };
  }

  if (!cachedStr) {
    return { models: null, metadata: defaultMeta };
  }

  try {
    const cached: CacheData = JSON.parse(cachedStr);
    if (!cached.models || !Array.isArray(cached.models) || cached.models.length === 0) {
      return { models: null, metadata: defaultMeta };
    }

    inMemoryCache = cached;
    return evaluateCache(cached);
  } catch (e) {
    console.warn('Failed to parse model cache from storage:', e);
    return { models: null, metadata: defaultMeta };
  }
}

export function getCachedModels(): RawOpenRouterModel[] | null {
  return getCachedModelsWithMetadata().models;
}

export function setCachedModels(models: RawOpenRouterModel[]): RecommendationMetadata {
  const now = Date.now();
  const prunedModels = Array.isArray(models) ? models.map(pruneModelForCache) : [];

  const data: CacheData = {
    timestamp: now,
    lastSuccessfulRefresh: now,
    models: prunedModels,
  };

  // Keep in-memory cache updated immediately
  inMemoryCache = data;

  if (typeof localStorage !== 'undefined') {
    try {
      // Remove legacy large key to reclaim quota
      localStorage.removeItem(LEGACY_CACHE_KEY);
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      // Attempt quota recovery: try storing top 100 models if full catalog exceeds remaining storage
      try {
        const compactData: CacheData = {
          timestamp: now,
          lastSuccessfulRefresh: now,
          models: prunedModels.slice(0, 100),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(compactData));
      } catch (innerErr) {
        // Safe degrade: in-memory cache remains active for the current session
        console.warn('Model cache localStorage write skipped due to quota limits; using in-memory store.');
      }
    }
  }

  return {
    updatedAt: now,
    lastSuccessfulRefresh: now,
    cacheStatus: 'fresh',
    sourceStatus: 'success',
  };
}

export function formatUpdateTime(timestamp: number): string {
  if (!timestamp) return 'Never updated';
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Updated just now';
  if (diffMins < 60) return `Updated ${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  if (diffHours < 24) return `Updated ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;

  const dateObj = new Date(timestamp);
  return `Updated ${dateObj.toLocaleDateString()}`;
}

export function formatErrorTime(timestamp: number): string {
  if (!timestamp) return 'showing initial defaults';
  const dateObj = new Date(timestamp);
  const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `showing cached data from ${timeStr}`;
}

