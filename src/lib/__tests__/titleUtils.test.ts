import { describe, it, expect } from 'vitest';
import { summarizeTitle } from '../titleUtils';

describe('summarizeTitle utility', () => {
  it('returns New Deliberation for empty input', () => {
    expect(summarizeTitle('')).toBe('New Deliberation');
  });

  it('strips conversational filler prefixes', () => {
    expect(summarizeTitle('Please analyze this financial statement')).toBe('Analyze this financial statement');
    expect(summarizeTitle('How do I build an async pipeline?')).toBe('Build an async pipeline');
    expect(summarizeTitle('What is quantum computing?')).toBe('Quantum computing');
  });

  it('strips attached file markers', () => {
    const text = 'What do you think? [Attached File: report.pdf]';
    expect(summarizeTitle(text)).not.toContain('[Attached File:');
  });

  it('limits word count and length cleanly with ellipsis', () => {
    const longQuery = 'Explain the profound implications of multi-agent distributed consensus algorithms in high latency Byzantine fault tolerant networks';
    const title = summarizeTitle(longQuery);
    expect(title.endsWith('...')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(45);
  });

  it('titles a long rant from the ask at the end, not the first five words', () => {
    const rant = `So yesterday I took the Honda in and the guy behind the counter started talking about a solenoid and fluid flushes and how the transmission is slipping on the highway. I sat there for forty minutes. Anyway I need a plan to fix my car without going broke.`;
    const title = summarizeTitle(rant);
    expect(title.toLowerCase()).toMatch(/car|plan|fix|transmission/);
    expect(title.toLowerCase()).not.toMatch(/^so yesterday/);
  });
});
