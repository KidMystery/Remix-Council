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

  describe('modelCache and storage safety', () => {
    it('prunes voluminous metadata and keeps essential model fields', async () => {
      const { pruneModelForCache, setCachedModels, getCachedModelsWithMetadata } = await import('../modelCache');

      const heavyModel = {
        id: 'meta-llama/llama-3.3-70b-instruct',
        name: 'Llama 3.3 70B Instruct',
        description: 'A very large text description with thousands of characters '.repeat(200),
        pricing: { prompt: '0.0000004', completion: '0.0000008', request: '0' },
        context_length: 131072,
        created: 1700000000,
        benchmarks: { intelligence: 1300, coding: 85 },
        top_provider: { context_length: 131072, max_completion_tokens: 4096, is_moderated: false },
        architecture: { modality: 'text->text', tokenizer: 'llama3' },
        per_request_limits: { prompt_tokens: 100000 },
      };

      const pruned = pruneModelForCache(heavyModel as any);
      expect(pruned.id).toBe('meta-llama/llama-3.3-70b-instruct');
      expect(pruned.name).toBe('Llama 3.3 70B Instruct');
      expect((pruned as any).description).toBeUndefined();
      // Tokenizer and raw tokenizer configs pruned, but modality preserved for vision checks
      expect(pruned.architecture?.modality).toBe('text->text');
      expect((pruned.architecture as any)?.tokenizer).toBeUndefined();
      expect(pruned.context_length).toBe(131072);
      expect(pruned.pricing?.prompt).toBe('0.0000004');

      // Test caching and retrieval
      setCachedModels([pruned]);
      const { models, metadata } = getCachedModelsWithMetadata();
      expect(models).toHaveLength(1);
      expect(models![0].id).toBe('meta-llama/llama-3.3-70b-instruct');
      expect(metadata.cacheStatus).toBe('fresh');

      // Test vision model retains image modality and modelHasVision works after pruning
      const { modelHasVision } = await import('../modelScoring');
      const visionModel = {
        id: 'google/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        architecture: { input_modalities: ['text', 'image'], modality: 'text+image->text' },
      };
      const prunedVision = pruneModelForCache(visionModel as any);
      expect(modelHasVision(prunedVision)).toBe(true);
    });
  });
});

