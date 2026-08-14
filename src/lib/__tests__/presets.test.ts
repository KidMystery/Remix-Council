import { describe, it, expect } from 'vitest';
import {
  applyPreset,
  checkDuplicateModels,
  cleanModelName,
  updatePresetsFromFetchedModels,
  MODEL_PRESETS,
} from '../presets';
import { Persona } from '../../types';

describe('Preset and model utilities', () => {
  const basePersonas: Persona[] = [
    { id: 'skeptic', name: 'Skeptic', role: 'Critic', avatar: '🛡️', model: 'google/gemini-2.5-flash', systemPrompt: '', color: '' },
    { id: 'visionary', name: 'Visionary', role: 'Innovator', avatar: '💡', model: 'anthropic/claude-3.5-haiku', systemPrompt: '', color: '' },
    { id: 'pragmatist', name: 'Pragmatist', role: 'Engineer', avatar: '🛠️', model: 'openai/gpt-4o-mini', systemPrompt: '', color: '' },
  ];
  const baseSynthesizer: Persona = {
    id: 'synthesizer', name: 'Synthesizer', role: 'Chairman', avatar: '⚖️', model: 'google/gemini-2.5-pro', systemPrompt: '', color: ''
  };

  describe('applyPreset', () => {
    it('applies fast_and_free preset assigning free models', () => {
      const { updatedPersonas, updatedSynthesizer } = applyPreset('fast_and_free', basePersonas, baseSynthesizer);
      expect(updatedPersonas).toHaveLength(3);
      updatedPersonas.forEach((p) => {
        expect(p.model).toBeDefined();
      });
      expect(updatedSynthesizer.model).toBeDefined();
    });

    it('applies highest_quality preset', () => {
      const { updatedPersonas, updatedSynthesizer } = applyPreset('highest_quality', basePersonas, baseSynthesizer);
      expect(updatedPersonas).toHaveLength(3);
      expect(updatedSynthesizer.model).toBeDefined();
    });
  });

  describe('checkDuplicateModels', () => {
    it('detects duplicate models in persona list', () => {
      const duplicatePersonas: Persona[] = [
        { ...basePersonas[0], model: 'google/gemini-2.5-flash' },
        { ...basePersonas[1], model: 'google/gemini-2.5-flash' },
        { ...basePersonas[2], model: 'openai/gpt-4o-mini' },
      ];
      const result = checkDuplicateModels(duplicatePersonas, baseSynthesizer);
      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicates).toContain('google/gemini-2.5-flash');
    });

    it('returns empty warnings when all models are distinct', () => {
      const distinctPersonas: Persona[] = [
        { ...basePersonas[0], model: 'google/gemini-2.5-flash' },
        { ...basePersonas[1], model: 'anthropic/claude-3.5-haiku' },
        { ...basePersonas[2], model: 'openai/gpt-4o-mini' },
      ];
      const distinctSynth: Persona = { ...baseSynthesizer, model: 'meta-llama/llama-3.3-70b-instruct' };
      const result = checkDuplicateModels(distinctPersonas, distinctSynth);
      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicates).toHaveLength(0);
    });
  });

  describe('cleanModelName', () => {
    it('returns clean human-readable name', () => {
      expect(cleanModelName('google/gemini-2.5-flash', 'Gemini 2.5 Flash')).toBe('Gemini 2.5 Flash');
      expect(cleanModelName('deepseek/deepseek-r1:free', 'DeepSeek R1')).toContain('DeepSeek');
    });

    it('formats raw model id if no name is given', () => {
      const cleaned = cleanModelName('anthropic/claude-3-7-sonnet');
      expect(cleaned).toBeDefined();
      expect(cleaned.length).toBeGreaterThan(0);
    });
  });

  describe('updatePresetsFromFetchedModels', () => {
    it('updates presets safely from catalog without breaking existing presets', () => {
      const mockCatalog = [
        { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', pricing: { prompt: '0', completion: '0' } },
        { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
      ];
      expect(() => updatePresetsFromFetchedModels(mockCatalog)).not.toThrow();
    });
  });
});
