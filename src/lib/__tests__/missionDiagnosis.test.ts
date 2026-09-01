import { describe, it, expect, vi } from 'vitest';
import {
  parseDiagnosisOutput,
  runMissionWithDiagnosis,
  DiagnosisBudget,
  MissionSpendGuard,
  estimateDiagnosisCostUSD,
  DIAGNOSIS_MODEL_CANDIDATES,
  DIAGNOSIS_SYSTEM_PROMPT,
  WORKER_MODEL_CANDIDATES,
} from '../missionDiagnosis';
import { AUTO_CODING_COUNCIL, CURRENT_GEN_POOL_IDS, DIAGNOSIS_ONLY_MODELS } from '../modelCatalog';

const GOOD_DIAGNOSIS = JSON.stringify({
  root_cause: 'CSV exhibit chunking dropped the header row',
  explanation: 'The docket splitter skipped row 0, so every pass saw data without column labels.',
  prescription: ['Re-run chunking with headers retained', 'Verify pass 1 cites column names'],
  confidence: 0.9,
});

function baseDeps(overrides: Record<string, any> = {}): any {
  return {
    runMission: vi.fn().mockResolvedValue({ ok: false, consensus: '', error: 'empty consensus' }),
    runDiagnosis: vi
      .fn()
      .mockResolvedValue({ raw: GOOD_DIAGNOSIS, promptTokens: 4000, completionTokens: 1200 }),
    runWorkerFix: vi.fn().mockResolvedValue({ ok: true, summary: 'fixed headers' }),
    ...overrides,
  };
}

describe('two-tier mission orchestration (oracle diagnosis architecture)', () => {
  it('(a) a failed mission triggers exactly one diagnosis call', async () => {
    const deps = baseDeps();
    const res = await runMissionWithDiagnosis({ deps });
    expect(deps.runDiagnosis).toHaveBeenCalledTimes(1);
    expect(deps.runDiagnosis.mock.calls[0][0].model).toBe(DIAGNOSIS_MODEL_CANDIDATES[0]);
    expect(deps.runDiagnosis.mock.calls[0][0].system).toBe(DIAGNOSIS_SYSTEM_PROMPT);
    expect(res.status).toBe('diagnosed_fixed');
  });

  it('(b) diagnosis output is parsed into a prescription passed to the worker tier', async () => {
    const deps = baseDeps();
    const res = await runMissionWithDiagnosis({ deps });
    expect(deps.runWorkerFix).toHaveBeenCalledTimes(1);
    const report = deps.runWorkerFix.mock.calls[0][0];
    expect(report.root_cause).toContain('chunking');
    expect(report.prescription).toHaveLength(2);
    expect(res.status).toBe('diagnosed_fixed');
    if (res.status === 'diagnosed_fixed') expect(res.diagnosis.confidence).toBeCloseTo(0.9);
  });

  it('(c) a failed worker fix does NOT auto re-run — returns a stopped report', async () => {
    const deps = baseDeps({
      runWorkerFix: vi.fn().mockResolvedValue({ ok: false, summary: 'patch still failing' }),
    });
    const res = await runMissionWithDiagnosis({ deps });
    expect(deps.runMission).toHaveBeenCalledTimes(1); // no re-run
    expect(deps.runDiagnosis).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('stopped');
    if (res.status === 'stopped') expect(res.reason).toContain('no automatic re-run');
  });

  it('(d) opus-class models are absent from default pool but available to diagnosis', () => {
    for (const opus of DIAGNOSIS_ONLY_MODELS) {
      expect(AUTO_CODING_COUNCIL).not.toContain(opus);
      expect(CURRENT_GEN_POOL_IDS).not.toContain(opus);
      expect(DIAGNOSIS_MODEL_CANDIDATES).toContain(opus);
      expect(WORKER_MODEL_CANDIDATES).not.toContain(opus);
    }
  });

  it('(e) spend_cap_usd hard-stops the mission when exceeded', async () => {
    // Tight cap: the diagnosis estimate breaches immediately → no diagnosis call.
    const deps2 = baseDeps();
    const res2 = await runMissionWithDiagnosis({ deps: deps2, spend: { spend_cap_usd: 0.05 } });
    expect(res2.status).toBe('stopped');
    if (res2.status === 'stopped') expect(res2.reason).toContain('spend_cap_usd');
    expect(deps2.runDiagnosis).not.toHaveBeenCalled();
    // recordPass hard stop at the cap.
    const guard = new MissionSpendGuard({ spend_cap_usd: 0.02 });
    guard.recordPass('a', 0.01);
    expect(() => guard.recordPass('b', 0.005)).not.toThrow();
    expect(() => guard.recordPass('c', 0.01)).toThrow(/spend_cap_usd hard stop/);
  });

  it('diagnosis budget: max one invocation per failure, no second chance', () => {
    const budget = new DiagnosisBudget(1);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.exhausted).toBe(true);
  });

  it('parses fenced and prose-wrapped diagnosis JSON; rejects garbage', () => {
    expect(parseDiagnosisOutput('```json\n' + GOOD_DIAGNOSIS + '\n```')?.root_cause).toContain('chunking');
    expect(parseDiagnosisOutput('Here is my analysis: ' + GOOD_DIAGNOSIS)?.prescription).toHaveLength(2);
    expect(parseDiagnosisOutput('no json here')).toBeNull();
    expect(parseDiagnosisOutput('{"root_cause":"x","explanation":"y","prescription":[],"confidence":0.5}')).toBeNull();
  });

  it('cost estimator prices opus-class calls at diagnosis rates', () => {
    expect(estimateDiagnosisCostUSD(1_000_000, 1_000_000)).toBeCloseTo(90);
    expect(estimateDiagnosisCostUSD(0, 0)).toBe(0);
  });
});