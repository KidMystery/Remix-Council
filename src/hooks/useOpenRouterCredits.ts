import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '../lib/apiClient';

export interface CreditsInfo {
  usage: number;
  limit: number | null;
  remaining: number | null;
  loading: boolean;
  error: string | null;
  isDirectKey: boolean;
}

/**
 * Fetches the OpenRouter account balance (usage vs. limit) from the server-side
 * proxy, so the API key itself never touches the client.
 */
export function useOpenRouterCredits(pollMs: number = 5 * 60 * 1000) {
  const [credits, setCredits] = useState<CreditsInfo>({
    usage: 0,
    limit: null,
    remaining: null,
    loading: true,
    error: null,
    isDirectKey: false,
  });
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setCredits((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await authenticatedFetch('/api/council/account');
      if (!res.ok) {
        setCredits((prev) => ({
          ...prev,
          loading: false,
          error: `HTTP ${res.status}`,
        }));
        return;
      }
      const data = await res.json();
      const inner = data?.data;
      // Tolerate numbers arriving as strings ("10.05") from the proxy.
      const toNum = (v: unknown): number | null => {
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && v.trim() !== '') {
          const n = parseFloat(v);
          if (Number.isFinite(n)) return n;
        }
        return null;
      };
      const usage = toNum(inner?.usage) ?? 0;
      const rawLimit = toNum(inner?.limit);
      const limit = rawLimit !== null && rawLimit > 0 ? rawLimit : null;
      const reportedRemaining = toNum(inner?.remaining);
      const remaining =
        reportedRemaining !== null
          ? Math.max(0, reportedRemaining)
          : limit !== null
            ? Math.max(0, limit - usage)
            : null;
      if (mountedRef.current) {
        setCredits({
          usage,
          limit,
          remaining,
          loading: false,
          error: null,
          isDirectKey: Boolean(inner?.isDirectKey),
        });
      }
    } catch (err: any) {
      if (mountedRef.current) {
        setCredits((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || String(err),
        }));
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const interval = setInterval(refresh, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh, pollMs]);

  return { credits, refresh };
}
