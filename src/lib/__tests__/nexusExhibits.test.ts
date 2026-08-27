import { describe, it, expect } from 'vitest';
import {
  buildOvernightPlan,
  canLaunchNexus,
  classifyExhibit,
  packExhibitsForServerJob,
  MAX_SERVER_EXHIBIT_TOTAL_CHARS,
  MAX_SERVER_EXHIBIT_FILES,
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

describe('packExhibitsForServerJob', () => {
  it('ships a full 768k-char tree — the server walks it part-by-part', () => {
    // Regression: this size used to be refused client-side (old 50k cap).
    const tree = 'Paragraph.\n\n'.repeat(96_000); // 768,000 chars
    const packed = packExhibitsForServerJob([{ name: 'repo.zip', content: tree }]);
    expect(packed.ok).toBe(true);
    if (packed.ok) {
      expect(packed.wasChunked).toBe(true);
      expect(packed.chunkCount).toBeGreaterThan(1);
      expect(packed.exhibits[0].content.length).toBe(tree.length); // full body, never sliced
      expect(packed.manifest).toContain('repo.zip');
    }
  });

  it('packs a small CSV + statement for a single inline read', () => {
    const packed = packExhibitsForServerJob([
      { name: 'spend.csv', content: 'date,amt\n2026-01-01,40' },
      { name: 'statement.txt', content: 'Opening balance 1200' },
    ]);
    expect(packed.ok).toBe(true);
    if (packed.ok) {
      expect(packed.wasChunked).toBe(false);
      expect(packed.chunkCount).toBe(1);
      expect(packed.exhibits).toHaveLength(2);
      expect(packed.manifest).toContain('EXHIBITS');
    }
  });

  it('refuses above the hard server caps instead of slicing', () => {
    const huge = packExhibitsForServerJob([{ name: 'repo.zip', content: 'x'.repeat(MAX_SERVER_EXHIBIT_TOTAL_CHARS + 1) }]);
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.error).toMatch(/over the server cap/i);

    const many = Array.from({ length: MAX_SERVER_EXHIBIT_FILES + 1 }, (_, i) => ({ name: `f${i}.txt`, content: 'body' }));
    const tooMany = packExhibitsForServerJob(many);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toMatch(/too many exhibit files/i);
  });

  it('refuses an empty docket', () => {
    const packed = packExhibitsForServerJob([]);
    expect(packed.ok).toBe(false);
    if (!packed.ok) expect(packed.error).toMatch(/need exhibits/i);
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
