import { describe, it, expect } from 'vitest';
import type { CouncilRound, EvidenceRecord, Persona } from '../../types';
import {
  collectRunBlockers,
  canStampCompleted,
  stampFromBlockers,
  applyStamp,
  resolveCostCeilingUSD,
  stripRoundBodies,
  stripSessionsBodies,
  compactStoredUserQuery,
  STORED_QUERY_OMITTED,
  preferIncomingRound,
  makeEvidenceRecord,
  coverageLabel,
  coverageRatio,
  evidenceIdFromSha,
  LEGACY_TRUNCATION_MARKERS,
} from '../evidence';

const PERSONAS: Persona[] = [
  { id: 'skeptic', name: 'S', role: 'r', avatar: '', color: '', systemPrompt: '', model: 'x/y', enabled: true },
  { id: 'visionary', name: 'V', role: 'r', avatar: '', color: '', systemPrompt: '', model: 'x/y', enabled: true },
  { id: 'pragmatist', name: 'P', role: 'r', avatar: '', color: '', systemPrompt: '', model: 'x/y', enabled: true },
];

function pdfExhibit(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    ...makeEvidenceRecord({
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'bill.pdf',
      mime: 'application/pdf',
      byteSize: 800_000,
      extractor: 'pdf-text',
      coverage: { extractedChars: 4000, pagesTotal: 80, pagesWithText: 12 },
      body: 'page one of an insurance EOB',
    }),
    ...overrides,
  };
}

function baseRound(overrides: Partial<CouncilRound> = {}): CouncilRound {
  return {
    id: 'round_1',
    userQuery: 'Is this bill right?',
    timestamp: 1,
    deliberation: { stage1: {}, stage2: {} },
    synthesis: { content: '', status: 'idle' },
    ...overrides,
  };
}

describe('resolveCostCeilingUSD', () => {
  it('treats 0 / negative / NaN as unlimited — never invents $2', () => {
    expect(resolveCostCeilingUSD(0)).toBeUndefined();
    expect(resolveCostCeilingUSD(-1)).toBeUndefined();
    expect(resolveCostCeilingUSD(Number.NaN)).toBeUndefined();
    expect(resolveCostCeilingUSD(undefined)).toBeUndefined();
    expect(resolveCostCeilingUSD(1.5)).toBe(1.5);
  });
});

describe('collectRunBlockers', () => {
  it('blocks a thin-coverage PDF (12 of 80 pages)', () => {
    const blockers = collectRunBlockers({
      evidence: [pdfExhibit()],
      personas: PERSONAS,
    });
    expect(blockers.some((b) => b.type === 'coverage_thin')).toBe(true);
    expect(canStampCompleted(blockers)).toBe(false);
  });

  it('does not flag a short fully-read letter as thin', () => {
    const ev = makeEvidenceRecord({
      sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      name: 'note.pdf',
      mime: 'application/pdf',
      byteSize: 20_000,
      extractor: 'pdf-text',
      coverage: { extractedChars: 1800, pagesTotal: 2, pagesWithText: 2 },
      body: 'two page letter',
    });
    const blockers = collectRunBlockers({ evidence: [ev], personas: PERSONAS });
    expect(blockers.some((b) => b.type === 'coverage_thin')).toBe(false);
  });

  it('blocks extractor failure and 0-char reads of a non-empty file', () => {
    const failed = makeEvidenceRecord({
      sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      name: 'scan.pdf',
      mime: 'application/pdf',
      byteSize: 50_000,
      extractor: 'failed',
      coverage: { extractedChars: 0, pagesTotal: 10, pagesWithText: 0 },
      body: '',
      failDetail: 'password protected',
    });
    const blockers = collectRunBlockers({ evidence: [failed], personas: PERSONAS });
    expect(blockers.some((b) => b.type === 'extraction_failed')).toBe(true);
  });

  it('blocks a partial panel — Chair must not stamp error strings', () => {
    const blockers = collectRunBlockers({
      personas: PERSONAS,
      stage1Attempted: true,
      stage1: {
        skeptic: { status: 'completed', promptTokens: 10 },
        visionary: { status: 'error' },
        pragmatist: { status: 'error' },
      },
    });
    const partial = blockers.find((b) => b.type === 'partial_panel');
    expect(partial).toMatchObject({ completed: 1, required: 3 });
    expect(stampFromBlockers(blockers)).toBe('blocked');
  });

  it('blocks skipped stages instead of calling a skip-note a verdict', () => {
    const blockers = collectRunBlockers({
      personas: PERSONAS,
      stage1Attempted: true,
      stage1: {
        skeptic: { status: 'completed', promptTokens: 10 },
        visionary: { status: 'completed', promptTokens: 10 },
        pragmatist: { status: 'completed', promptTokens: 10 },
      },
      overCeiling: true,
      costCeilingUSD: 0.5,
    });
    expect(blockers.some((b) => b.type === 'skipped_stages')).toBe(true);
    expect(canStampCompleted(blockers)).toBe(false);
  });

  it('blocks cost_unknown when a ceiling is set but usage is missing', () => {
    const blockers = collectRunBlockers({
      personas: PERSONAS,
      stage1Attempted: true,
      costCeilingUSD: 2,
      isQuickPanel: true,
      stage1: {
        skeptic: { status: 'completed' },
        visionary: { status: 'completed' },
        pragmatist: { status: 'completed' },
      },
    });
    expect(blockers.some((b) => b.type === 'cost_unknown')).toBe(true);
  });

  it('does not invent cost_unknown when the ceiling is unlimited', () => {
    const blockers = collectRunBlockers({
      personas: PERSONAS,
      stage1Attempted: true,
      isQuickPanel: true,
      stage1: {
        skeptic: { status: 'completed' },
        visionary: { status: 'completed' },
        pragmatist: { status: 'completed' },
      },
    });
    expect(blockers.some((b) => b.type === 'cost_unknown')).toBe(false);
    expect(canStampCompleted(blockers)).toBe(true);
  });

  it('blocks a missing blob and a legacy truncated inline body', () => {
    const ev = pdfExhibit();
    const truncated = collectRunBlockers({
      evidence: [ev],
      attached: [{ name: 'old.txt', content: `hello\n${LEGACY_TRUNCATION_MARKERS[0]}: 90000 chars]` }],
      personas: PERSONAS,
      missingBlobIds: [ev.id],
    });
    expect(truncated.some((b) => b.type === 'blob_missing')).toBe(true);
    expect(truncated.some((b) => b.type === 'legacy_truncated_inline')).toBe(true);
  });
});

describe('stripRoundBodies', () => {
  it('drops file bodies and keeps exhibit metadata — never slices', () => {
    const ev = pdfExhibit();
    const round = baseRound({
      evidence: [ev],
      attachedTextFiles: [{ name: 'bill.pdf', content: 'x'.repeat(50_000), size: 800_000, evidenceId: ev.id }],
    });
    const stripped = stripRoundBodies(round);
    expect(stripped.attachedTextFiles?.[0].content).toBe('');
    expect(stripped.attachedTextFiles?.[0].evidenceId).toBe(ev.id);
    expect(stripped.evidence?.[0].sha256).toBe(ev.sha256);
    expect(stripped.evidence?.[0].coverage.pagesTotal).toBe(80);
  });

  it('strips nested sessions for persistence', () => {
    const sessions = stripSessionsBodies([
      {
        id: 's1',
        rounds: [
          baseRound({
            attachedTextFiles: [{ name: 'a.txt', content: 'hello world', evidenceId: 'ev_1' }],
          }),
        ],
      },
    ]);
    expect(sessions[0].rounds[0].attachedTextFiles?.[0].content).toBe('');
  });

  it('drops a Nexus exhibit dump from userQuery and leaves a typed question alone', () => {
    const csv = 'date,amt\n' + '2026-01-01,40\n'.repeat(2000);
    const dumped =
      `[Nexus Lab Cycle 1/3]:\nDirective: pay the cruise, keep TQQQ.\n\n[Attached exhibits]:\n--- File: monarch.csv ---\n${csv}`;
    expect(compactStoredUserQuery(dumped)).toBe(
      `[Nexus Lab Cycle 1/3]:\nDirective: pay the cruise, keep TQQQ.\n\n${STORED_QUERY_OMITTED}`
    );
    expect(compactStoredUserQuery('What bills do I pay this week?')).toBe(
      'What bills do I pay this week?'
    );

    const stripped = stripRoundBodies(
      baseRound({
        userQuery: dumped,
        attachedTextFiles: [{ name: 'monarch.csv', content: csv, evidenceId: 'ev_1' }],
      })
    );
    expect(stripped.attachedTextFiles?.[0].content).toBe('');
    expect(stripped.userQuery).not.toContain('2026-01-01,40');
    expect(stripped.userQuery).toContain(STORED_QUERY_OMITTED);
  });
});

describe('preferIncomingRound', () => {
  it('prefers a copy with evidence over a truncated inline Drive copy', () => {
    const local = baseRound({
      evidence: [pdfExhibit()],
      attachedTextFiles: [{ name: 'bill.pdf', content: '', evidenceId: 'ev_aa' }],
      deliberation: {
        stage1: { skeptic: { personaId: 'skeptic', content: 'ok', status: 'completed' } },
        stage2: {},
      },
    });
    const drive = baseRound({
      attachedTextFiles: [{ name: 'bill.pdf', content: `page1\n${LEGACY_TRUNCATION_MARKERS[0]}` }],
      synthesis: { content: 'a very long looking synthesis '.repeat(40), status: 'completed' },
    });
    expect(preferIncomingRound(local, drive)).toBe(false);
    expect(preferIncomingRound(drive, local)).toBe(true);
  });

  it('breaks ties on completed seats, not synthesis string length', () => {
    const a = baseRound({
      deliberation: {
        stage1: {
          skeptic: { personaId: 'skeptic', content: 'x', status: 'completed' },
          visionary: { personaId: 'visionary', content: 'x', status: 'completed' },
        },
        stage2: {},
      },
      synthesis: { content: 'short', status: 'idle' },
    });
    const b = baseRound({
      deliberation: {
        stage1: { skeptic: { personaId: 'skeptic', content: 'y', status: 'completed' } },
        stage2: {},
      },
      synthesis: { content: 'much longer synthesis that used to win merge-by-length', status: 'completed' },
    });
    expect(preferIncomingRound(b, a)).toBe(true);
  });
});

describe('applyStamp', () => {
  it('refuses to leave synthesis.status=completed on a blocked round', () => {
    const round = applyStamp(
      baseRound({ synthesis: { content: 'Stage 2 skipped (ceiling).', status: 'completed' } }),
      'blocked',
      [{ type: 'skipped_stages', reason: 'ceiling', detail: 'ceiling' }]
    );
    expect(round.stamp).toBe('blocked');
    expect(round.synthesis.status).not.toBe('completed');
  });
});

describe('helpers', () => {
  it('labels coverage and derives ids from sha', () => {
    const ev = pdfExhibit();
    expect(coverageLabel(ev)).toBe('12 / 80 pages with text');
    expect(coverageRatio(ev)).toBeCloseTo(12 / 80);
    expect(evidenceIdFromSha(ev.sha256)).toBe('ev_aaaaaaaaaaaaaaaa');
  });
});
