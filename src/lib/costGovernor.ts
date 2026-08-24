/**
 * Server-side cost governor — the money backstop.
 *
 * The Chamber already stops a round client-side when its cost estimate trips
 * the per-round ceiling, but that check lives in the browser bundle. This
 * module lets the server accumulate REAL per-token usage per round (from
 * OpenRouter's `usage` on the final stream chunk) and refuse any further
 * calls for a round that has already spent its ceiling — even if the client
 * is buggy, cached, or a stale build.
 */

export interface UsageStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelRatesUSD {
  promptPerM: number;
  completionPerM: number;
}

/**
 * Per-million-token USD rates for a model, looked up in the live catalog.
 * OpenRouter catalog pricing is USD PER TOKEN (e.g. "0.0000003" = $0.30/1M),
 * so the raw values are converted to per-million here.
 */
export function modelRatesUSD(
  catalog: any[] | null | undefined,
  modelId: string
): ModelRatesUSD {
  const entry = Array.isArray(catalog)
    ? catalog.find((m) => String(m?.id || '').toLowerCase() === modelId.toLowerCase())
    : undefined;
  const promptPerM = (Number(entry?.pricing?.prompt) || 0) * 1_000_000;
  const completionPerM = (Number(entry?.pricing?.completion) || 0) * 1_000_000;
  return { promptPerM, completionPerM };
}

/** Exact cost of a usage stat at the given per-million rates. */
export function usageCostUSD(usage: UsageStats | null | undefined, rates: ModelRatesUSD): number {
  if (!usage) return 0;
  const prompt = Math.max(0, usage.promptTokens || 0);
  const completion = Math.max(0, usage.completionTokens || 0);
  return (prompt * rates.promptPerM + completion * rates.completionPerM) / 1_000_000;
}

interface LedgerEntry {
  costUSD: number;
  lastSeen: number;
}

/**
 * In-memory per-round cost ledger. Entries are pruned after they go quiet so
 * the map cannot grow unbounded on a long-lived server process.
 */
export class RoundCostLedger {
  private entries = new Map<string, LedgerEntry>();

  constructor(private readonly maxAgeMs: number = 60 * 60 * 1000) {}

  /** Cumulative real cost recorded for a round (0 when unseen). */
  total(roundKey: string): number {
    return this.entries.get(roundKey)?.costUSD || 0;
  }

  /** Adds a call's real usage cost to the round; returns the new cumulative total. */
  add(roundKey: string, costUSD: number, now: number = Date.now()): number {
    this.prune(now);
    const entry = this.entries.get(roundKey) || { costUSD: 0, lastSeen: now };
    entry.costUSD += Math.max(0, costUSD);
    entry.lastSeen = now;
    this.entries.set(roundKey, entry);
    return entry.costUSD;
  }

  /** True when the round's cumulative cost has reached (or passed) the ceiling. */
  exceeded(roundKey: string, ceilingUSD: number): boolean {
    if (!(ceilingUSD > 0)) return false;
    return this.total(roundKey) >= ceilingUSD - 1e-9;
  }

  /** Drops quiet entries (the map stays small — one entry per active round). */
  prune(now: number = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastSeen > this.maxAgeMs) this.entries.delete(key);
    }
  }
}

/**
 * Extracts the flat `usage` object from a raw SSE chunk (or chunk tail) and
 * normalizes it to camelCase. OpenRouter emits a single top-level `usage`
 * object on the final chunk when `stream_options.include_usage` is set — no
 * nested braces, so a flat-object match is reliable. Returns undefined when
 * not present.
 */
export function extractUsageFromSSEChunk(text: string): UsageStats | undefined {
  const match = text.match(/"usage"\s*:\s*(\{[^{}]*"prompt_tokens"[^{}]*\})/);
  if (!match) return undefined;
  try {
    const raw = JSON.parse(match[1]);
    return {
      promptTokens: Number(raw.prompt_tokens) || 0,
      completionTokens: Number(raw.completion_tokens) || 0,
      totalTokens: Number(raw.total_tokens) || undefined,
    };
  } catch {
    return undefined;
  }
}
