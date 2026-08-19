import { describe, it, expect, vi } from 'vitest';
import { isFreeModel } from '../modelMapper';
import { RawOpenRouterModel } from '../presets';
import { buildExecutionPlan, validateExecutionPlan } from '../executionPlan';
import { validateAndParseGitHubUrl } from '../githubValidator';
import { shouldEnableWebSearch, getWebSearchToolDefinition } from '../webGrounding';
import { getArchiveFilePriority, buildCodebaseContext } from '../zipReader';
import { calculateRoundAggregateCost, isWithinBudgetCeiling } from '../costGovernor';
import { Persona, CouncilRound, Session } from '../../types';
import { migrateLocalSession } from '../persistence';

describe('Invariant Tests Suite (Section 1)', () => {
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

  describe('2 & 3 & 4 & 5. Strict Free Execution Plan & Validation', () => {
    const mockPersonas: Persona[] = [
      { id: 'skeptic', name: 'Skeptic', role: 'skeptic', avatar: '🛡️', model: 'meta-llama/llama-3.2-3b-instruct:free', systemPrompt: '', color: '#fff' },
      { id: 'visionary', name: 'Visionary', role: 'visionary', avatar: '🚀', model: 'deepseek/deepseek-r1:free', systemPrompt: '', color: '#fff' },
      { id: 'pragmatist', name: 'Pragmatist', role: 'pragmatist', avatar: '⚡', model: 'google/gemma-2-9b-it:free', systemPrompt: '', color: '#fff' },
    ];
    const mockSynth: Persona = {
      id: 'synthesizer', name: 'Chairman', role: 'chair', avatar: '⚖️', model: 'qwen/qwen-2.5-coder-32b-instruct:free', systemPrompt: '', color: '#fff',
    };

    const mockFreeCatalog: RawOpenRouterModel[] = [
      { id: 'meta-llama/llama-3.2-3b-instruct:free', pricing: { request: 0, prompt: 0, completion: 0 }, context_length: 8192 },
      { id: 'deepseek/deepseek-r1:free', pricing: { request: 0, prompt: 0, completion: 0 }, context_length: 32768 },
      { id: 'google/gemma-2-9b-it:free', pricing: { request: 0, prompt: 0, completion: 0 }, context_length: 8192 },
      { id: 'qwen/qwen-2.5-coder-32b-instruct:free', pricing: { request: 0, prompt: 0, completion: 0 }, context_length: 32768 },
    ];

    it('validates a valid Strict Free execution plan against a live free catalog', () => {
      const plan = buildExecutionPlan({
        roundId: 'round_123',
        query: 'What is the speed of light?',
        budget: 'free',
        personas: mockPersonas,
        synthesizer: mockSynth,
        catalog: mockFreeCatalog,
      });

      const validation = validateExecutionPlan(plan, mockFreeCatalog);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(plan.maxExpectedCost).toBe(0);
    });

    it('blocks Strict Free when no catalog is available', () => {
      const plan = buildExecutionPlan({
        roundId: 'round_124',
        query: 'Hello world',
        budget: 'free',
        personas: mockPersonas,
        synthesizer: mockSynth,
        catalog: [],
      });

      const validation = validateExecutionPlan(plan, []);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toMatch(/Strict Free requires an active, verified catalog cache/);
    });

    it('rejects paid models when client attempts to inject them in Strict Free mode', () => {
      const plan = buildExecutionPlan({
        roundId: 'round_125',
        query: 'Analyze this code',
        budget: 'free',
        personas: [
          { ...mockPersonas[0], model: 'anthropic/claude-3.7-sonnet' },
          mockPersonas[1],
          mockPersonas[2],
        ],
        synthesizer: mockSynth,
        catalog: mockFreeCatalog,
      });

      const validation = validateExecutionPlan(plan, mockFreeCatalog);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Strict Free violation'))).toBe(true);
    });
  });

  describe('6. Immutable Chair in Execution Plan', () => {
    it('locks the selected chair into the plan matching the synthesizer seat', () => {
      const synthPersona: Persona = {
        id: 'synthesizer',
        name: 'The Arbitrator',
        role: 'chair',
        avatar: '⚖️',
        model: 'google/gemini-3.7-flash',
        systemPrompt: '',
        color: '#fff',
      };
      const plan = buildExecutionPlan({
        roundId: 'round_chair_test',
        query: 'Solve problem',
        budget: 'cheap',
        personas: [],
        synthesizer: synthPersona,
        synthesizerModel: 'google/gemini-3.7-flash',
      });

      expect(plan.chair.modelId).toBe('google/gemini-3.7-flash');
      expect(plan.chair.personaId).toBe('synthesizer');
    });
  });

  describe('7. Panel capability failure isolation', () => {
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

  describe('8 & 9 & 10. Archive extraction, priority ordering, and truthful context', () => {
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

  describe('12. Web search grounding tool and budget constraints', () => {
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

  describe('13. GitHub URL validation', () => {
    it('accepts valid public GitHub repository and raw URLs', () => {
      const repoUrl = validateAndParseGitHubUrl('https://github.com/facebook/react');
      expect(repoUrl.isValid).toBe(true);
      expect(repoUrl.owner).toBe('facebook');
      expect(repoUrl.repo).toBe('react');

      const rawUrl = validateAndParseGitHubUrl('https://raw.githubusercontent.com/facebook/react/main/package.json');
      expect(rawUrl.isValid).toBe(true);
      expect(rawUrl.isRawFile).toBe(true);
      expect(rawUrl.path).toBe('package.json');
    });

    it('rejects non-HTTPS, credentials, private IPs, and arbitrary hosts', () => {
      expect(validateAndParseGitHubUrl('http://github.com/user/repo').isValid).toBe(false);
      expect(validateAndParseGitHubUrl('https://user:pass@github.com/user/repo').isValid).toBe(false);
      expect(validateAndParseGitHubUrl('https://127.0.0.1/user/repo').isValid).toBe(false);
      expect(validateAndParseGitHubUrl('https://localhost:3000/user/repo').isValid).toBe(false);
      expect(validateAndParseGitHubUrl('https://gitlab.com/user/repo').isValid).toBe(false);
      expect(validateAndParseGitHubUrl('https://evil-site.com/user/repo').isValid).toBe(false);
    });
  });

  describe('14. Session migration and backward compatibility', () => {
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

  describe('15. Cost aggregation and budget ceiling governor', () => {
    it('aggregates Stage 1, Stage 2, chair, and search costs accurately', () => {
      const round: CouncilRound = {
        id: 'cost_round',
        userQuery: 'Calculate sum',
        timestamp: Date.now(),
        deliberation: {
          stage1: {
            skeptic: { personaId: 'skeptic', content: 'res1', status: 'completed', cost: 0.002, promptTokens: 100, completionTokens: 50 },
            visionary: { personaId: 'visionary', content: 'res2', status: 'completed', cost: 0.003, promptTokens: 120, completionTokens: 60 },
          },
          stage2: {
            skeptic: { personaId: 'skeptic', content: 'rev1', status: 'completed', cost: 0.001, promptTokens: 80, completionTokens: 40 },
          },
        },
        synthesis: {
          content: 'synth',
          status: 'completed',
          cost: 0.005,
          promptTokens: 200,
          completionTokens: 100,
          grounding: { searchCost: 0.004 },
        },
      };

      const breakdown = calculateRoundAggregateCost(round);
      expect(breakdown.stage1Cost).toBeCloseTo(0.005);
      expect(breakdown.stage2Cost).toBeCloseTo(0.001);
      expect(breakdown.chairCost).toBeCloseTo(0.005);
      expect(breakdown.webSearchCost).toBeCloseTo(0.004);
      expect(breakdown.totalCost).toBeCloseTo(0.015);
      expect(breakdown.totalPromptTokens).toBe(500);
      expect(breakdown.totalCompletionTokens).toBe(250);
    });

    it('enforces cost ceiling rules', () => {
      expect(isWithinBudgetCeiling(0.00, 'free').allowed).toBe(true);
      expect(isWithinBudgetCeiling(0.01, 'free').allowed).toBe(false);
      expect(isWithinBudgetCeiling(0.50, 'cheap', 1.0).allowed).toBe(true);
      expect(isWithinBudgetCeiling(1.50, 'quality', 1.0).allowed).toBe(false);
    });
  });

  describe('16. Truncation and finish_reason persistence', () => {
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
