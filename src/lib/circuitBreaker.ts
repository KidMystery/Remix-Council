export interface CircuitBreakerLimits {
  maxMissionIterations: number; // Hard loop cap (default 10)
  maxRecursiveTurns: number;    // Sub-agent tool executions per turn (default 3)
  timeoutMs: number;            // Total mission deadline (default 30 min)
}

export class DeliberationCircuitBreaker {
  private iterationCounter = 0;
  private recursiveTurns = 0;
  private readonly startTime = Date.now();
  private consecutiveHighConsensus = 0;

  constructor(
    private limits: CircuitBreakerLimits = {
      maxMissionIterations: 10,
      maxRecursiveTurns: 3,
      timeoutMs: 30 * 60 * 1000,
    }
  ) {}

  public incrementIteration(): void {
    this.iterationCounter++;
    if (this.iterationCounter > this.limits.maxMissionIterations) {
      throw new Error(
        `[CircuitBreaker] Infinite Loop Failsafe: Reached maximum iteration limit (${this.limits.maxMissionIterations}). Deliberation halted.`
      );
    }
    if (Date.now() - this.startTime > this.limits.timeoutMs) {
      throw new Error(
        `[CircuitBreaker] Mission Timeout: Exceeded maximum time ceiling (${this.limits.timeoutMs / 1000}s).`
      );
    }
    this.recursiveTurns = 0; // reset per-iteration depth
  }

  public trackTurnAction(): void {
    this.recursiveTurns++;
    if (this.recursiveTurns > this.limits.maxRecursiveTurns) {
      throw new Error(
        `[CircuitBreaker] Turn Recursion Limit: Exceeded ${this.limits.maxRecursiveTurns} sub-actions in a single turn.`
      );
    }
  }

  public checkEarlyConvergence(agreementScore: number): boolean {
    if (agreementScore >= 92) {
      this.consecutiveHighConsensus++;
      if (this.consecutiveHighConsensus >= 2) {
        return true; // Converged early; break loop cleanly
      }
    } else {
      this.consecutiveHighConsensus = 0;
    }
    return false;
  }
}
