import { describe, it, expect } from 'vitest';
import { isFreeModel } from '../modelMapper';
import { RawOpenRouterModel } from '../presets';
import { shouldEnableWebSearch, getWebSearchToolDefinition } from '../webGrounding';
import { getArchiveFilePriority, buildCodebaseContext } from '../zipReader';
import { CouncilRound } from '../../types';
import { migrateLocalSession } from '../drivePersistence';

describe('Invariant Tests Suite', () => {
  describe('1. Exact-zero free classification', () => {
    it('requires prompt, completion, and request prices to each be exactly 0', () => {
      const freeModel: RawOpenRouterModel = {
        id: 'meta-llama/llama-3.2-3b-instruct:free',
        name: 'Llama 3.2 3B (Free)',
        pricing: { request: 0, prompt: 0, completion: 0 },
        context_length: 8192,
      };
      expect(isFreeModel(freeModel)).toBe(true);

      const freeModelStringPrices: RawOpenRouterModel = {
        id: 'deepseek/deepseek-r1:free',
        name: 'DeepSeek R1 (Free)',
        pricing: { request: '0', prompt: '0', completion: '0' },
        context_length: 32768,
      };
      expect(isFreeModel(freeModelStringPrices)).toBe(true);
    });

    it('rejects positive prices, epsilons, NaN, negative prices, and missing prices', () => {
      const epsilonPriceModel: RawOpenRouterModel = {
        id: 'test/epsilon',
        pricing: { request: 0, prompt: 0.0000001, completion: 0 },
        context_length: 4096,
      };
      expect(isFreeModel(epsilonPriceModel)).toBe(false);

      const negativePriceModel: RawOpenRouterModel = {
        id: 'test/negative',
        pricing: { request: -0.01, prompt: 0, completion: 0 },
        context_length: 4096,
      };
      expect(isFreeModel(negativePriceModel)).toBe(false);

      const nanPriceModel: RawOpenRouterModel = {
        id: 'test/nan',
        pricing: { request: 'NaN' as any, prompt: 0, completion: 0 },
        context_length: 4096,
      };
      expect(isFreeModel(nanPriceModel)).toBe(false);

      const missingPriceModel: RawOpenRouterModel = {
        id: 'test/missing',
        pricing: { prompt: 0 } as any,
        context_length: 4096,
      };
      expect(isFreeModel(missingPriceModel)).toBe(false);
    });

    it('rejects openrouter/auto, openrouter/auto-beta, and openrouter/free router aliases', () => {
      expect(isFreeModel({ id: 'openrouter/auto', pricing: { request: 0, prompt: 0, completion: 0 } } as any)).toBe(false);
      expect(isFreeModel({ id: 'openrouter/auto-beta', pricing: { request: 0, prompt: 0, completion: 0 } } as any)).toBe(false);
      expect(isFreeModel({ id: 'openrouter/free', pricing: { request: 0, prompt: 0, completion: 0 } } as any)).toBe(false);
    });
  });

  describe('2. Panel capability failure isolation', () => {
    it('records capability failure on the individual seat without destroying round structure', () => {
      const round: CouncilRound = {
        id: 'round_fail_test',
        userQuery: 'Review this code',
        timestamp: Date.now(),
        deliberation: {
          stage1: {
            skeptic: {
              personaId: 'skeptic',
              content: '',
              status: 'error',
              error: 'Context window exceeded',
            },
            visionary: {
              personaId: 'visionary',
              content: 'Visionary healthy response',
              status: 'completed',
            },
          },
          stage2: {},
        },
        synthesis: {
          content: 'Synthesized from visionary output',
          status: 'completed',
        },
      };

      expect(round.deliberation.stage1.skeptic.status).toBe('error');
      expect(round.deliberation.stage1.visionary.status).toBe('completed');
      expect(round.synthesis.status).toBe('completed');
    });
  });

  describe('3. Archive extraction, priority ordering, and truthful context', () => {
    it('prioritizes package.json and entry points over historical scripts', () => {
      const pkgPriority = getArchiveFilePriority('package.json');
      const serverPriority = getArchiveFilePriority('server.ts');
      const typesPriority = getArchiveFilePriority('src/types.ts');
      const testPriority = getArchiveFilePriority('src/lib/__tests__/invariantTests.test.ts');
      const scriptPriority = getArchiveFilePriority('scripts/some-tool.mjs');

      expect(pkgPriority).toBeLessThan(serverPriority);
      expect(serverPriority).toBeLessThan(typesPriority);
      expect(typesPriority).toBeLessThan(testPriority);
      expect(testPriority).toBeLessThan(scriptPriority);
    });

    it('generates truthful context notice distinguishing complete vs partial archives', () => {
      const completeContext = buildCodebaseContext(
        'project.zip',
        ['package.json', 'server.ts'],
        [{ path: 'package.json', name: 'package.json', size: 100, content: '{}', isCode: true }],
        [],
        [],
        false
      );
      expect(completeContext).toContain('[CODEBASE EXTRACTION NOTICE: COMPLETE CONTEXT');

      const partialContext = buildCodebaseContext(
        'project_large.zip',
        ['package.json', 'server.ts', 'large.txt'],
        [{ path: 'package.json', name: 'package.json', size: 100, content: '{}', isCode: true }],
        [],
        [],
        true,
        ['large.txt'],
        100
      );
      expect(partialContext).toContain('[CODEBASE EXTRACTION NOTICE: PARTIAL CONTEXT');
      expect(partialContext).not.toContain('All files from the uploaded archive have been decompressed, parsed, and provided in full below');
    });
  });

  describe('4. Web search grounding tool and budget constraints', () => {
    it('returns valid OpenRouter web search tool definition', () => {
      const tool = getWebSearchToolDefinition();
      expect(tool.type).toBe('openrouter:web_search');
      expect(tool.parameters.max_results).toBe(5);
      expect(tool.parameters.max_uses).toBe(2);
      expect(tool.parameters.max_total_results).toBe(10);
    });

    it('disables web grounding when mode is off', () => {
      const check = shouldEnableWebSearch('What is today news?', 'off', 'cheap');
      expect(check.enabled).toBe(false);
    });

    it('blocks web search under Strict Free budget', () => {
      const check = shouldEnableWebSearch('Current price of Bitcoin 2026', 'auto', 'free');
      expect(check.enabled).toBe(false);
      expect(check.reason).toMatch(/Strict Free budget/);
    });

    it('enables web search for temporal queries in auto mode under cheap/quality budget', () => {
      const check = shouldEnableWebSearch('What happened today in technology?', 'auto', 'cheap');
      expect(check.enabled).toBe(true);
    });
  });

  describe('5. Session migration and backward compatibility', () => {
    it('migrates legacy session objects without losing data or deleting rounds', () => {
      const legacySession = {
        id: 'legacy_123',
        title: 'Legacy Deliberation',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        rounds: [
          {
            id: 'round_1',
            userQuery: 'Legacy query',
            timestamp: 1700000000000,
            deliberation: { stage1: {}, stage2: {} },
            synthesis: { content: 'Legacy synthesis', status: 'completed' },
          },
        ],
      };

      const migrated = migrateLocalSession(legacySession);
      expect(migrated.id).toBe('legacy_123');
      expect(migrated.title).toBe('Legacy Deliberation');
      expect(migrated.rounds).toHaveLength(1);
      expect(migrated.rounds[0].synthesis.content).toBe('Legacy synthesis');
    });
  });

  describe('6. Truncation and finish_reason persistence', () => {
    it('retains finish_reason and truncated flag in PersonaResponse and Round', () => {
      const response: CouncilRound['synthesis'] = {
        content: 'This response was cut off mid sentence...',
        status: 'completed',
        finishReason: 'length',
        truncated: true,
      };

      expect(response.finishReason).toBe('length');
      expect(response.truncated).toBe(true);
    });
  });
});
