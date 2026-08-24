import { describe, it, expect } from 'vitest';
import { allocateCouncilSeats } from '../serverModelAllocator';
import { DollarCostGovernor } from '../dollarCostGovernor';
import { DeliberationCircuitBreaker } from '../circuitBreaker';

describe('Backend Allocator & Dollar Governor Invariants', () => {
  const mockCatalog = [
    { id: 'anthropic/claude-3.7-sonnet', pricing: { prompt: 0.000003, completion: 0.000015 } },
    { id: 'google/gemini-2.5-flash', pricing: { prompt: 0.0000001, completion: 0.0000004 } },
    { id: 'deepseek/deepseek-r1:free', pricing: { prompt: 0, completion: 0 } },
    { id: 'openai/gpt-3.5-turbo', pricing: { prompt: 0.000001, completion: 0.000002 } }, // Deprecated
  ];

  it('obey human model overrides with strict precedence', () => {
    const allocation = allocateCouncilSeats({
      domain: 'code',
      budgetTier: 'cheap',
      personas: [{ id: 'skeptic', name: 'Skeptic', role: 'Critic' }],
      synthesizer: { id: 'synthesizer', name: 'Chair', role: 'Chair' },
      humanOverrides: { skeptic: 'anthropic/claude-3.7-sonnet' },
      catalog: mockCatalog,
    });

    expect(allocation.seats['skeptic'].assignedModel).toBe('anthropic/claude-3.7-sonnet');
    expect(allocation.seats['skeptic'].source).toBe('explicit_override');
  });

  it('filters out deprecated models when selecting automatically', () => {
    const allocation = allocateCouncilSeats({
      domain: 'general',
      budgetTier: 'cheap',
      personas: [{ id: 'pragmatist', name: 'Pragmatist', role: 'Engineer' }],
      synthesizer: { id: 'synthesizer', name: 'Chair', role: 'Chair' },
      catalog: mockCatalog,
    });

    expect(allocation.seats['pragmatist'].assignedModel).not.toBe('openai/gpt-3.5-turbo');
    expect(allocation.seats['pragmatist'].source).toBe('curated_pareto');
  });

  it('dollar cost governor throws when hard spend limit is breached', () => {
    const governor = new DollarCostGovernor({ maxSpendPerMissionUSD: 0.05, strictHardStop: true });

    // Spend $0.04
    governor.recordUsage(10000, 2000, { promptUSDPer1M: 3.0, completionUSDPer1M: 5.0 });
    expect(governor.getAccruedSpend()).toBeLessThan(0.05);

    // Attempt spend that breaches $0.05
    expect(() => {
      governor.recordUsage(10000, 2000, { promptUSDPer1M: 3.0, completionUSDPer1M: 5.0 });
    }).toThrow(/Hard Dollar Ceiling Tripped/);
  });

  it('circuit breaker terminates on infinite iteration loop', () => {
    const breaker = new DeliberationCircuitBreaker({ maxMissionIterations: 3, maxRecursiveTurns: 3, timeoutMs: 10000 });
    breaker.incrementIteration(); // 1
    breaker.incrementIteration(); // 2
    breaker.incrementIteration(); // 3
    expect(() => breaker.incrementIteration()).toThrow(/Infinite Loop Failsafe/);
  });
});
