import { Persona } from '../types';
import { FileAttachment } from './modeClassifier';
import { RawOpenRouterModel, cleanModelName, PresetId } from './presets';
import { buildRankMap, computeModelScore, estimatedCost, isFreeModel, getAuthorOrganization, getFamily } from './modelMapper';

export type TaskDomain = 'code' | 'math' | 'finance' | 'creative' | 'general';
export type BudgetMode = 'free' | 'fast_and_cheap' | 'best_value' | 'highest_quality' | PresetId;

export interface DomainModelMap {
  skeptic: string;
  visionary: string;
  pragmatist: string;
  synthesizer: string;
  defaultFallback: string;
}

export const DOMAIN_MODEL_MAPPINGS: Record<TaskDomain, DomainModelMap> = {
  code: {
    skeptic: 'deepseek/deepseek-r1',
    visionary: 'anthropic/claude-3.7-sonnet',
    pragmatist: 'qwen/qwen-2.5-72b-instruct',
    synthesizer: 'google/gemini-3.7-flash',
    defaultFallback: 'anthropic/claude-3.7-sonnet',
  },
  math: {
    skeptic: 'deepseek/deepseek-r1',
    visionary: 'openai/o3-mini',
    pragmatist: 'google/gemini-3.7-flash',
    synthesizer: 'anthropic/claude-3.7-sonnet',
    defaultFallback: 'deepseek/deepseek-r1',
  },
  finance: {
    skeptic: 'deepseek/deepseek-r1',
    visionary: 'openai/gpt-4o',
    pragmatist: 'anthropic/claude-3.5-haiku',
    synthesizer: 'google/gemini-3.7-flash',
    defaultFallback: 'google/gemini-3.7-flash',
  },
  creative: {
    skeptic: 'anthropic/claude-3.5-haiku',
    visionary: 'google/gemini-3.7-flash',
    pragmatist: 'meta-llama/llama-3.3-70b-instruct',
    synthesizer: 'anthropic/claude-3.7-sonnet',
    defaultFallback: 'openai/gpt-4o',
  },
  general: {
    skeptic: 'deepseek/deepseek-chat',
    visionary: 'openai/gpt-4o-mini',
    pragmatist: 'meta-llama/llama-3.3-70b-instruct',
    synthesizer: 'google/gemini-3.7-flash',
    defaultFallback: 'google/gemini-3.7-flash',
  },
};

/**
 * Domain benchmark weight definitions for multi-dimensional model ranking.
 * Weights specify relative importance of benchmarks for each domain.
 * Missing benchmarks on a candidate model are automatically omitted from denominator
 * and reweighted proportionally across present benchmark values (never defaulted to 1.0).
 */
export const DOMAIN_BENCHMARK_WEIGHTS: Record<string, Record<string, number>> = {
  code: {
    coding: 50,
    intelligence: 20,
    agentic: 15,
    latency: 10,
    cost: 5,
  },
  math: {
    intelligence: 50,
    coding: 25,
    agentic: 15,
    latency: 5,
    cost: 5,
  },
  finance: {
    intelligence: 40,
    coding: 20,
    agentic: 20,
    latency: 10,
    cost: 10,
  },
  creative: {
    design: 40,
    intelligence: 30,
    context_length: 15,
    latency: 10,
    cost: 5,
  },
  fast: {
    latency: 45,
    throughput: 30,
    cost: 15,
    intelligence: 10,
  },
  general: {
    intelligence: 30,
    coding: 20,
    agentic: 20,
    design: 15,
    cost: 10,
    latency: 5,
  },
};

/**
 * Normalizes a model ID by stripping suffixes like :free, :thinking, :extended, :batch
 */
export function normalizeModelId(id: string): string {
  if (!id) return '';
  return id
    .trim()
    .toLowerCase()
    .replace(/:(free|thinking|extended|batch)$/gi, '')
    .replace(/:(free|thinking|extended|batch)$/gi, '');
}

/**
 * Gets organization prefix from model ID (e.g. 'anthropic' from 'anthropic/claude-3.7-sonnet')
 */
export function getModelOrg(modelId: string): string {
  if (!modelId) return 'unknown';
  const norm = normalizeModelId(modelId);
  if (norm.includes('/')) {
    return norm.split('/')[0].toLowerCase();
  }
  return 'unknown';
}

/**
 * Gets family name from model ID (e.g. 'claude', 'gemini', 'gpt', 'deepseek', 'llama', 'qwen')
 */
export function getModelFamily(modelId: string): string {
  if (!modelId) return 'unknown';
  const norm = normalizeModelId(modelId);
  const name = norm.includes('/') ? norm.split('/')[1] : norm;
  if (name.includes('claude')) return 'claude';
  if (name.includes('gpt') || name.includes('o1') || name.includes('o3') || name.includes('openai')) return 'openai';
  if (name.includes('gemini') || name.includes('gemma')) return 'gemini';
  if (name.includes('deepseek')) return 'deepseek';
  if (name.includes('qwen')) return 'qwen';
  if (name.includes('llama')) return 'llama';
  if (name.includes('mistral') || name.includes('mixtral')) return 'mistral';
  if (name.includes('nemotron')) return 'nvidia';
  return name.split('-')[0] || name;
}

/**
 * Maps a persona or synthesizer to a role key ('skeptic' | 'visionary' | 'pragmatist' | 'synthesizer').
 * Infers role based on explicit ID, then keywords in name, role, and system prompt.
 * If no clear match, defaults to 'pragmatist' for broad applicability.
 */
export function getRoleKeyForPersona(persona: Persona, isSynthesizer = false): 'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer' {
  if (isSynthesizer) return 'synthesizer';

  const id = persona.id.toLowerCase();
  const role = (persona.role || '').toLowerCase();
  const name = (persona.name || '').toLowerCase();
  const systemPrompt = (persona.systemPrompt || '').toLowerCase();

  // Explicit built-in IDs (highest priority)
  if (id === 'skeptic') return 'skeptic';
  if (id === 'visionary') return 'visionary';
  if (id === 'pragmatist') return 'pragmatist';
  if (id === 'synthesizer' || id === 'chair') return 'synthesizer';

  // Keyword-based classification for custom personas (intermediate priority)
  const combinedText = `${name} ${role} ${systemPrompt}`;

  if (combinedText.includes('risk') || combinedText.includes('vulnerab') || combinedText.includes('audit') || combinedText.includes('critic') || combinedText.includes('security') || combinedText.includes('flaw') || combinedText.includes('stress-test')) {
    return 'skeptic';
  }
  if (combinedText.includes('vision') || combinedText.includes('innovat') || combinedText.includes('creative') || combinedText.includes('strategist') || combinedText.includes('horizon') || combinedText.includes('possib') || combinedText.includes('transform')) {
    return 'visionary';
  }
  if (combinedText.includes('pragmatist') || combinedText.includes('execut') || combinedText.includes('feasib') || combinedText.includes('speed') || combinedText.includes('perform') || combinedText.includes('production') || combinedText.includes('cost') || combinedText.includes('efficiency') || combinedText.includes('maintain')) {
    return 'pragmatist';
  }
  if (combinedText.includes('synthesiz') || combinedText.includes('chair') || combinedText.includes('consensus') || combinedText.includes('unified') || combinedText.includes('verdict')) {
    return 'synthesizer';
  }

  // Default fallback if no clear role keywords
  return 'pragmatist'; // Pragmatist is a good general-purpose default for practical advice
}

/**
 * Detects the task domain based on keywords in prompt and file extensions.
 */
export function detectTaskDomain(query: string, attachedFiles?: FileAttachment[]): TaskDomain {
  const q = query.toLowerCase().trim();

  // 1. Code domain triggers
  const codeKeywords = [
    'code', 'program', 'function', 'bug', 'debug', 'script', 'react', 'typescript', 'javascript',
    'python', 'html', 'css', 'api', 'component', 'class', 'method', 'variable', 'algorithm',
    'syntax', 'refactor', 'git', 'sql', 'database', 'json', 'pull request', 'stack trace',
    'compiler', 'app', 'developer', 'software', 'backend', 'frontend', 'framework',
    'zip', 'archive', 'codebase', 'repository', 'repo', 'rar', 'tar', 'unzip', 'files',
  ];

  const hasCodeOrArchiveAttachment = attachedFiles?.some(f => {
    if ((f as any).unzippedResult || (f as any).content?.includes('[CODEBASE FILE CONTENTS]')) {
      return true;
    }
    const ext = f.name.toLowerCase();
    return (
      ext.endsWith('.zip') || ext.endsWith('.rar') || ext.endsWith('.tar') || ext.endsWith('.gz') ||
      ext.endsWith('.tgz') || ext.endsWith('.7z') || ext.endsWith('.js') || ext.endsWith('.ts') ||
      ext.endsWith('.tsx') || ext.endsWith('.jsx') || ext.endsWith('.py') || ext.endsWith('.java') ||
      ext.endsWith('.cpp') || ext.endsWith('.c') || ext.endsWith('.cs') || ext.endsWith('.go') ||
      ext.endsWith('.rs') || ext.endsWith('.html') || ext.endsWith('.css') || ext.endsWith('.sql') ||
      ext.endsWith('.json') || ext.endsWith('.vue') || ext.endsWith('.svelte') || ext.endsWith('.php') ||
      ext.endsWith('.rb') || ext.endsWith('.swift') || ext.endsWith('.kt')
    );
  });

  if (hasCodeOrArchiveAttachment || codeKeywords.some(kw => q.includes(kw))) {
    return 'code';
  }

  // 2. Math domain triggers
  const mathKeywords = [
    'math', 'calculus', 'algebra', 'equation', 'integral', 'derivative', 'matrix', 'theorem',
    'probability', 'statistics', 'formula', 'geometry', 'arithmetic', 'solve for x', 'proof',
    'number theory', 'vector', 'logarithm', 'differential', 'trigonometry',
  ];

  if (mathKeywords.some(kw => q.includes(kw))) {
    return 'math';
  }

  // 3. Finance domain triggers
  const financeKeywords = [
    'finance', 'financial', 'tax', 'cash flow', 'valuation', 'dividend', 'revenue', 'profit',
    'budget', 'accounting', 'fiscal', 'investment', 'portfolio', 'stock', 'crypto', 'roi',
    'asset', 'balance sheet', 'inflation', 'equity', 'audit',
  ];

  if (financeKeywords.some(kw => q.includes(kw))) {
    return 'finance';
  }

  // 4. Creative domain triggers
  const creativeKeywords = [
    'write', 'story', 'essay', 'poem', 'script', 'creative', 'slogan', 'headline', 'narrative',
    'dialogue', 'copywriting', 'blog', 'character', 'novel', 'tagline', 'marketing copy',
  ];

  if (creativeKeywords.some(kw => q.includes(kw))) {
    return 'creative';
  }

  return 'general';
}

export type ModelAssignmentSource =
  | 'manual_override'
  | 'auto_domain_routing'
  | 'preset_budget_filter'
  | 'catalog_fallback'
  | 'default_fallback';

export interface RouteCouncilModelsParams {
  domain?: TaskDomain | string;
  personas: Persona[];
  synthesizer: Persona;
  catalog?: RawOpenRouterModel[] | { id: string; name?: string }[];
  rawModelsCatalog?: RawOpenRouterModel[];
  budget?: 'free' | 'paid' | 'fastAndFree' | 'fastAndCheap' | 'bestValue' | 'highestQuality' | 'fast_and_free' | 'fast_and_cheap' | 'best_value' | 'highest_quality' | string;
  manualOverrides?: Record<string, string | undefined>;
  autoSelectModels?: boolean;
}

export interface RejectedCandidateReason {
  candidate: string;
  reason: string;
}

export interface PersonaSelectionDetail {
  personaId: string;
  personaName: string;
  roleKey: 'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer';
  previousModel: string;
  selectedModel: string;
  source: ModelAssignmentSource;
  score?: number;
  reason: string;
  rejectedCandidates: RejectedCandidateReason[];
}

export interface CouncilModelAssignment {
  model: string;
  name: string;
  source: ModelAssignmentSource;
  score?: number;
  reasoning: string;
  roleKey: 'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer';
}

export interface RouteCouncilModelsResult {
  assignments: Record<string, CouncilModelAssignment>;
  updatedPersonas: Persona[];
  updatedSynthesizer: Persona;
  domain: TaskDomain;
  budget: string;
  autoSelectEnabled: boolean;
  warnings: string[];
  selectionDetails: PersonaSelectionDetail[];
  debug: {
    domain: TaskDomain;
    budget: string;
    autoSelectEnabled: boolean;
    domainWeights: Record<string, number>;
    authorityChainDetails: Array<{
      personaId: string;
      roleKey: string;
      finalModel: string;
      source: ModelAssignmentSource;
      score?: number;
      evaluations: Array<{ candidateId: string; score?: number; passedFilter: boolean; reason: string }>;
    }>;
  };
  timestamp: number;
}

import { ExecutionPolicy, assertPolicyModel } from './executionPolicy';

export interface SmartSelectionOptions {
  availableModels?: { id: string; name: string }[];
  rawModelsCatalog?: RawOpenRouterModel[];
  policy?: ExecutionPolicy;
  autoSelectModels?: boolean;
}

export interface SmartSelectionResult extends RouteCouncilModelsResult {
  assignedModels: Record<string, string>;
}

/**
 * Free tier fallback ordered candidates per role (100% $0 cost)
 */
const FREE_ROLE_CANDIDATES: Record<'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer', string[]> = {
  skeptic: [
    'deepseek/deepseek-r1:free',
    'google/gemini-2.0-flash-thinking-exp:free',
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'google/gemma-2-9b-it:free',
  ],
  visionary: [
    'poolside/laguna-xs-2.1:free',
    'google/gemma-4-31b-it:free',
    'google/gemini-2.0-flash-thinking-exp:free',
    'meta-llama/llama-3.2-3b-instruct:free',
  ],
  pragmatist: [
    'inclusionai/ling-3.0-tiny:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemma-2-9b-it:free',
  ],
  synthesizer: [
    'google/gemma-4-31b-it:free',
    'google/gemini-2.0-flash-thinking-exp:free',
    'deepseek/deepseek-r1:free',
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'inclusionai/ling-3.0-tiny:free',
  ],
};

/**
 * Fast & Cheap fallback ordered candidates per role (low cost <= $0.005 / round)
 */
const CHEAP_ROLE_CANDIDATES: Record<'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer', string[]> = {
  skeptic: [
    'deepseek/deepseek-chat',
    'google/gemini-3.7-flash',
    'meta-llama/llama-3.3-70b-instruct',
    'qwen/qwen-2.5-72b-instruct',
  ],
  visionary: [
    'google/gemini-3.7-flash',
    'deepseek/deepseek-chat',
    'openai/gpt-4o-mini',
    'meta-llama/llama-3.3-70b-instruct',
  ],
  pragmatist: [
    'openai/gpt-4o-mini',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat',
    'google/gemini-3.7-flash',
  ],
  synthesizer: [
    'google/gemini-3.7-flash',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat',
    'openai/gpt-4o-mini',
  ],
};

/**
 * Best Value fallback ordered candidates per role (optimal quality-to-cost ratio)
 */
const BEST_VALUE_ROLE_CANDIDATES: Record<'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer', string[]> = {
  skeptic: [
    'deepseek/deepseek-r1',
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4o-mini',
    'google/gemini-3.7-flash',
  ],
  visionary: [
    'anthropic/claude-3.5-haiku',
    'google/gemini-3.7-flash',
    'deepseek/deepseek-r1',
    'openai/gpt-4o-mini',
  ],
  pragmatist: [
    'openai/gpt-4o-mini',
    'google/gemini-3.7-flash',
    'qwen/qwen-2.5-72b-instruct',
    'anthropic/claude-3.5-haiku',
  ],
  synthesizer: [
    'google/gemini-3.7-flash',
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-r1',
  ],
};

/**
 * Highest Quality fallback ordered candidates per role (top frontier capability)
 */
const HIGHEST_QUALITY_ROLE_CANDIDATES: Record<'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer', string[]> = {
  skeptic: [
    'anthropic/claude-3.7-sonnet',
    'deepseek/deepseek-r1',
    'openai/gpt-4o',
    'openai/o3-mini',
  ],
  visionary: [
    'openai/gpt-4o',
    'deepseek/deepseek-r1',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-3.7-flash',
  ],
  pragmatist: [
    'deepseek/deepseek-r1',
    'openai/gpt-4o',
    'qwen/qwen-2.5-72b-instruct',
    'meta-llama/llama-3.3-70b-instruct',
  ],
  synthesizer: [
    'google/gemini-3.7-flash',
    'anthropic/claude-3.7-sonnet',
    'openai/gpt-4o',
    'deepseek/deepseek-r1',
  ],
};

/**
 * Standard ordered fallback candidates per role
 */
const STANDARD_ROLE_CANDIDATES: Record<'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer', string[]> = {
  skeptic: [
    'anthropic/claude-3.7-sonnet',
    'deepseek/deepseek-r1',
    'anthropic/claude-3.5-sonnet',
    'qwen/qwen-2.5-72b-instruct',
    'anthropic/claude-3.5-haiku',
  ],
  visionary: [
    'deepseek/deepseek-r1',
    'google/gemini-3.7-flash',
    'openai/gpt-4o',
    'openai/o3-mini',
    'anthropic/claude-3.7-sonnet',
  ],
  pragmatist: [
    'meta-llama/llama-3.3-70b-instruct',
    'qwen/qwen-2.5-72b-instruct',
    'openai/gpt-4o-mini',
    'google/gemini-3.7-flash',
  ],
  synthesizer: [
    'google/gemini-3.7-flash',
    'anthropic/claude-3.7-sonnet',
    'openai/gpt-4o',
    'deepseek/deepseek-r1',
  ],
};

/**
 * Matches a target model ID against available models catalog using strict rules:
 * 1. Exact ID match
 * 2. Normalized ID match
 */
function findModelInCatalog(
  targetId: string,
  catalog: Array<{ id: string; name?: string }>
): string | null {
  if (!targetId || !catalog || catalog.length === 0) return null;

  const exact = catalog.find((m) => m.id === targetId);
  if (exact) return exact.id;

  const normTarget = normalizeModelId(targetId);
  const normalized = catalog.find((m) => normalizeModelId(m.id) === normTarget);
  if (normalized) return normalized.id;

  return null;
}

/**
 * Single router function for council model routing.
 * Does NOT mutate state.
 * Implements strict authority chain:
 *   1. Manual override
 *   2. Auto domain routing (domain-weighted benchmarks scoring with missing value reweighting)
 *   3. Preset / budget filter
 *   4. Catalog / default fallback
 */
export function routeCouncilModels(params: RouteCouncilModelsParams): RouteCouncilModelsResult {
  const normalizedDomain = (params.domain as TaskDomain) in DOMAIN_MODEL_MAPPINGS
    ? (params.domain as TaskDomain)
    : 'general';

  const budgetMode = params.budget || 'all';
  const autoSelectEnabled = params.autoSelectModels !== false;
  const rawCatalog = params.rawModelsCatalog || (params.catalog as RawOpenRouterModel[]) || [];
  const manualOverrides = params.manualOverrides || {};
  const warnings: string[] = [];

  // Parse raw catalog items into full RawOpenRouterModels if available
  const fullCatalog: RawOpenRouterModel[] = rawCatalog.filter((m): m is RawOpenRouterModel =>
    typeof (m as any).id === 'string' && (m as any).pricing !== undefined
  );

  // Extract domain weights
  const domainWeights = DOMAIN_BENCHMARK_WEIGHTS[normalizedDomain] || DOMAIN_BENCHMARK_WEIGHTS.general;

  // Build rank maps for domain scoring across full catalog
  let scoredModelMap = new Map<string, number>();

  if (fullCatalog.length > 0) {
    const getCoding = (m: RawOpenRouterModel) => m.benchmarks?.coding;
    const getIntel = (m: RawOpenRouterModel) => m.benchmarks?.intelligence ?? (m.context_length ? Math.min(m.context_length, 2000000) : undefined);
    const getAgentic = (m: RawOpenRouterModel) => m.benchmarks?.agentic;
    const getDesign = (m: RawOpenRouterModel) => m.benchmarks?.design_arena_elo ?? m.benchmarks?.arena_elo ?? m.benchmarks?.elo;
    const getLatency = (m: RawOpenRouterModel) => m.top_provider?.latency ?? m.benchmarks?.latency;
    const getThroughput = (m: RawOpenRouterModel) => m.top_provider?.throughput ?? m.benchmarks?.throughput;
    const getCost = (m: RawOpenRouterModel) => estimatedCost(m);
    const getContext = (m: RawOpenRouterModel) => m.context_length;

    const dimensions: { rankMap: Map<RawOpenRouterModel, number>; weight: number }[] = [];

    if (domainWeights.coding) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getCoding, true), weight: domainWeights.coding });
    }
    if (domainWeights.intelligence) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getIntel, true), weight: domainWeights.intelligence });
    }
    if (domainWeights.agentic) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getAgentic, true), weight: domainWeights.agentic });
    }
    if (domainWeights.design) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getDesign, true), weight: domainWeights.design });
    }
    if (domainWeights.latency) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getLatency, false), weight: domainWeights.latency });
    }
    if (domainWeights.throughput) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getThroughput, true), weight: domainWeights.throughput });
    }
    if (domainWeights.cost) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getCost, false), weight: domainWeights.cost });
    }
    if (domainWeights.context_length) {
      dimensions.push({ rankMap: buildRankMap(fullCatalog, getContext, true), weight: domainWeights.context_length });
    }

    fullCatalog.forEach(m => {
      // computeModelScore dynamically divides by total weight of present benchmarks
      // (missing benchmarks reweight proportionally, never defaulting to 1.0)
      const score = computeModelScore(m, dimensions);
      scoredModelMap.set(m.id, score);
    });
  }

  // Combine personas and synthesizer into non-mutating copy list
  const allEntities: { persona: Persona; isSynth: boolean }[] = [
    ...params.personas.map((p) => ({ persona: { ...p }, isSynth: false })),
    { persona: { ...params.synthesizer }, isSynth: true },
  ];

  const updatedPersonas: Persona[] = params.personas.map(p => ({ ...p }));
  let updatedSynthesizer: Persona = { ...params.synthesizer };

  const assignments: Record<string, CouncilModelAssignment> = {};
  const selectionDetails: PersonaSelectionDetail[] = [];
  const authorityChainDetails: Array<{
    personaId: string;
    roleKey: string;
    finalModel: string;
    source: ModelAssignmentSource;
    score?: number;
    evaluations: Array<{ candidateId: string; score?: number; passedFilter: boolean; reason: string }>;
  }> = [];

  const usedModels = new Set<string>();
  const usedOrgs = new Set<string>();
  const usedFamilies = new Set<string>();

  const isFreeBudget = budgetMode === 'free' || budgetMode === 'fastAndFree' || budgetMode === 'fast_and_free' || budgetMode === 'fastest_cheapest';
  const isCheapBudget = budgetMode === 'fastAndCheap' || budgetMode === 'fast_and_cheap';
  const isBestValueBudget = budgetMode === 'bestValue' || budgetMode === 'best_value';
  const isHighestQualityBudget = budgetMode === 'highestQuality' || budgetMode === 'highest_quality';

  allEntities.forEach(({ persona, isSynth }) => {
    const personaId = persona.id;
    const personaName = persona.name || (isSynth ? 'Chairman' : personaId);
    const roleKey = getRoleKeyForPersona(persona, isSynth);
    const evaluations: Array<{ candidateId: string; score?: number; passedFilter: boolean; reason: string }> = [];
    const rejectedCandidates: RejectedCandidateReason[] = [];

    let selectedModel = '';
    let selectedSource: ModelAssignmentSource = 'default_fallback';
    let selectedReason = '';
    let selectedScore: number | undefined = undefined;

    // ═════════════════════════════════════════════════════════════════════
    // AUTHORITY STEP 1: MANUAL OVERRIDE
    // ═════════════════════════════════════════════════════════════════════
    const explicitOverride = manualOverrides[personaId];
    const isManualModePreserved = !autoSelectEnabled && persona.model;

    if (explicitOverride && explicitOverride.trim().length > 0) {
      selectedModel = explicitOverride;
      selectedSource = 'manual_override';
      selectedReason = `Explicit manual override specified for '${personaName}': ${explicitOverride}`;
      evaluations.push({
        candidateId: explicitOverride,
        passedFilter: true,
        reason: 'Step 1: Manual override matched unconditionally.',
      });
    } else if (isManualModePreserved) {
      selectedModel = persona.model;
      selectedSource = 'manual_override';
      selectedReason = `Auto-Select is OFF; preserved user's assigned persona model '${persona.model}'.`;
      evaluations.push({
        candidateId: persona.model,
        passedFilter: true,
        reason: 'Step 1: Manual assignment preserved (Auto-Select OFF).',
      });
    }

    // ═════════════════════════════════════════════════════════════════════
    // AUTHORITY STEP 2 & 3: AUTO DOMAIN ROUTING & PRESET/BUDGET FILTER
    // ═════════════════════════════════════════════════════════════════════
    if (!selectedModel && rawCatalog.length > 0) {
      // Build candidate list from catalog
      let eligibleCatalog = [...rawCatalog];

      // Filter by Preset / Budget constraint
      if (isFreeBudget) {
        eligibleCatalog = eligibleCatalog.filter((m) => {
          if (typeof (m as any).pricing !== 'undefined') {
            return isFreeModel(m as RawOpenRouterModel);
          }
          const idL = m.id.toLowerCase();
          return idL.endsWith(':free') || idL.includes(':free');
        });
      } else if (isCheapBudget && fullCatalog.length > 0) {
        eligibleCatalog = eligibleCatalog.filter((m) => {
          const c = estimatedCost(m as RawOpenRouterModel);
          return c > 0 && c <= 0.005;
        });
      } else if (isBestValueBudget && fullCatalog.length > 0) {
        eligibleCatalog = eligibleCatalog.filter((m) => {
          const c = estimatedCost(m as RawOpenRouterModel);
          return c > 0 && c <= 0.02;
        });
      } else if (isHighestQualityBudget && fullCatalog.length > 0) {
        // Highest Quality: Prioritize top-tier frontier and benchmark models
        eligibleCatalog = eligibleCatalog.filter((m) => {
          const id = m.id.toLowerCase();
          const cost = estimatedCost(m as RawOpenRouterModel);
          const isKnownFrontier =
            id.includes('claude-3.7') ||
            id.includes('claude-3-7') ||
            id.includes('claude-3.5-sonnet') ||
            id.includes('claude-3-5-sonnet') ||
            id.includes('gpt-4o') ||
            id.includes('o3-mini') ||
            id.includes('o1') ||
            id.includes('deepseek-r1') ||
            id.includes('gemini-2.5-pro') ||
            id.includes('gemini-2.0-pro') ||
            id.includes('qwen-2.5-72b');
          const isHighBenchmark =
            (m.benchmarks?.intelligence ?? 0) >= 0.85 ||
            (m.benchmarks?.coding ?? 0) >= 0.85 ||
            (m.benchmarks?.arena_elo ?? 0) >= 1250;
          return isKnownFrontier || isHighBenchmark || cost >= 0.003;
        });
      }

      // Sort candidate pool by domain score with deterministic tie-breaker
      eligibleCatalog.sort((a, b) => {
        const d = (scoredModelMap.get(b.id) ?? 0) - (scoredModelMap.get(a.id) ?? 0);
        return Math.abs(d) > 1e-6 ? d : a.id.localeCompare(b.id);
      });

      // Pass 1: Strict Uniqueness (Distinct Model, Org, Family)
      for (const cand of eligibleCatalog) {
        const candId = cand.id;
        const org = getModelOrg(candId);
        const family = getModelFamily(candId);
        const score = scoredModelMap.get(candId);

        if (usedModels.has(candId)) {
          rejectedCandidates.push({ candidate: candId, reason: 'Duplicate model ID already assigned in council.' });
          evaluations.push({ candidateId: candId, score, passedFilter: false, reason: 'Duplicate model ID' });
          continue;
        }
        if (usedOrgs.has(org)) {
          rejectedCandidates.push({ candidate: candId, reason: `Author organization '${org}' already assigned.` });
          evaluations.push({ candidateId: candId, score, passedFilter: false, reason: `Duplicate organization '${org}'` });
          continue;
        }
        if (usedFamilies.has(family)) {
          rejectedCandidates.push({ candidate: candId, reason: `Model family '${family}' already assigned.` });
          evaluations.push({ candidateId: candId, score, passedFilter: false, reason: `Duplicate family '${family}'` });
          continue;
        }

        selectedModel = candId;
        selectedScore = score;
        selectedSource = isFreeBudget || isCheapBudget || isBestValueBudget || isHighestQualityBudget ? 'preset_budget_filter' : 'auto_domain_routing';
        selectedReason = `Step ${selectedSource === 'preset_budget_filter' ? '3 (Preset/Budget Filter)' : '2 (Auto Domain Routing)'}: Top candidate for '${budgetMode || normalizedDomain}' (${score !== undefined ? `Score: ${score.toFixed(3)}` : 'Catalog matched'}).`;
        evaluations.push({ candidateId: candId, score, passedFilter: true, reason: 'Passed strict uniqueness & preset criteria filter.' });
        break;
      }

      // Pass 2: Relax Family Uniqueness
      if (!selectedModel) {
        for (const cand of eligibleCatalog) {
          const candId = cand.id;
          const org = getModelOrg(candId);
          const score = scoredModelMap.get(candId);

          if (usedModels.has(candId) || usedOrgs.has(org)) continue;

          selectedModel = candId;
          selectedScore = score;
          selectedSource = 'auto_domain_routing';
          selectedReason = `Step 2: Auto domain routing matched candidate (relaxed family uniqueness).`;
          evaluations.push({ candidateId: candId, score, passedFilter: true, reason: 'Matched with relaxed family constraint.' });
          break;
        }
      }

      // Pass 3: Relax Org Uniqueness
      if (!selectedModel) {
        for (const cand of eligibleCatalog) {
          const candId = cand.id;
          const score = scoredModelMap.get(candId);

          if (usedModels.has(candId)) continue;

          selectedModel = candId;
          selectedScore = score;
          selectedSource = 'auto_domain_routing';
          selectedReason = `Step 2: Auto domain routing matched candidate (relaxed organization constraint).`;
          evaluations.push({ candidateId: candId, score, passedFilter: true, reason: 'Matched with relaxed org constraint.' });
          break;
        }
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // AUTHORITY STEP 4: CATALOG & DEFAULT FALLBACK
    // ═════════════════════════════════════════════════════════════════════
    if (!selectedModel) {
      const domainMap = DOMAIN_MODEL_MAPPINGS[normalizedDomain] || DOMAIN_MODEL_MAPPINGS.general;
      const primaryTarget = domainMap[roleKey] || domainMap.defaultFallback;
      const roleCandidates = isFreeBudget
        ? FREE_ROLE_CANDIDATES[roleKey]
        : isCheapBudget
        ? CHEAP_ROLE_CANDIDATES[roleKey]
        : isBestValueBudget
        ? BEST_VALUE_ROLE_CANDIDATES[roleKey]
        : isHighestQualityBudget
        ? HIGHEST_QUALITY_ROLE_CANDIDATES[roleKey]
        : STANDARD_ROLE_CANDIDATES[roleKey];

      const fallbackPool = [
        primaryTarget,
        ...(roleCandidates || []),
        domainMap.defaultFallback,
        'google/gemini-2.5-flash',
      ];

      for (const target of fallbackPool) {
        const resolvedInCatalog = rawCatalog.length > 0 ? findModelInCatalog(target, rawCatalog) : target;
        const candidateToUse = resolvedInCatalog || target;

        if (!usedModels.has(candidateToUse)) {
          selectedModel = candidateToUse;
          selectedSource = rawCatalog.length > 0 ? 'catalog_fallback' : 'default_fallback';
          selectedReason = `Step 4: ${selectedSource === 'catalog_fallback' ? 'Catalog fallback' : 'Default fallback'} applied for ${roleKey} role (${candidateToUse}).`;
          evaluations.push({ candidateId: candidateToUse, passedFilter: true, reason: 'Step 4 Fallback target selected.' });
          break;
        }
      }

      if (!selectedModel) {
        selectedModel = primaryTarget;
        selectedSource = 'default_fallback';
        selectedReason = `Step 4: Absolute default fallback target assigned (${primaryTarget}).`;
      }
    }

    // Register assigned model into joint tracking sets
    usedModels.add(selectedModel);
    usedOrgs.add(getModelOrg(selectedModel));
    usedFamilies.add(getModelFamily(selectedModel));

    // Construct assignment object for persona
    const assignment: CouncilModelAssignment = {
      model: selectedModel,
      name: cleanModelName(selectedModel, selectedModel),
      source: selectedSource,
      score: selectedScore,
      reasoning: selectedReason,
      roleKey,
    };

    assignments[personaId] = assignment;

    // Build persona selection detail
    selectionDetails.push({
      personaId,
      personaName,
      roleKey,
      previousModel: persona.model,
      selectedModel,
      source: selectedSource,
      score: selectedScore,
      reason: selectedReason,
      rejectedCandidates,
    });

    authorityChainDetails.push({
      personaId,
      roleKey,
      finalModel: selectedModel,
      source: selectedSource,
      score: selectedScore,
      evaluations,
    });

    // Update fresh copies of personas / synthesizer
    if (isSynth) {
      updatedSynthesizer = {
        ...params.synthesizer,
        model: selectedModel,
      };
    } else {
      const idx = updatedPersonas.findIndex(p => p.id === personaId);
      if (idx !== -1) {
        updatedPersonas[idx] = {
          ...updatedPersonas[idx],
          model: selectedModel,
        };
      }
    }
  });

  if (usedOrgs.size < allEntities.length) {
    warnings.push(`Notice: Diversity constraint relaxed — ${usedOrgs.size} distinct organization(s) assigned across ${allEntities.length} council roles.`);
  }

  const timestamp = Date.now();

  if (typeof console !== 'undefined' && console.table) {
    console.table(
      selectionDetails.map((d) => ({
        role: d.roleKey,
        prev: d.previousModel,
        selected: d.selectedModel,
        source: d.source,
        score: d.score !== undefined ? d.score.toFixed(3) : 'N/A',
        reason: d.reason,
      }))
    );
  }

  return {
    assignments,
    updatedPersonas,
    updatedSynthesizer,
    domain: normalizedDomain,
    budget: budgetMode,
    autoSelectEnabled,
    warnings,
    selectionDetails,
    debug: {
      domain: normalizedDomain,
      budget: budgetMode,
      autoSelectEnabled,
      domainWeights,
      authorityChainDetails,
    },
    timestamp,
  };
}

export function ensureUniquePersonaModels(
  personas: Persona[],
  synthesizer: Persona,
  budget?: string
): { personas: Persona[]; synthesizer: Persona } {
  const usedModelIds = new Set<string>();
  const updatedPersonas = personas.map(p => ({ ...p }));
  const updatedSynthesizer = { ...synthesizer };

  const isFree = budget === 'free' || budget === 'fastAndFree' || budget === 'fast_and_free';

  const fallbackPool = isFree
    ? [
        'deepseek/deepseek-r1:free',
        'google/gemini-2.0-flash-thinking-exp:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'meta-llama/llama-3.2-3b-instruct:free',
        'google/gemma-2-9b-it:free',
        'qwen/qwen-2.5-coder-32b-instruct:free',
      ]
    : [
        'deepseek/deepseek-chat',
        'anthropic/claude-3.5-haiku',
        'openai/gpt-4o-mini',
        'google/gemini-2.5-flash',
        'meta-llama/llama-3.3-70b-instruct',
        'qwen/qwen-2.5-72b-instruct',
        'anthropic/claude-3.7-sonnet',
        'deepseek/deepseek-r1',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ];

  for (let i = 0; i < updatedPersonas.length; i++) {
    const p = updatedPersonas[i];
    if (p.enabled === false) continue;

    let normId = normalizeModelId(p.model);
    if (usedModelIds.has(normId)) {
      const replacement = fallbackPool.find(m => !usedModelIds.has(normalizeModelId(m))) || fallbackPool[0];
      p.model = replacement;
      normId = normalizeModelId(replacement);
    }
    usedModelIds.add(normId);
  }

  let synthNorm = normalizeModelId(updatedSynthesizer.model);
  if (usedModelIds.has(synthNorm)) {
    const replacement = fallbackPool.find(m => !usedModelIds.has(normalizeModelId(m))) || fallbackPool[fallbackPool.length - 1];
    updatedSynthesizer.model = replacement;
  }

  return { personas: updatedPersonas, synthesizer: updatedSynthesizer };
}

/**
 * Compatibility wrapper around routeCouncilModels.
 */
export function applySmartModelSelection(
  domain: TaskDomain,
  personas: Persona[],
  synthesizer: Persona,
  options?: SmartSelectionOptions | { id: string; name: string }[]
): SmartSelectionResult {
  let availableModels: { id: string; name: string }[] = [];
  let rawModelsCatalog: RawOpenRouterModel[] | undefined = undefined;
  let autoSelectEnabled = true;
  let policy: ExecutionPolicy | undefined = undefined;

  if (Array.isArray(options)) {
    availableModels = options;
  } else if (options) {
    availableModels = options.availableModels || [];
    rawModelsCatalog = options.rawModelsCatalog;
    policy = options.policy;
    if (options.autoSelectModels !== undefined) {
      autoSelectEnabled = options.autoSelectModels;
    }
  }

  const effectiveBudget = policy?.budget;

  const routeResult = routeCouncilModels({
    domain,
    personas,
    synthesizer,
    catalog: rawModelsCatalog || availableModels,
    rawModelsCatalog,
    budget: effectiveBudget,
    autoSelectModels: autoSelectEnabled,
  });

  const { personas: uniquePersonas, synthesizer: uniqueSynthesizer } = ensureUniquePersonaModels(
    routeResult.updatedPersonas,
    routeResult.updatedSynthesizer,
    effectiveBudget
  );

  const assignedModels: Record<string, string> = {};
  uniquePersonas.forEach((p) => {
    if (policy) assertPolicyModel(p.model, policy, rawModelsCatalog);
    assignedModels[p.id] = p.model;
  });
  
  if (policy) assertPolicyModel(uniqueSynthesizer.model, policy, rawModelsCatalog);
  assignedModels[uniqueSynthesizer.id] = uniqueSynthesizer.model;

  return {
    ...routeResult,
    updatedPersonas: uniquePersonas,
    updatedSynthesizer: uniqueSynthesizer,
    assignedModels,
  };
}

