import { describe, it, expect } from 'vitest';
import {
  detectTaskDomain,
  applySmartModelSelection,
  DOMAIN_MODEL_MAPPINGS,
  TaskDomain,
} from '../smartModelSelector';
import { Persona } from '../../types';

describe('Smart Model Selector tests', () => {
  const mockPersonas: Persona[] = [
    { id: 'skeptic', name: 'Skeptic', role: 'Critic', avatar: '🛡️', model: 'google/gemini-2.5-flash', systemPrompt: '', color: '' },
    { id: 'visionary', name: 'Visionary', role: 'Innovator', avatar: '💡', model: 'anthropic/claude-3.5-haiku', systemPrompt: '', color: '' },
    { id: 'pragmatist', name: 'Pragmatist', role: 'Engineer', avatar: '🛠️', model: 'openai/gpt-4o-mini', systemPrompt: '', color: '' },
  ];
  const mockSynthesizer: Persona = {
    id: 'synthesizer', name: 'Synthesizer', role: 'Chairman', avatar: '⚖️', model: 'google/gemini-2.5-pro', systemPrompt: '', color: ''
  };

  describe('detectTaskDomain', () => {
    it('detects coding tasks from query keywords', () => {
      expect(detectTaskDomain('How do I refactor this React TypeScript function with async await?')).toBe('code');
      expect(detectTaskDomain('Debug this syntax error in python')).toBe('code');
    });

    it('detects coding tasks from attached code files', () => {
      const result = detectTaskDomain('Review this', [
        { name: 'App.tsx', content: 'export const App = () => <div/>;' }
      ]);
      expect(result).toBe('code');
    });

    it('detects finance tasks', () => {
      expect(detectTaskDomain('Analyze our Q3 EBITDA, balance sheet, and revenue growth')).toBe('finance');
    });

    it('detects creative writing tasks', () => {
      expect(detectTaskDomain('Write a fictional story about a space explorer')).toBe('creative');
    });

    it('detects math calculations', () => {
      expect(detectTaskDomain('Calculate the integral of sin(x) dx and solve the derivative equation')).toBe('math');
    });

    it('falls back to general domain for general queries', () => {
      expect(detectTaskDomain('What is the weather like in spring?')).toBe('general');
    });
  });

  describe('applySmartModelSelection', () => {
    it('generates optimal persona and synthesizer assignments for a domain', () => {
      const result = applySmartModelSelection('code', mockPersonas, mockSynthesizer, {
        availableModels: [
          { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
          { id: 'openai/gpt-4o', name: 'GPT-4o' },
          { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
          { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
        ],
        rawModelsCatalog: [],
        isFreeOnly: false,
        autoSelectModels: true,
      });

      expect(result.domain).toBe('code');
      expect(result.updatedPersonas).toHaveLength(3);
      expect(result.updatedSynthesizer).toBeDefined();
      expect(result.assignments).toBeDefined();
    });

    it('respects isFreeOnly filter when fast_and_free is selected', () => {
      const result = applySmartModelSelection('finance', mockPersonas, mockSynthesizer, {
        availableModels: [
          { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
          { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 Free' },
        ],
        rawModelsCatalog: [],
        isFreeOnly: true,
        autoSelectModels: true,
      });

      expect(result.autoSelectEnabled).toBe(true);
      expect(result.domain).toBe('finance');
    });
  });

  describe('DOMAIN_MODEL_MAPPINGS', () => {
    it('defines mappings for all standard task domains', () => {
      const domains: TaskDomain[] = ['code', 'math', 'finance', 'creative', 'general'];
      domains.forEach((d) => {
        expect(DOMAIN_MODEL_MAPPINGS[d]).toBeDefined();
        expect(DOMAIN_MODEL_MAPPINGS[d].synthesizer).toBeDefined();
      });
    });
  });
});
