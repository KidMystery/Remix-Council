import { describe, it, expect } from 'vitest';
import { isFreeModel, sanitizeAndResolveModel } from '../modelMapper';
import { FREE_POLICY, DEFAULT_POLICY, policyForPreset, isFreeModelId } from '../executionPolicy';
import { ARCHETYPES, instantiateArchetype } from '../archetypes';

describe('Pure Function Utilities', () => {
  describe('modelMapper', () => {
    it('detects free models based on pricing and suffix', () => {
      expect(isFreeModel({ id: 'google/gemini-2.0-flash:free', name: 'Gemini Free', pricing: { prompt: '0', completion: '0' } })).toBe(true);
      expect(isFreeModel({ id: 'anthropic/claude-3.7-sonnet', name: 'Claude', pricing: { prompt: '0.000003', completion: '0.000015' } })).toBe(false);
    });

    it('sanitizes model names', () => {
      expect(sanitizeAndResolveModel('  openai/gpt-4o  ')).toBe('openai/gpt-4o');
      expect(() => sanitizeAndResolveModel('')).toThrow();
    });
  });

  describe('executionPolicy', () => {
    it('returns FREE_POLICY for fast_and_free', () => {
      const p = policyForPreset('fast_and_free');
      expect(p.budget).toBe('free');
      expect(p.allowProviderFallback).toBe(false);
    });

    it('returns DEFAULT_POLICY for deep_council', () => {
      const p = policyForPreset('deep_council');
      expect(p.budget).toBe('quality');
      expect(p.allowProviderFallback).toBe(true);
    });

    it('verifies free model ids', () => {
      expect(isFreeModelId('google/gemini-2.0-flash-exp:free')).toBe(true);
      expect(isFreeModelId('anthropic/claude-3.7-sonnet')).toBe(false);
    });
  });

  describe('archetypes', () => {
    it('contains diverse archetypes', () => {
      expect(ARCHETYPES.length).toBeGreaterThanOrEqual(5);
      expect(ARCHETYPES.some((a) => a.category === 'security')).toBe(true);
      expect(ARCHETYPES.some((a) => a.category === 'architecture')).toBe(true);
      expect(ARCHETYPES.some((a) => a.category === 'finance')).toBe(true);
    });

    it('instantiates persona from archetype', () => {
      const arch = ARCHETYPES[0];
      const persona = instantiateArchetype(arch);
      expect(persona.name).toBe(arch.name);
      expect(persona.role).toBe(arch.role);
      expect(persona.model).toBe(arch.recommendedModel);
      expect(persona.systemPrompt).toBe(arch.systemPrompt);
    });
  });
});
