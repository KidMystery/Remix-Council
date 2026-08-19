import { useState, useEffect, useCallback, useRef } from 'react';
import {
  refreshModelRecommendations,
  RefreshRecommendationsResult,
} from '../lib/modelService';
import {
  getCachedModelsWithMetadata,
  RecommendationMetadata,
  formatUpdateTime,
  formatErrorTime,
  STALE_THRESHOLD_MS,
} from '../lib/modelCache';
import { cleanModelName, updatePresetsFromFetchedModels } from '../lib/presets';

export interface ModelOption {
  id: string;
  name: string;
}

export function useModelRecommendations() {
  const [metadata, setMetadata] = useState<RecommendationMetadata>(() => {
    return getCachedModelsWithMetadata().metadata;
  });

  const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
    const cached = getCachedModelsWithMetadata().models;
    if (cached && cached.length > 0) {
      return cached.map((m) => ({
        id: m.id,
        name: cleanModelName(m.id, m.name),
      }));
    }
    // Fallback default models if no cache exists
    return [
      { id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/o3-mini', name: 'o3 Mini' },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
    ];
  });

  const [rawModelsCatalog, setRawModelsCatalog] = useState<any[]>(() => {
    return getCachedModelsWithMetadata().models || [];
  });

  const [presetWarnings, setPresetWarnings] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDebounced, setIsDebounced] = useState(false);
  const lastForcedRefreshRef = useRef<number>(0);
  const debounceTimerRef = useRef<number | null>(null);

  const handleRefresh = useCallback(async (options?: { force?: boolean }): Promise<RefreshRecommendationsResult | null> => {
    const force = options?.force ?? false;

    // Enforce 5 second click debounce lock for manual forced refreshes
    if (force) {
      const now = Date.now();
      if (now - lastForcedRefreshRef.current < 5000) {
        console.log('Refresh debounced — please wait 5s between manual refreshes');
        return null;
      }
      lastForcedRefreshRef.current = now;
      setIsDebounced(true);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        setIsDebounced(false);
        debounceTimerRef.current = null;
      }, 5000);
    }

    setIsRefreshing(true);
    setMetadata((prev) => ({
      ...prev,
      sourceStatus: 'loading',
      cacheStatus: force ? 'stale' : prev.cacheStatus,
    }));

    try {
      const result: RefreshRecommendationsResult = await refreshModelRecommendations({ force });

      // Update preset assignments
      updatePresetsFromFetchedModels(result.models);
      setPresetWarnings(result.mapped.warnings || []);

      const newAvailable = result.models.map((m) => ({
        id: m.id,
        name: cleanModelName(m.id, m.name),
      }));

      setRawModelsCatalog(result.models);
      setAvailableModels(newAvailable);
      setMetadata(result.metadata);
      return result;
    } catch (e: any) {
      console.error('Failed to refresh model recommendations:', e);
      setMetadata((prev) => ({
        ...prev,
        sourceStatus: 'error',
        errorMessage: e.message || 'Refresh failed',
      }));
      return null;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // App load behavior:
  // - Show cached recommendations immediately if available (already set in initial state)
  // - Refresh in background if stale (> 15 min since last check)
  useEffect(() => {
    const initialCache = getCachedModelsWithMetadata();
    const age = Date.now() - initialCache.metadata.updatedAt;

    if (!initialCache.models || age >= STALE_THRESHOLD_MS) {
      // Background silent refresh
      handleRefresh({ force: false });
    } else {
      // Re-hydrate presets from cache
      updatePresetsFromFetchedModels(initialCache.models);
    }
  }, [handleRefresh]);

  // Periodic background refresh check: every 15 minutes (900,000 ms)
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('15-minute background model recommendations check running...');
      handleRefresh({ force: false });
    }, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [handleRefresh]);

  return {
    metadata,
    availableModels,
    rawModelsCatalog,
    presetWarnings,
    isRefreshing,
    isDebounced,
    refreshModelRecommendations: handleRefresh,
    formatUpdateTime,
    formatErrorTime,
  };
}
