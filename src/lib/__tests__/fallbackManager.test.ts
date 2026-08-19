import { describe, it, expect, beforeEach } from 'vitest';
import { FallbackManager } from '../fallbackManager';
import { FREE_POLICY, DEFAULT_POLICY } from '../executionPolicy';
import type { RawOpenRouterModel } from '../../types';

describe('FallbackManager', () => {
  let fallbackManager: FallbackManager;

  beforeEach(() => {
    fallbackManager = new FallbackManager();
    fallbackManager.clearAuditLog();
  });

  const mockCatalog: RawOpenRouterModel[] = [
    { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Free', pricing: { prompt: '0', completion: '0' } },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 Free', pricing: { prompt: '0', completion: '0' } },
    { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 Free', pricing: { prompt: '0', completion: '0' } },
    { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', pricing: { prompt: '0.0000005', completion: '0.000002' } },
  ];

  it('computes ordered backup list respecting free policy', () => {
    const backups = fallbackManager.computeOrderedBackupList(
      'google/gemini-2.0-flash-exp:free',
      FREE_POLICY,
      mockCatalog
    );

    expect(backups.length).toBeGreaterThan(0);
    expect(backups).not.toContain('google/gemini-2.0-flash-exp:free');
    expect(backups).toContain('meta-llama/llama-3.3-70b-instruct:free');
    expect(backups).not.toContain('anthropic/claude-3.7-sonnet');
  });

  it('computes ordered backup list under quality policy', () => {
    const backups = fallbackManager.computeOrderedBackupList(
      'anthropic/claude-3.7-sonnet',
      DEFAULT_POLICY,
      mockCatalog
    );

    expect(backups.length).toBe(mockCatalog.length - 1);
    expect(backups).not.toContain('anthropic/claude-3.7-sonnet');
  });

  it('executes fallback when primary model fails', async () => {
    let callCount = 0;
    const result = await fallbackManager.executeWithFallback(
      'anthropic/claude-3.7-sonnet',
      DEFAULT_POLICY,
      mockCatalog,
      async (targetModel) => {
        callCount++;
        if (targetModel === 'anthropic/claude-3.7-sonnet') {
          throw new Error('503 Service Unavailable');
        }
        return `Success from ${targetModel}`;
      }
    );

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(result).toContain('Success from');
    expect(fallbackManager.getAuditLog().length).toBeGreaterThan(0);
  });
});
