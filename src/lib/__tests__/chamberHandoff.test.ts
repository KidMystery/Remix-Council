import { describe, it, expect } from 'vitest';
import {
  admitInvariantsToBible,
  buildCaseBrief,
  extractInvariants,
  lastUserQuestion,
  parseChamberCommand,
} from '../chamberHandoff';

describe('parseChamberCommand', () => {
  it('detects /chamber and optional question', () => {
    expect(parseChamberCommand('/chamber')).toEqual({ isCommand: true, question: '' });
    expect(parseChamberCommand('/chamber rebuild the roof?')).toEqual({
      isCommand: true,
      question: 'rebuild the roof?',
    });
    expect(parseChamberCommand('just talking')).toEqual({ isCommand: false, question: 'just talking' });
  });
});

describe('buildCaseBrief', () => {
  it('uses the last user turn, not the whole vent, and never dumps the Bible', () => {
    const handoff = buildCaseBrief({
      threadId: 't1',
      threadTitle: 'Bills',
      messages: [
        { role: 'user', content: 'I am spiraling about the contractor again for the tenth time this month honestly' },
        { role: 'assistant', content: 'I hear you.' },
        { role: 'user', content: 'Should we fire them over the change-order on the roof?' },
      ],
      threadBible: 'Contractor is late. Change-order unsigned.',
      globalBible: 'Never pay a change-order without a written scope.',
    });
    expect(handoff.question).toContain('fire them');
    expect(handoff.brief).toContain('CASE BRIEF');
    expect(handoff.brief).toContain('Never pay a change-order');
    expect(handoff.brief.length).toBeLessThan(4000);
    expect(handoff.domain).toBe('general');
  });

  it('prefers an explicit /chamber question over the last vent', () => {
    const handoff = buildCaseBrief({
      threadId: 't1',
      question: 'Is this TypeScript race a real bug?',
      messages: [{ role: 'user', content: 'ugh another day' }],
    });
    expect(handoff.question).toContain('TypeScript');
    expect(handoff.domain).toBe('code');
  });
});

describe('extractInvariants + admit', () => {
  it('takes the invariants heading, not the essay', () => {
    const inv = extractInvariants(
      'Long preamble.\n## Consensus Invariants\n- Scope must be written\n- No verbal change-orders\n## Next steps\nCall the lawyer'
    );
    expect(inv).toContain('Scope must be written');
    expect(inv).not.toContain('Call the lawyer');
  });

  it('seals invariants without eating prior notes', () => {
    const next = admitInvariantsToBible(
      { content: 'Existing law.', updatedAt: 1 },
      '• Scope must be written',
      {
        question: 'Fire the contractor?',
        admittedAt: Date.parse('2026-08-25'),
      }
    );
    const blob = (next.content || '') + (next.claims || []).map((c) => c.text).join(' ');
    expect(blob).toMatch(/Existing law|Scope must be written/);
    expect(next.claims?.some((c) => c.sealed && c.text.includes('Scope must be written'))).toBe(true);
  });
});

describe('lastUserQuestion', () => {
  it('skips a bare /chamber and finds the prior turn', () => {
    expect(
      lastUserQuestion([
        { role: 'user', content: 'What about the invoice?' },
        { role: 'user', content: '/chamber' },
      ])
    ).toBe('What about the invoice?');
  });
});
