import { describe, it, expect } from 'vitest';
import {
  buildOvernightPlan,
  canLaunchNexus,
  classifyExhibit,
  MAX_SERVER_EXHIBIT_CHARS,
  packExhibitsForServer,
} from '../nexusExhibits';

describe('canLaunchNexus', () => {
  it('refuses a goal with no artifacts', () => {
    const r = canLaunchNexus({ files: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/artifacts/i);
  });

  it('launches when a file has a body', () => {
    expect(canLaunchNexus({ files: [{ name: 'app/tree.ts', content: 'export const x = 1' }] }).ok).toBe(true);
  });

  it('launches a follow-up without new files', () => {
    expect(canLaunchNexus({ files: [], followUp: 'Prior consensus: accept the $14k quote.' }).ok).toBe(true);
  });

  it('refuses empty docket rows (blob missing)', () => {
    const r = canLaunchNexus({ files: [{ name: 'bill.pdf', content: '' }] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/blob missing/i);
  });
});

describe('packExhibitsForServer', () => {
  it('refuses rather than slice a huge tree', () => {
    const huge = 'x'.repeat(MAX_SERVER_EXHIBIT_CHARS + 1);
    const packed = packExhibitsForServer([{ name: 'repo.zip', content: huge }]);
    expect(packed.ok).toBe(false);
    if (!packed.ok) expect(packed.error).toMatch(/too large for a server job/i);
  });

  it('packs a CSV + statement in full', () => {
    const packed = packExhibitsForServer([
      { name: 'spend.csv', content: 'date,amt\n2026-01-01,40' },
      { name: 'statement.txt', content: 'Opening balance 1200' },
    ]);
    expect(packed.ok).toBe(true);
    if (packed.ok) {
      expect(packed.context).toContain('spend.csv');
      expect(packed.context).toContain('Opening balance 1200');
      expect(packed.context).toContain('EXHIBITS');
    }
  });
});

describe('buildOvernightPlan', () => {
  it('reads every chunk before falsify — does not drop unread parts to fit the cycle budget', () => {
    const big = 'Paragraph.\n\n'.repeat(8000); // > 20-page chunk threshold (~60k chars)
    const plan = buildOvernightPlan({
      goal: 'What should we ship Monday?',
      files: [{ name: 'app/README.md', content: big }],
      passes: 2,
      pagesPerChunk: 20,
    });
    expect(plan.ok).toBe(true);
    expect(plan.wasChunked).toBe(true);
    const parts = plan.passes.filter((p) => p.label.startsWith('📄'));
    expect(parts.length).toBe(plan.docPlan?.chunks.length);
    expect(plan.passes.some((p) => p.isFinalSynthesis)).toBe(true);
  });

  it('classifies a CSV as csv', () => {
    expect(classifyExhibit('bank.csv')).toBe('csv');
    expect(classifyExhibit('src/App.tsx')).toBe('code');
  });
});
