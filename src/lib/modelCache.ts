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

  if (typeof localStorage === 'undefined') {
    return { models: null, metadata: defaultMeta };
  }

  let cachedStr = localStorage.getItem(CACHE_KEY);
  if (!cachedStr) {
    // Try legacy key
    cachedStr = localStorage.getItem(LEGACY_CACHE_KEY);
  }

  if (!cachedStr) {
    return { models: null, metadata: defaultMeta };
  }

  try {
    const cached: CacheData = JSON.parse(cachedStr);
    if (!cached.models || !Array.isArray(cached.models) || cached.models.length === 0) {
      return { models: null, metadata: defaultMeta };
    }

    const now = Date.now();
    const age = now - (cached.timestamp || 0);

    let cacheStatus: CacheStatus = 'cached';
    if (age >= CACHE_TTL_MS) {
      cacheStatus = 'stale';
    } else if (age >= STALE_THRESHOLD_MS) {
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
  } catch (e) {
    console.error('Failed to parse model cache:', e);
    return { models: null, metadata: defaultMeta };
  }
}

export function getCachedModels(): RawOpenRouterModel[] | null {
  return getCachedModelsWithMetadata().models;
}

export function setCachedModels(models: RawOpenRouterModel[]): RecommendationMetadata {
  const now = Date.now();
  const data: CacheData = {
    timestamp: now,
    lastSuccessfulRefresh: now,
    models,
  };

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to write model cache to localStorage:', e);
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
