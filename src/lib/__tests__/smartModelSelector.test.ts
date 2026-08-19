import { describe, it, expect } from 'vitest';
import {
  detectTaskDomain,
  getModelFamily,
  getModelOrg,
  routeCouncilModels,
} from '../smartModelSelector';
import { FREE_POLICY, DEFAULT_POLICY } from '../executionPolicy';
import type { CouncilPersona, RawOpenRouterModel } from '../../types';

describe('smartModelSelector', () => {
  describe('detectTaskDomain', () => {
    it('detects coding tasks from query keywords', () => {
      expect(detectTaskDomain('Refactor this typescript async function and fix bug')).toBe('coding');
      expect(detectTaskDomain('Create a new SQL database schema for users')).toBe('coding');
    });

    it('detects security audit tasks', () => {
      expect(detectTaskDomain('Perform a security audit and vulnerability check on auth')).toBe('security_audit');
    });

    it('detects math tasks', () => {
      expect(detectTaskDomain('Calculate probability and solve the math proof')).toBe('math_reasoning');
    });

    it('detects creative tasks', () => {
      expect(detectTaskDomain('Brainstorm a creative story plot')).toBe('creative');
    });

    it('defaults to general', () => {
      expect(detectTaskDomain('What is the weather today?')).toBe('general');
    });
  });

  describe('getModelOrg and getModelFamily', () => {
    it('extracts org correctly', () => {
      expect(getModelOrg('google/gemini-2.0-flash')).toBe('google');
      expect(getModelOrg('anthropic/claude-3.7-sonnet')).toBe('anthropic');
      expect(getModelOrg('openai/o3-mini')).toBe('openai');
    });

    it('extracts family correctly', () => {
      expect(getModelFamily('google/gemini-2.0-flash')).toBe('gemini');
      expect(getModelFamily('meta-llama/llama-3.3-70b-instruct')).toBe('llama');
      expect(getModelFamily('anthropic/claude-3.7-sonnet')).toBe('claude');
      expect(getModelFamily('qwen/qwen-2.5-72b')).toBe('qwen');
    });
  });

  describe('routeCouncilModels', () => {
    const mockPersonas: CouncilPersona[] = [
      { id: '1', name: 'Analyst', role: 'Security Auditor', systemPrompt: '', model: 'anthropic/claude-3.7-sonnet' },
      { id: '2', name: 'Engineer', role: 'Lead Engineer', systemPrompt: '', model: 'deepseek/deepseek-r1' },
      { id: '3', name: 'Strategist', role: 'Executive Strategist', systemPrompt: '', model: 'openai/o3-mini' },
    ];

    const mockCatalog: RawOpenRouterModel[] = [
      { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini Free', pricing: { prompt: '0', completion: '0' } },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama Free', pricing: { prompt: '0', completion: '0' } },
      { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen Free', pricing: { prompt: '0', completion: '0' } },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', pricing: { prompt: '0.0000005', completion: '0.000002' } },
      { id: 'openai/o3-mini', name: 'o3-mini', pricing: { prompt: '0.000001', completion: '0.000004' } },
    ];

    it('routes models properly under quality policy', () => {
      const routed = routeCouncilModels(mockPersonas, DEFAULT_POLICY, mockCatalog, 'Debug this typescript function');
      expect(routed).toHaveLength(3);
      expect(routed.every((p) => p.model)).toBe(true);
    });

    it('substitutes free models under free policy', () => {
      const routed = routeCouncilModels(mockPersonas, FREE_POLICY, mockCatalog, 'General question');
      expect(routed).toHaveLength(3);
      expect(routed.every((p) => p.model.endsWith(':free'))).toBe(true);
    });
  });
});
