import { describe, it, expect } from 'vitest';
import { classifyQueryMode, resolveExecutionMode } from '../modeClassifier';
import { getFamily } from '../modelMapper';
import { routeCouncilModels } from '../smartModelSelector';
import { computeOrderedBackupList } from '../fallbackManager';
import { Persona } from '../../types';

describe('Pure Functions Tests', () => {
  describe('classifyQueryMode', () => {
    it('classifies deep/complex queries as deep_council', () => {
      expect(classifyQueryMode('Can you analyze the architecture and security tradeoffs of this database?')).toBe('deep_council');
      expect(classifyQueryMode('Debug this race condition in my legal contract review engine')).toBe('deep_council');
    });

    it('classifies code/PDF attached files as deep_council', () => {
      const mode = classifyQueryMode('What does this file do?', [
        { name: 'schema.sql', content: 'CREATE TABLE users (id INT);' }
      ]);
      expect(mode).toBe('deep_council');
    });

    it('classifies simple questions and quick requests as quick_panel', () => {
      expect(classifyQueryMode('Give me a 3-bullet summary of apples')).toBe('quick_panel');
      expect(classifyQueryMode('What is the capital of France?')).toBe('quick_panel');
      expect(classifyQueryMode('Rewrite this headline to be punchy')).toBe('quick_panel');
    });
  });

  describe('resolveExecutionMode', () => {
    it('respects explicit mode overrides', () => {
      expect(resolveExecutionMode('quick_panel', 'Analyze deep quantum mechanics')).toBe('quick_panel');
      expect(resolveExecutionMode('deep_council', 'What is 2+2?')).toBe('deep_council');
    });

    it('falls back to classifyQueryMode when mode is auto', () => {
      expect(resolveExecutionMode('auto', 'Debug code')).toBe('deep_council');
      expect(resolveExecutionMode('auto', 'Summarize this')).toBe('quick_panel');
    });
  });

  describe('getFamily', () => {
    it('extracts canonical model family correctly', () => {
      expect(getFamily('google/gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
      expect(getFamily('google/gemini-2.0-flash-thinking-exp:free')).toBe('google/gemini-2.0-flash-thinking');
      expect(getFamily('anthropic/claude-3.5-haiku')).toBe('anthropic/claude-3.5-haiku');
      expect(getFamily('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    });
  });

  describe('routeCouncilModels', () => {
    it('returns a valid council routing result with assignments and updated personas', () => {
      const personas: Persona[] = [
        { id: 'skeptic', name: 'Skeptic', role: 'Critic', avatar: '🛡️', model: 'google/gemini-2.5-flash', systemPrompt: '', color: '' },
        { id: 'visionary', name: 'Visionary', role: 'Innovator', avatar: '💡', model: 'anthropic/claude-3.5-haiku', systemPrompt: '', color: '' },
        { id: 'pragmatist', name: 'Pragmatist', role: 'Engineer', avatar: '🛠️', model: 'openai/gpt-4o-mini', systemPrompt: '', color: '' },
      ];
      const synthesizer: Persona = {
        id: 'synthesizer', name: 'Synthesizer', role: 'Chairman', avatar: '⚖️', model: 'google/gemini-2.5-pro', systemPrompt: '', color: ''
      };

      const result = routeCouncilModels({
        domain: 'finance',
        personas,
        synthesizer,
      });

      expect(result.assignments).toBeDefined();
      expect(result.updatedPersonas).toHaveLength(3);
      expect(result.updatedSynthesizer).toBeDefined();
    });
  });

  describe('computeOrderedBackupList', () => {
    it('generates backup candidates excluding failed model and current active models', () => {
      const personas: Persona[] = [
        { id: 'skeptic', name: 'Skeptic', role: 'Critic', avatar: '🛡️', model: 'google/gemini-2.5-flash', systemPrompt: '', color: '' },
        { id: 'visionary', name: 'Visionary', role: 'Innovator', avatar: '💡', model: 'anthropic/claude-3.5-haiku', systemPrompt: '', color: '' },
        { id: 'pragmatist', name: 'Pragmatist', role: 'Engineer', avatar: '🛠️', model: 'openai/gpt-4o-mini', systemPrompt: '', color: '' },
      ];

      const backups = computeOrderedBackupList({
        activePersonas: personas,
        failingPersonaId: 'skeptic',
      });

      expect(Array.isArray(backups)).toBe(true);
      expect(backups.length).toBeGreaterThan(0);
      const backupModels = backups.map(b => b.model);
      expect(backupModels).not.toContain('google/gemini-2.5-flash');
    });
  });
});
