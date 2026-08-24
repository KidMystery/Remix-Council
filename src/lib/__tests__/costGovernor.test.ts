import { describe, it, expect } from 'vitest';
import {
  RoundCostLedger,
  modelRatesUSD,
  usageCostUSD,
  extractUsageFromSSEChunk,
} from '../costGovernor';

const CATALOG: any[] = [
  { id: 'google/gemini-2.5-flash', pricing: { request: '0', prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'anthropic/claude-sonnet-4.5', pricing: { request: '0', prompt: '0.000003', completion: '0.000015' } },
];

describe('costGovernor', () => {
  describe('modelRatesUSD', () => {
    it('reads per-million prompt/completion rates from the live catalog', () => {
      const rates = modelRatesUSD(CATALOG, 'google/gemini-2.5-flash');
      expect(rates.promptPerM).toBeCloseTo(0.3);
      expect(rates.completionPerM).toBeCloseTo(2.5);
    });

    it('is case-insensitive and returns zeros for unknown models', () => {
      expect(modelRatesUSD(CATALOG, 'GOOGLE/GEMINI-2.5-FLASH').promptPerM).toBeCloseTo(0.3);
      expect(modelRatesUSD(CATALOG, 'openai/does-not-exist')).toEqual({ promptPerM: 0, completionPerM: 0 });
      expect(modelRatesUSD(null, 'x/y')).toEqual({ promptPerM: 0, completionPerM: 0 });
    });
  });

  describe('usageCostUSD', () => {
    it('computes exact cost at per-million rates', () => {
      const rates = modelRatesUSD(CATALOG, 'google/gemini-2.5-flash');
      // 1M prompt tokens ($0.30) + 1M completion tokens ($2.50) = $2.80
      expect(usageCostUSD({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, rates)).toBeCloseTo(2.8);
      // 100k prompt + 100k completion = 0.03 + 0.25 = $0.28
      expect(usageCostUSD({ promptTokens: 100_000, completionTokens: 100_000 }, rates)).toBeCloseTo(0.28);
    });

    it('never goes negative and handles missing stats', () => {
      expect(usageCostUSD({ promptTokens: -5, completionTokens: -5 }, { promptPerM: 1, completionPerM: 1 })).toBe(0);
      expect(usageCostUSD(null, { promptPerM: 1, completionPerM: 1 })).toBe(0);
      expect(usageCostUSD(undefined, { promptPerM: 1, completionPerM: 1 })).toBe(0);
    });
  });

  describe('RoundCostLedger', () => {
    it('accumulates real spend per round and reports totals', () => {
      const ledger = new RoundCostLedger();
      expect(ledger.total('a:1')).toBe(0);
      const t1 = ledger.add('a:1', 0.1);
      expect(t1).toBeCloseTo(0.1);
      const t2 = ledger.add('a:1', 0.25);
      expect(t2).toBeCloseTo(0.35);
      expect(ledger.total('a:1')).toBeCloseTo(0.35);
    });

    it('keeps rounds independent', () => {
      const ledger = new RoundCostLedger();
      ledger.add('a:1', 0.5);
      ledger.add('b:1', 0.1);
      expect(ledger.total('a:1')).toBeCloseTo(0.5);
      expect(ledger.total('b:1')).toBeCloseTo(0.1);
    });

    it('flags a round as exceeded at and beyond the ceiling, not below it', () => {
      const ledger = new RoundCostLedger();
      ledger.add('r1', 0.49);
      expect(ledger.exceeded('r1', 0.5)).toBe(false);
      ledger.add('r1', 0.01);
      expect(ledger.exceeded('r1', 0.5)).toBe(true);
      ledger.add('r1', 0.5);
      expect(ledger.exceeded('r1', 0.5)).toBe(true);
    });

    it('ignores ceilings that are not set (<= 0)', () => {
      const ledger = new RoundCostLedger();
      ledger.add('r1', 999);
      expect(ledger.exceeded('r1', 0)).toBe(false);
    });

    it('prunes quiet entries but keeps active ones', () => {
      const ledger = new RoundCostLedger(1000); // 1s max age
      const now = 1_000_000;
      ledger.add('old', 0.5, now);
      ledger.add('new', 0.5, now + 500);
      expect(ledger.total('old')).toBeCloseTo(0.5);
      ledger.prune(now + 5000); // both older than max age now
      expect(ledger.total('old')).toBe(0);
      expect(ledger.total('new')).toBe(0);
      // A fresh entry survives the same prune.
      ledger.add('fresh', 0.1, now + 4990);
      ledger.prune(now + 5000);
      expect(ledger.total('fresh')).toBeCloseTo(0.1);
    });

    it('never lets negative costs reduce a round total', () => {
      const ledger = new RoundCostLedger();
      ledger.add('r1', 0.5);
      ledger.add('r1', -10);
      expect(ledger.total('r1')).toBeCloseTo(0.5);
    });
  });

  describe('extractUsageFromSSEChunk', () => {
    it('finds the flat usage object in a final SSE chunk', () => {
      const chunk = 'data: {"id":"x","choices":[],"usage":{"prompt_tokens":123,"completion_tokens":456,"total_tokens":579}}\n\n';
      const usage = extractUsageFromSSEChunk(chunk);
      expect(usage).toMatchObject({ promptTokens: 123, completionTokens: 456, totalTokens: 579 });
    });

    it('handles the object split across chunk tail boundaries', () => {
      // The server keeps a rolling tail; this simulates the tail containing the object.
      const usage = extractUsageFromSSEChunk('garbage data: {"choices":[] "usage":{"prompt_tokens":7,"completion_tokens":9}} tail');
      expect(usage).toMatchObject({ promptTokens: 7, completionTokens: 9 });
    });

    it('returns undefined when usage is absent', () => {
      expect(extractUsageFromSSEChunk('data: {"choices":[{"delta":{"content":"hi"}}]}')).toBeUndefined();
      expect(extractUsageFromSSEChunk('')).toBeUndefined();
    });
  });
});
