import { describe, it, expect } from 'vitest';
import { summarizeTitle, isDefaultTitle, DEFAULT_THREAD_TITLE, DEFAULT_ORACLE_TITLE } from '../titleUtils';

describe('summarizeTitle utility', () => {
  it('returns New Deliberation for empty input by default', () => {
    expect(summarizeTitle('')).toBe('New Deliberation');
    expect(summarizeTitle('   ')).toBe('New Deliberation');
    expect(summarizeTitle(null)).toBe('New Deliberation');
    expect(summarizeTitle(undefined, DEFAULT_ORACLE_TITLE)).toBe('New Conversation');
  });

  it('strips conversational filler prefixes and formats clean summaries', () => {
    expect(summarizeTitle('Please analyze this financial statement')).toBe('Analyze this financial statement');
    expect(summarizeTitle('How do I build an async pipeline?')).toBe('Build an async pipeline');
    expect(summarizeTitle('What is quantum computing?')).toBe('Quantum computing');
    expect(summarizeTitle('Can you please tell me how to optimize SQL queries?')).toBe('Optimize SQL queries');
    expect(summarizeTitle('I want to understand transformer attention mechanisms')).toBe('Transformer attention mechanisms');
    expect(summarizeTitle('Hey Oracle, could you help me with a React error?')).toBe('React error');
  });

  it('handles comparison queries gracefully', () => {
    expect(summarizeTitle('What is the difference between Postgres and MySQL?')).toBe('Postgres vs MySQL');
    expect(summarizeTitle('Compare Docker vs Kubernetes for small teams')).toBe('Docker vs Kubernetes for small teams');
  });

  it('preserves and formats known tech acronyms and brand names', () => {
    expect(summarizeTitle('How to set up OAuth in GCP?')).toBe('Set up OAuth in GCP');
    expect(summarizeTitle('Debug memory leak in Node.js server')).toBe('Debug memory leak in Node.js server');
    expect(summarizeTitle('What are the best practices for REST APIs?')).toBe('Best practices for REST APIs');
  });

  it('strips prompt prefixes, markdown headers, and attached file markers', () => {
    expect(summarizeTitle('Prompt: How to configure Vite in TypeScript?')).toBe('Configure Vite in TypeScript');
    expect(summarizeTitle('# Project Proposal: Mobile App Architecture')).toBe('Project Proposal: Mobile App Architecture');
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

  it('accurately identifies default placeholder titles with isDefaultTitle', () => {
    expect(isDefaultTitle('New Deliberation')).toBe(true);
    expect(isDefaultTitle('New Conversation')).toBe(true);
    expect(isDefaultTitle('New Consultation')).toBe(true);
    expect(isDefaultTitle('Untitled Session')).toBe(true);
    expect(isDefaultTitle('Untitled')).toBe(true);
    expect(isDefaultTitle('')).toBe(true);
    expect(isDefaultTitle(null)).toBe(true);
    expect(isDefaultTitle('Architecture Review')).toBe(false);
    expect(isDefaultTitle('Postgres vs MySQL')).toBe(false);
  });
});

