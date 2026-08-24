import { formatCost } from './archivist';

export interface CostGovernorConfig {
  maxSpendPerMissionUSD: number;
  requireApprovalAboveUSD: number;
  strictHardStop: boolean;
}

export class DollarCostGovernor {
  private accruedSpendUSD: number = 0;
  private readonly config: CostGovernorConfig;

  constructor(config: Partial<CostGovernorConfig> = {}) {
    this.config = {
      maxSpendPerMissionUSD: config.maxSpendPerMissionUSD ?? 2.00,
      requireApprovalAboveUSD: config.requireApprovalAboveUSD ?? 0.25,
      strictHardStop: config.strictHardStop ?? true,
    };
  }

  public getAccruedSpend(): number {
    return this.accruedSpendUSD;
  }

  public getRemainingBudget(): number {
    return Math.max(0, this.config.maxSpendPerMissionUSD - this.accruedSpendUSD);
  }

  /**
   * Pre-flight assertion before initiating an LLM call.
   */
  public assertPreFlightBudget(estimatedPromptTokens: number, promptUSDPer1M: number): void {
    const estimatedCostUSD = (estimatedPromptTokens / 1_000_000) * promptUSDPer1M;
    if (this.config.strictHardStop && this.accruedSpendUSD + estimatedCostUSD > this.config.maxSpendPerMissionUSD) {
      throw new Error(
        `[CostGovernor] Budget Exceeded: Call estimated at ${formatCost(estimatedCostUSD)} would breach maximum mission ceiling of $${this.config.maxSpendPerMissionUSD.toFixed(2)} (Spent: ${formatCost(this.accruedSpendUSD)}).`
      );
    }
  }

  /**
   * Accumulates exact dollar spend from actual token usage reported by provider.
   */
  public recordUsage(promptTokens: number, completionTokens: number, pricing: { promptUSDPer1M: number; completionUSDPer1M: number }): number {
    const callCostUSD =
      (promptTokens / 1_000_000) * pricing.promptUSDPer1M +
      (completionTokens / 1_000_000) * pricing.completionUSDPer1M;

    this.accruedSpendUSD += callCostUSD;

    if (this.config.strictHardStop && this.accruedSpendUSD >= this.config.maxSpendPerMissionUSD) {
      throw new Error(
        `[CostGovernor] Hard Dollar Ceiling Tripped: Accrued spend ${formatCost(this.accruedSpendUSD)} reached limit of $${this.config.maxSpendPerMissionUSD.toFixed(2)} USD. Halting further execution.`
      );
    }

    return callCostUSD;
  }
}
