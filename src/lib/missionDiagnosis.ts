/**
 * Oracle diagnosis architecture — two-tier mission orchestration.
 *
 * DIAGNOSTIC TIER (opus-class, opt-in only): when a mission fails or returns
 * empty/bad consensus, ONE diagnostic call identifies + explains the problem
 * and emits a structured PRESCRIPTION. It never implements code, never
 * re-runs missions, and is never seated in the default council pool.
 *
 * WORKER TIER (penny bench): all mission work and code fixes, working from
 * the prescription.
 *
 * Cost guards (the "$100 night" rules, enforced in code):
 *  - max 1 diagnostic invocation per failure (DiagnosisBudget)
 *  - no automatic mission re-run after a failed fix — stop and report
 *  - estimated token cost logged per pass
 *  - `spend_cap_usd` knob hard-stops the mission when exceeded
 */

// ── Tier definitions ────────────────────────────────────────────────────────

/** Opus-class frontier models. Diagnosis-path ONLY — never default seating. */
export const DIAGNOSIS_MODEL_CANDIDATES: readonly string[] = [
  'anthropic/claude-opus-5-fast',
  'anthropic/claude-opus-4.1',
] as const;

/** Cheap worker-tier bench (penny models) for mission work + code fixes. */
export const WORKER_MODEL_CANDIDATES: readonly string[] = [
  'z-ai/glm-5.3-flash',
  'google/gemini-3.7-flash',
  'deepseek/deepseek-v4-pro-0813',
  'meta-llama/llama-3.3-70b-instruct',
] as const;

export const DIAGNOSIS_SYSTEM_PROMPT = [
  'You are the Oracle Diagnostician. Your ONLY job is to diagnose.',
  'You receive a failed mission record and output a structured diagnosis.',
  'HARD RULES — violating any of these is a failure:',
  '1. NEVER write, propose, or include implementation code, patches, or diffs.',
  '2. NEVER attempt to re-run, restart, or continue the mission.',
  '3. NEVER modify configuration, prompts, or files yourself.',
  '4. Your entire output is a diagnosis: root cause, why it happened,',
  '   and exact fix STEPS (instructions, not code) that a cheaper worker',
  '   model will execute on its own.',
].join(' ');

export interface DiagnosisReport {
  root_cause: string;
  explanation: string;
  prescription: string[];
  confidence: number;
}

/** Mission outcome consumed by the orchestrator (worker-tier contract). */
export interface MissionAttempt {
  ok: boolean;
  /** Non-empty when consensus came back empty/degenerate. */
  consensus: string;
  error?: string;
}

export interface WorkerFixResult {
  ok: boolean;
  summary: string;
}

export type MissionOrchestrationResult =
  | { status: 'converged'; passes: number; estimatedCostUSD: number }
  | { status: 'diagnosed_fixed'; diagnosis: DiagnosisReport; worker: WorkerFixResult; estimatedCostUSD: number }
  | { status: 'stopped'; reason: string; diagnosis?: DiagnosisReport; estimatedCostUSD: number };

/** Single diagnosis-call cost model (opus-class pricing, per 1M tokens). */
export const DIAGNOSIS_PRICING = {
  promptUSDPer1M: 15,
  completionUSDPer1M: 75,
} as const;

export function estimateDiagnosisCostUSD(promptTokens: number, completionTokens: number): number {
  return (
    (Math.max(0, promptTokens) / 1_000_000) * DIAGNOSIS_PRICING.promptUSDPer1M +
    (Math.max(0, completionTokens) / 1_000_000) * DIAGNOSIS_PRICING.completionUSDPer1M
  );
}

// ── Parsing the diagnostic output ───────────────────────────────────────────

/** Parses (possibly fenced) JSON from a diagnostic model response. */
export function parseDiagnosisOutput(raw: string): DiagnosisReport | null {
  if (!raw) return null;
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    // Tolerate prose around the JSON object.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      parsed = JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const rootCause = typeof obj.root_cause === 'string' ? obj.root_cause.trim() : '';
  const explanation = typeof obj.explanation === 'string' ? obj.explanation.trim() : '';
  const prescription = Array.isArray(obj.prescription)
    ? obj.prescription.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
    : [];
  const confidence = typeof obj.confidence === 'number' && isFinite(obj.confidence)
    ? Math.min(1, Math.max(0, obj.confidence))
    : 0;
  if (!rootCause || !explanation || prescription.length === 0) return null;
  return { root_cause: rootCause, explanation, prescription, confidence };
}

// ── Cost guards ─────────────────────────────────────────────────────────────

export interface MissionSpendState {
  spendCapUSD: number;
  spentUSD: number;
  diagnosisInvocations: number;
}

export interface SpendGuardOptions {
  /** `spend_cap_usd` config knob. 0/undefined = unlimited. */
  spend_cap_usd?: number;
  spendCapUSD?: number;
}

/**
 * Per-mission hard spend guard. Every pass (worker or diagnostic) must pass
 * pre-flight; when the cap is exceeded the mission hard-stops.
 */
export class MissionSpendGuard {
  readonly spendCapUSD: number;
  private spent = 0;

  constructor(opts: SpendGuardOptions = {}) {
    const cap = typeof opts.spend_cap_usd === 'number' && isFinite(opts.spend_cap_usd)
      ? opts.spend_cap_usd
      : opts.spendCapUSD;
    this.spendCapUSD = cap !== undefined && isFinite(cap) && cap > 0 ? cap : 0;
  }

  get spentUSD(): number {
    return this.spent;
  }

  get overCap(): boolean {
    return this.spendCapUSD > 0 && this.spent >= this.spendCapUSD;
  }

  /** Pre-flight: would this estimated pass breach the cap? */
  wouldBreach(estimatedCostUSD: number): boolean {
    return this.spendCapUSD > 0 && this.spent + Math.max(0, estimatedCostUSD) > this.spendCapUSD;
  }

  /**
   * Records an actual pass cost and returns it. Throws when the cap is
   * breached — the mission runner treats this as a hard stop.
   */
  recordPass(label: string, actualCostUSD: number): number {
    if (this.overCap) {
      throw new Error(
        `[SpendGuard] spend_cap_usd hard stop: spent $${this.spent.toFixed(4)} >= cap $${this.spendCapUSD.toFixed(2)} before "${label}".`
      );
    }
    this.spent += Math.max(0, actualCostUSD);
    console.info(`[SpendGuard] pass "${label}" cost ≈ $${actualCostUSD.toFixed(6)} (total $${this.spent.toFixed(6)} / cap ${this.spendCapUSD > 0 ? '$' + this.spendCapUSD.toFixed(2) : '∞'})`);
    if (this.overCap) {
      throw new Error(
        `[SpendGuard] spend_cap_usd hard stop: spent $${this.spent.toFixed(4)} >= cap $${this.spendCapUSD.toFixed(2)} after "${label}". Mission halted.`
      );
    }
    return actualCostUSD;
  }
}

/** Max 1 diagnostic invocation per failure. Durable across retry attempts. */
export class DiagnosisBudget {
  private used = false;

  constructor(private readonly maxInvocations = 1) {}

  get remaining(): number {
    return Math.max(0, this.maxInvocations - (this.used ? 1 : 0));
  }

  get exhausted(): boolean {
    return this.remaining === 0;
  }

  /** Atomically consumes the single diagnostic slot, or returns null. */
  tryConsume(): boolean {
    if (this.exhausted) return false;
    this.used = true;
    return true;
  }
}

// ── Orchestrator (worker tier does the work; oracle only diagnoses) ────────

export interface DiagnosisModelCall {
  model: string;
  system: string;
  user: string;
  /** Opus-class diagnosis candidates — the ONLY path that may use them. */
  candidates: readonly string[];
}

export interface MissionDeps {
  /**
   * Runs a mission attempt with the given seats. Mocked in tests; in
   * production wired to the AgentLoopRunner (worker-tier models only).
   */
  runMission: (models: readonly string[], prescription?: DiagnosisReport) => Promise<MissionAttempt>;
  /** Runs ONE diagnostic call. Returns raw model text + token usage. */
  runDiagnosis: (call: DiagnosisModelCall) => Promise<{ raw: string; promptTokens: number; completionTokens: number }>;
  /** Applies the worker-tier fix from a prescription. */
  runWorkerFix: (prescription: DiagnosisReport) => Promise<WorkerFixResult>;
  /** Pre-estimated cost (USD) of the next diagnostic call. */
  estimateDiagnosisCost?: () => number;
  /** Pre-estimated cost (USD) of the next worker mission pass. */
  estimateMissionCost?: () => number;
}

export interface MissionOrchestratorOptions {
  deps: MissionDeps;
  spend?: SpendGuardOptions;
  /** Worker seats for the default council (penny bench; never opus-class). */
  workerModels?: readonly string[];
}

/**
 * Runs a mission under the two-tier policy:
 *  1. worker pass → ok: done.
 *  2. failed/empty consensus → exactly ONE diagnostic call (if budget + cap allow).
 *  3. prescription → worker fix. Fix fails → STOP AND REPORT. No auto re-run.
 */
export async function runMissionWithDiagnosis(
  opts: MissionOrchestratorOptions
): Promise<MissionOrchestrationResult> {
  const deps = opts.deps;
  const guard = new MissionSpendGuard(opts.spend ?? {});
  const budget = new DiagnosisBudget(1);
  const workers = opts.workerModels ?? WORKER_MODEL_CANDIDATES;
  const diagnosisModel = DIAGNOSIS_MODEL_CANDIDATES[0];
  let passes = 0;
  let estimatedCostUSD = 0;
  const estimated = (est: (() => number) | undefined, fallback: number) =>
    est ? est() : fallback;

  const attempt = await deps.runMission(workers);
  passes += 1;
  const firstEst = estimated(deps.estimateMissionCost, 0.02);
  if (guard.wouldBreach(firstEst)) {
    return { status: 'stopped', reason: 'spend_cap_usd would be exceeded by first worker pass', estimatedCostUSD };
  }
  try {
    estimatedCostUSD += guard.recordPass('worker-pass-1', firstEst);
  } catch (err: any) {
    return { status: 'stopped', reason: String(err?.message || err), estimatedCostUSD };
  }

  if (attempt.ok && attempt.consensus.trim()) {
    return { status: 'converged', passes, estimatedCostUSD };
  }

  // ── Diagnostic tier: exactly one call per failure ──
  if (guard.overCap) {
    return { status: 'stopped', reason: 'spend_cap_usd reached before diagnosis', estimatedCostUSD };
  }
  const diagEst = estimated(deps.estimateDiagnosisCost, estimateDiagnosisCostUSD(4000, 1200));
  if (guard.wouldBreach(diagEst)) {
    return { status: 'stopped', reason: 'spend_cap_usd would be exceeded by diagnostic call', estimatedCostUSD };
  }
  if (!budget.tryConsume()) {
    return { status: 'stopped', reason: 'diagnosis budget exhausted', estimatedCostUSD };
  }

  const failureContext = JSON.stringify({
    goal_error: attempt.error || null,
    consensus_empty: !attempt.consensus.trim(),
    consensus_excerpt: attempt.consensus.slice(0, 2000),
  });
  const { raw, promptTokens, completionTokens } = await deps.runDiagnosis({
    model: diagnosisModel,
    system: DIAGNOSIS_SYSTEM_PROMPT,
    user: failureContext,
    candidates: DIAGNOSIS_MODEL_CANDIDATES,
  });
  const diagActual = estimateDiagnosisCostUSD(promptTokens, completionTokens);
  guard.recordPass('diagnosis', diagActual);
  estimatedCostUSD += diagActual;

  const diagnosis = parseDiagnosisOutput(raw);
  if (!diagnosis) {
    return { status: 'stopped', reason: 'diagnosis output unparseable — stopping instead of re-running', estimatedCostUSD };
  }

  // ── Worker tier: apply the prescription ──
  const fixEst = estimated(deps.estimateMissionCost, 0.02);
  if (guard.wouldBreach(fixEst)) {
    return { status: 'stopped', reason: 'spend_cap_usd would be exceeded by worker fix', diagnosis, estimatedCostUSD };
  }
  const worker = await deps.runWorkerFix(diagnosis);
  passes += 1;
  try {
    estimatedCostUSD += guard.recordPass('worker-fix', fixEst);
  } catch (err: any) {
    return { status: 'stopped', reason: String(err?.message || err), diagnosis, estimatedCostUSD };
  }

  if (worker.ok) {
    return { status: 'diagnosed_fixed', diagnosis, worker, estimatedCostUSD };
  }

  // HARD RULE: a failed fix never triggers an automatic re-run.
  return {
    status: 'stopped',
    reason: `worker fix failed — stopped and reported, no automatic re-run: ${worker.summary.slice(0, 300)}`,
    diagnosis,
    estimatedCostUSD,
  };
}