import { BudgetPolicy, CouncilRound } from '../types';

export interface AggregateCostBreakdown {
  stage1Cost: number;
  stage2Cost: number;
  chairCost: number;
  archivistCost: number;
  webSearchCost: number;
  fallbackCost: number;
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

export function calculateRoundAggregateCost(round: CouncilRound): AggregateCostBreakdown {
  let stage1Cost = 0;
  let stage2Cost = 0;
  let chairCost = 0;
  let archivistCost = 0;
  let webSearchCost = 0;
  let fallbackCost = 0;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Stage 1
  if (round.deliberation?.stage1) {
    Object.values(round.deliberation.stage1).forEach((res) => {
      stage1Cost += res.cost || 0;
      totalPromptTokens += res.promptTokens || 0;
      totalCompletionTokens += res.completionTokens || 0;
      if (res.grounding?.searchCost) webSearchCost += res.grounding.searchCost;
      if (res.fallbackChain && res.fallbackChain.length > 0) {
        fallbackCost += (res.cost || 0) * 0.2; // track fallback telemetry
      }
    });
  }

  // Stage 2
  if (round.deliberation?.stage2) {
    Object.values(round.deliberation.stage2).forEach((res) => {
      stage2Cost += res.cost || 0;
      totalPromptTokens += res.promptTokens || 0;
      totalCompletionTokens += res.completionTokens || 0;
      if (res.grounding?.searchCost) webSearchCost += res.grounding.searchCost;
    });
  }

  // Chair Synthesis
  if (round.synthesis) {
    chairCost += round.synthesis.cost || 0;
    totalPromptTokens += round.synthesis.promptTokens || 0;
    totalCompletionTokens += round.synthesis.completionTokens || 0;
    if (round.synthesis.grounding?.searchCost) {
      webSearchCost += round.synthesis.grounding.searchCost;
    }
  }

  const totalCost = stage1Cost + stage2Cost + chairCost + archivistCost + webSearchCost;
  const totalTokens = totalPromptTokens + totalCompletionTokens;

  return {
    stage1Cost,
    stage2Cost,
    chairCost,
    archivistCost,
    webSearchCost,
    fallbackCost,
    totalCost,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
  };
}

export function isWithinBudgetCeiling(
  projectedCost: number,
  budget: BudgetPolicy,
  costCeiling: number = 1.0
): { allowed: boolean; reason?: string } {
  if (budget === 'free') {
    if (projectedCost > 0) {
      return {
        allowed: false,
        reason: `Strict Free budget violation: projected spend is $${projectedCost.toFixed(4)}, but Strict Free strictly requires $0.0000.`,
      };
    }
    return { allowed: true };
  }

  if (projectedCost > costCeiling) {
    return {
      allowed: false,
      reason: `Projected round cost ($${projectedCost.toFixed(4)}) exceeds user cost ceiling ($${costCeiling.toFixed(4)}).`,
    };
  }

  return { allowed: true };
}
