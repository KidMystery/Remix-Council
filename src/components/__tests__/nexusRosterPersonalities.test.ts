import './setupDom';
import { describe, it, expect } from 'vitest';
import { getPresetRoster } from '../NexusLabView';
import type { Persona } from '../../types';

describe('Nexus Roster Personalities — no hardcoded model branding', () => {
  const dummyBasePersonas: Persona[] = [];
  const dummyBaseSynthesizer: Persona = {
    id: 'base_synth',
    name: 'Base Chair',
    role: 'Chair',
    avatar: '⚖️',
    color: '#000',
    model: 'test/model',
    systemPrompt: 'Base prompt',
    enabled: true,
  };

  const forbiddenBrandPatterns = [
    /\bclaude\b/i,
    /\bsonnet\b/i,
    /\bgpt-?4\b/i,
    /\bchatgpt\b/i,
    /\bgemini\b/i,
    /\bdeepseek\b/i,
    /\br1\b/i,
  ];

  it('frontier_trio contains pure analytical roles with zero model brand leaks in prompts or names or ids', () => {
    const roster = getPresetRoster('frontier_trio', dummyBasePersonas, dummyBaseSynthesizer);

    expect(roster.personas).toHaveLength(3);
    for (const p of roster.personas) {
      for (const pattern of forbiddenBrandPatterns) {
        expect(p.systemPrompt, `Persona prompt must not leak model brand (${pattern})`).not.toMatch(pattern);
        expect(p.name, `Persona name must not leak model brand (${pattern})`).not.toMatch(pattern);
        expect(p.id, `Persona id must not leak model brand (${pattern})`).not.toMatch(pattern);
      }
    }

    expect(roster.personas.map((p) => p.name)).toEqual([
      'The Architect',
      'The Executor',
      'The Verifier',
    ]);
  });

  it('deep_reasoning contains pure analytical roles with zero model brand leaks in prompts or names or ids', () => {
    const roster = getPresetRoster('deep_reasoning', dummyBasePersonas, dummyBaseSynthesizer);

    expect(roster.personas).toHaveLength(3);
    for (const p of roster.personas) {
      for (const pattern of forbiddenBrandPatterns) {
        expect(p.systemPrompt, `Persona prompt must not leak model brand (${pattern})`).not.toMatch(pattern);
        expect(p.name, `Persona name must not leak model brand (${pattern})`).not.toMatch(pattern);
        expect(p.id, `Persona id must not leak model brand (${pattern})`).not.toMatch(pattern);
      }
    }

    expect(roster.personas.map((p) => p.name)).toEqual([
      'The First-Principles Analyst',
      'The System Designer',
      'The Context Synthesist',
    ]);
  });
});
