import { describe, it, expect } from 'vitest';
import { threadSummaryLine, oracleThreadLabel, DEFAULT_ORACLE_TITLE } from '../titleUtils';

/**
 * "Check if all threads summarize — Oracle can be based on the initial prompt"
 * (Aug 2026):
 *
 * Nexus missions summarize in the sidebar; Oracle threads and Chamber
 * sessions did not. Contract:
 * - threadSummaryLine({ initialPrompt }) → flat, noise-stripped one-line
 *   excerpt of the initial prompt (for sidebars and tooltips).
 * - oracleThreadLabel(title, initialPrompt) → backfills GENERIC titles
 *   ("New Conversation"…) from the initial prompt in Title Case; a real
 *   title (user rename, "Council Briefing — X") is never overridden.
 */

const LONG = 'Please go over the attached cashflow CSVs from last night and tell me where I am leaking money every month, including subscriptions I forgot about, and the TQQQ contributions I promised to hold at 62.50 per week no matter what the council says about market timing';

describe('threadSummaryLine', () => {
  it('returns a flat, markdown-stripped line from the initial prompt', () => {
    const s = threadSummaryLine({ initialPrompt: '## Help\n\n- **Leaks**: subscriptions\n- TQQQ at 62.50' });
    expect(s).toMatch(/Leaks.*subscriptions.*TQQQ/);
    expect(s).not.toMatch(/##|\*\*/);
  });

  it('strips attachment noise', () => {
    const s = threadSummaryLine({ initialPrompt: '[Attached Files: bank.csv]\nWhy did my balance drop?' });
    expect(s).toMatch(/Why did my balance drop\?/);
    expect(s).not.toMatch(/Attached Files/);
  });

  it('clamps long prompts at a word boundary with an ellipsis', () => {
    const s = threadSummaryLine({ initialPrompt: LONG, max: 80 });
    expect(s.length).toBeLessThanOrEqual(81);
    expect(s.endsWith('…')).toBe(true);
  });

  it('returns empty string for empty / non-string input', () => {
    expect(threadSummaryLine({ initialPrompt: '' })).toBe('');
    expect(threadSummaryLine({ initialPrompt: undefined })).toBe('');
    expect(threadSummaryLine({ initialPrompt: 42 as any })).toBe('');
    expect(threadSummaryLine({})).toBe('');
  });
});

describe('oracleThreadLabel', () => {
  it('backfills a generic title from the initial prompt (Title Case)', () => {
    const label = oracleThreadLabel(DEFAULT_ORACLE_TITLE, 'why did my balance drop this month?');
    expect(label).not.toBe(DEFAULT_ORACLE_TITLE);
    expect(label).toMatch(/Balance Drop/i);
  });

  it('backfills are clamped to title length but still differ from the generic default', () => {
    const label = oracleThreadLabel('New Conversation', LONG);
    expect(label).not.toBe('New Conversation');
    expect(label.length).toBeLessThanOrEqual(48); // summarizeTitle's 44-char clamp + ellipsis
  });

  it('keeps the generic title when there is no initial prompt to use', () => {
    expect(oracleThreadLabel('New Conversation', '')).toBe('New Conversation');
    expect(oracleThreadLabel(undefined as any, null)).toMatch(/New Conversation|New Thread|New Deliberation/);
  });

  it('NEVER overrides a real title (user rename)', () => {
    expect(oracleThreadLabel('TQQQ Plan', 'why do I keep forgetting the insurance email?')).toBe('TQQQ Plan');
  });

  it('keeps informational auto-titles like "Council Briefing — Finance"', () => {
    expect(oracleThreadLabel('Council Briefing — Finance', 'long pasted briefing text here')).toBe('Council Briefing — Finance');
  });
});
