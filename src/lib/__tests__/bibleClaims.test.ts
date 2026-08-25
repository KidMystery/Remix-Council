import { describe, it, expect } from 'vitest';
import {
  admitInvariantLines,
  applyOracleRewrite,
  claimIdFor,
  hydrateBible,
  mergeBibles,
  renderBiblePrompt,
} from '../bibleClaims';

describe('sealed claims survive a rewrite', () => {
  it('Admit then Oracle rewrite keeps the change-order sentence', () => {
    const admitted = admitInvariantLines(
      { content: '', updatedAt: 1, claims: [] },
      '• Never pay a verbal change-order',
      { question: 'Fire the contractor?', admittedAt: 10 }
    );
    const rewritten = applyOracleRewrite(admitted, 'She likes folk music\nRoof is leaking', 20);
    const prompt = renderBiblePrompt(rewritten);
    expect(prompt).toContain('Never pay a verbal change-order');
    expect(prompt).toContain('folk music');
    expect(rewritten.claims?.find((c) => c.text.includes('change-order'))?.sealed).toBe(true);
    expect(rewritten.claims?.find((c) => c.text.includes('folk music'))?.sealed).toBe(false);
  });

  it('saving the rendered prompt does not duplicate LAW as notes', () => {
    const admitted = admitInvariantLines({}, 'Never pay a verbal change-order', { admittedAt: 1 });
    const again = applyOracleRewrite(admitted, renderBiblePrompt(admitted), 2);
    const change = again.claims?.filter((c) => c.text.includes('change-order') && !c.deletedAt) || [];
    expect(change).toHaveLength(1);
    expect(change[0].sealed).toBe(true);
  });

  it('rewrite cannot unseal or reword law', () => {
    const admitted = admitInvariantLines({}, 'Never pay a verbal change-order', { admittedAt: 1 });
    const id = claimIdFor('Never pay a verbal change-order');
    const rewritten = applyOracleRewrite(admitted, 'Always pay change-orders verbally', 2);
    const law = rewritten.claims?.find((c) => c.id === id);
    expect(law?.sealed).toBe(true);
    expect(law?.text).toContain('Never pay');
  });
});

describe('Drive merge prefers sealed', () => {
  it('laptop rewrite cannot beat a phone Admit of the same fact', () => {
    const phone = admitInvariantLines({}, 'Never pay a verbal change-order', { admittedAt: 50 });
    const laptop = applyOracleRewrite(
      { content: 'Roof notes only', updatedAt: 80 },
      'Roof notes only. Forget the contractor.',
      80
    );
    const merged = mergeBibles(laptop, phone, 90);
    expect(renderBiblePrompt(merged)).toContain('Never pay a verbal change-order');
    expect(merged.claims?.find((c) => c.text.includes('change-order'))?.sealed).toBe(true);
  });
});

describe('hydrate legacy blob', () => {
  it('turns ## Admitted blocks into sealed claims', () => {
    const bible = hydrateBible({
      content: 'Casual note.\n\n## Admitted 2026-08-25\nQuestion: Fire them?\n• Scope must be written',
      updatedAt: 1,
    });
    const law = bible.claims?.filter((c) => c.sealed && !c.deletedAt) || [];
    expect(law.some((c) => c.text.includes('Scope must be written'))).toBe(true);
  });
});
