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
      // 0 / non-finite = unlimited. Do not invent a $2 default — that
      // disagreed with the Settings slider ("Unlimited" = 0).
      maxSpendPerMissionUSD: config.maxSpendPerMissionUSD ?? 0,
      requireApprovalAboveUSD: config.requireApprovalAboveUSD ?? 0.25,
      strictHardStop: config.strictHardStop ?? true,
    };
  }

  public getAccruedSpend(): number {
    return this.accruedSpendUSD;
  }

  public reset(): void {
    this.accruedSpendUSD = 0;
  }

  public getRemainingBudget(): number {
    const cap = this.config.maxSpendPerMissionUSD;
    if (!(cap > 0) || !Number.isFinite(cap)) return Number.POSITIVE_INFINITY;
    return Math.max(0, cap - this.accruedSpendUSD);
  }

  private hasFiniteCap(): boolean {
    const cap = this.config.maxSpendPerMissionUSD;
    return this.config.strictHardStop && typeof cap === 'number' && Number.isFinite(cap) && cap > 0;
  }

  /**
   * Pre-flight assertion before initiating an LLM call.
   */
  public assertPreFlightBudget(estimatedPromptTokens: number, promptUSDPer1M: number): void {
    if (!this.hasFiniteCap()) return;
    const estimatedCostUSD = (estimatedPromptTokens / 1_000_000) * promptUSDPer1M;
    if (this.accruedSpendUSD + estimatedCostUSD > this.config.maxSpendPerMissionUSD) {
      throw new Error(
        `[CostGovernor] Budget Exceeded: Call estimated at ${formatCost(estimatedCostUSD)} would breach maximum mission ceiling of $${this.config.maxSpendPerMissionUSD.toFixed(2)} (Spent: ${formatCost(this.accruedSpendUSD)}).`
      );
    }
  }

  /**
   * Accumulates exact dollar spend from actual token usage reported by provider.
   * 0 / non-finite = unlimited — must not trip when cap is 0 (matches Settings slider).
   */
  public recordUsage(promptTokens: number, completionTokens: number, pricing: { promptUSDPer1M: number; completionUSDPer1M: number }, searchCostUSD: number = 0): number {
    const callCostUSD =
      (promptTokens / 1_000_000) * pricing.promptUSDPer1M +
      (completionTokens / 1_000_000) * pricing.completionUSDPer1M +
      searchCostUSD;

    this.accruedSpendUSD += callCostUSD;

    if (this.hasFiniteCap() && this.accruedSpendUSD >= this.config.maxSpendPerMissionUSD) {
      throw new Error(
        `[CostGovernor] Hard Dollar Ceiling Tripped: Accrued spend ${formatCost(this.accruedSpendUSD)} reached limit of $${this.config.maxSpendPerMissionUSD.toFixed(2)} USD. Halting further execution.`
      );
    }

    return callCostUSD;
  }
}
