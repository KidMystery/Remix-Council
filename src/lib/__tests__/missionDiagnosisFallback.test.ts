import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runDiagnosisWithFallback,
  runMissionWithDiagnosis,
  isModelUnhealthy,
  isKnownFamilyBug,
  resetUnhealthyModels,
  DiagnosisFallbackError,
  DIAGNOSIS_MODEL_CANDIDATES,
} from '../missionDiagnosis';

const GOOD_DIAGNOSIS = JSON.stringify({
  root_cause: 'CSV exhibit chunking dropped the header row',
  explanation: 'The docket splitter skipped row 0, so every pass saw data without column labels.',
  prescription: ['Re-run chunking with headers retained', 'Verify pass 1 cites column names'],
  confidence: 0.9,
});

const OK = { raw: GOOD_DIAGNOSIS, promptTokens: 4000, completionTokens: 1200 };

function spark400(msg = "Model meta/muse-spark-1.2 rejected the request (400): Provider returned error — missing 'arguments' field in tool call") {
  const err = new Error(msg) as Error & { status?: number };
  err.status = 400;
  return err;
}

beforeEach(() => {
  resetUnhealthyModels();
});

describe('diagnosis premier-model fallback chain', () => {
  it('(a) spark 400 → second candidate used, diagnosis succeeds', async () => {
    const runDiagnosis = vi
      .fn()
      .mockRejectedValueOnce(spark400())
      .mockResolvedValueOnce(OK);
    const res = await runDiagnosisWithFallback(
      { system: 's', user: 'u' },
      runDiagnosis as any,
      ['meta/muse-spark-1.2', 'anthropic/claude-opus-5-fast']
    );
    expect(res.raw).toContain('chunking');
    expect(runDiagnosis).toHaveBeenCalledTimes(2);
    expect(runDiagnosis.mock.calls[1][0].model).toBe('anthropic/claude-opus-5-fast');
    expect(res.attempts).toHaveLength(1);
    expect(res.attempts[0]).toMatchObject({ model: 'meta/muse-spark-1.2', error_type: 'http_4xx', status: 400 });
  });

  it('(b) all candidates fail → structured error with attempt log', async () => {
    const runDiagnosis = vi.fn().mockRejectedValue(spark400());
    await expect(
      runDiagnosisWithFallback({ system: 's', user: 'u' }, runDiagnosis as any, [
        'meta/muse-spark-1.2',
        'anthropic/claude-opus-5-fast',
      ])
    ).rejects.toBeInstanceOf(DiagnosisFallbackError);
    expect(runDiagnosis).toHaveBeenCalledTimes(2);
    // First call marks spark unhealthy (known-bug 400) → second call skips it.
    try {
      await runDiagnosisWithFallback({ system: 's', user: 'u' }, runDiagnosis as any, [
        'meta/muse-spark-1.2',
        'anthropic/claude-opus-5-fast',
      ]);
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.attempts).toHaveLength(2); // skipped spark entry + failed opus attempt
      expect(err.attempts[0].model).toBe('meta/muse-spark-1.2');
      expect(err.message).toContain('All diagnosis model candidates failed');
    }
  });

  it('(c) known-bug 400 → spark skipped on next call in same session', async () => {
    const runDiagnosis = vi
      .fn()
      .mockRejectedValueOnce(spark400()) // known-bug 400
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce(OK); // next call must NOT hit spark again
    await runDiagnosisWithFallback({ system: 's', user: 'u' }, runDiagnosis as any, [
      'meta/muse-spark-1.2',
      'anthropic/claude-opus-5-fast',
    ]);
    expect(isModelUnhealthy('meta/muse-spark-1.2')).toBe(true);
    await runDiagnosisWithFallback({ system: 's', user: 'u' }, runDiagnosis as any, [
      'meta/muse-spark-1.2',
      'anthropic/claude-opus-5-fast',
    ]);
    // Spark skipped → only ONE additional real call (to opus).
    expect(runDiagnosis).toHaveBeenCalledTimes(3);
    expect(runDiagnosis.mock.calls[2][0].model).toBe('anthropic/claude-opus-5-fast');
  });

  it('un-bug-like 400 does NOT mark spark unhealthy', async () => {
    const runDiagnosis = vi.fn().mockRejectedValueOnce(spark400('totally unrelated 400 problem')).mockResolvedValueOnce(OK);
    await runDiagnosisWithFallback({ system: 's', user: 'u' }, runDiagnosis as any, [
      'meta/muse-spark-1.2',
      'anthropic/claude-opus-5-fast',
    ]);
    expect(isModelUnhealthy('meta/muse-spark-1.2')).toBe(false);
  });

  it('isKnownFamilyBug matches the documented patterns only', () => {
    expect(isKnownFamilyBug(new Error("missing 'arguments' field in tool call"))).toBe(true);
    expect(isKnownFamilyBug(new Error('Function name exceeds 64 characters'))).toBe(true);
    expect(isKnownFamilyBug(new Error('context length exceeded'))).toBe(false);
    expect(isKnownFamilyBug(new Error('rate limited'))).toBe(false);
  });

  it('orchestrator surfaces structured all-candidates-failed reason instead of raw 400', async () => {
    resetUnhealthyModels();
    const deps = {
      runMission: vi.fn().mockResolvedValue({ ok: false, consensus: '', error: 'empty consensus' }),
      runDiagnosis: vi.fn().mockRejectedValue(spark400()),
      runWorkerFix: vi.fn(),
    };
    const res = await runMissionWithDiagnosis({ deps: deps as any });
    expect(res.status).toBe('stopped');
    if (res.status === 'stopped') expect(res.reason).toContain('All diagnosis model candidates failed');
    expect(deps.runDiagnosis).toHaveBeenCalledTimes(DIAGNOSIS_MODEL_CANDIDATES.length);
  });
});
