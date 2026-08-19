import type { Persona, RawOpenRouterModel } from '../types';
import { isFreeModel } from './modelMapper';

export type TaskDomain = 'code' | 'math' | 'finance' | 'creative' | 'general';

export interface SmartSelectionDetail {
  personaName: string;
  roleKey: string;
  source?: string;
  previousModel: string;
  selectedModel: string;
  reason: string;
  rejectedCandidates?: Array<{ candidate: string; reason: string }>;
}

export interface SmartSelectionResult {
  domain: TaskDomain;
  updatedPersonas: Persona[];
  updatedSynthesizer: Persona;
  assignments: Record<string, { personaId: string; model: string; rationale: string }>;
  autoSelectEnabled: boolean;
  selectionDetails: SmartSelectionDetail[];
}

export interface ApplySmartSelectionOptions {
  availableModels?: Array<{ id: string; name: string }>;
  rawModelsCatalog?: RawOpenRouterModel[];
  isFreeOnly?: boolean;
  autoSelectModels?: boolean;
}

interface DomainModelMapping {
  panelists: string[];
  synthesizer: string;
}

export const DOMAIN_MODEL_MAPPINGS: Record<TaskDomain, DomainModelMapping> = {
  code: {
    panelists: ['anthropic/claude-3.7-sonnet', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro'],
    synthesizer: 'anthropic/claude-3.7-sonnet',
  },
  math: {
    panelists: ['deepseek/deepseek-r1', 'anthropic/claude-3.7-sonnet', 'openai/o3-mini'],
    synthesizer: 'deepseek/deepseek-r1',
  },
  finance: {
    panelists: ['openai/gpt-4o', 'anthropic/claude-3.5-haiku', 'deepseek/deepseek-chat'],
    synthesizer: 'google/gemini-2.5-pro',
  },
  creative: {
    panelists: ['google/gemini-2.5-pro', 'openai/gpt-4o', 'meta-llama/llama-3.3-70b-instruct'],
    synthesizer: 'google/gemini-2.5-pro',
  },
  general: {
    panelists: ['google/gemini-2.5-flash', 'anthropic/claude-3.5-haiku', 'openai/gpt-4o-mini'],
    synthesizer: 'google/gemini-2.5-flash',
  },
};

const CODE_KEYWORDS = [
  'refactor', 'typescript', 'javascript', 'async', 'await', 'debug', 'syntax',
  'python', 'react', 'function', 'api', 'code', 'bug', 'compile', 'error',
  'repository', 'git', 'docker', 'database', 'sql', 'types', 'component',
  'performance bottleneck', 'memory leak', 'race condition', 'pull request',
  'stack trace', 'algorithm', 'regex', 'endpoint', 'json', 'css', 'html',
];

const MATH_KEYWORDS = [
  'integral', 'derivative', 'equation', 'calculate', 'solve', 'algebra',
  'calculus', 'statistics', 'probability', 'matrix', 'theorem', 'proof',
  'sum', 'multiply', 'divide', 'linear regression',
];

const FINANCE_KEYWORDS = [
  'ebitda', 'balance sheet', 'revenue', 'finance', 'financial', 'cash flow',
  'valuation', 'equity', 'capital', 'budget', 'roi', 'investment', 'p&l',
  'income statement', 'unit economics', 'tax', 'margin', 'forecast',
];

const CREATIVE_KEYWORDS = [
  'story', 'fiction', 'creative', 'narrative', 'poem', 'brainstorm ideas',
  'brand name', 'tagline', 'marketing copy', 'ad copy', 'worldbuilding',
  'character', 'plot', 'script', 'dialogue',
];

const CODE_FILE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.c',
  '.cpp', '.h', '.hpp', '.cs', '.php', '.swift', '.kt', '.sql', '.html',
  '.css', '.scss', '.json', '.yaml', '.yml', '.sh', '.xml', '.toml', '.vue',
  '.svelte', '.dart', '.lua', '.r', '.m',
];

/**
 * Deterministically classifies a query (plus optional attached files)
 * into a task domain.
 */
export function detectTaskDomain(
  query: string,
  attachedFiles?: Array<{ name: string; content: string }>
): TaskDomain {
  const q = (query || '').toLowerCase().trim();

  if (attachedFiles && attachedFiles.length > 0) {
    const hasCodeFile = attachedFiles.some((f) => {
      const name = (f.name || '').toLowerCase();
      return CODE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
    });
    if (hasCodeFile) return 'code';
  }

  if (CODE_KEYWORDS.some((kw) => q.includes(kw))) return 'code';
  if (MATH_KEYWORDS.some((kw) => q.includes(kw))) return 'math';
  if (FINANCE_KEYWORDS.some((kw) => q.includes(kw))) return 'finance';
  if (CREATIVE_KEYWORDS.some((kw) => q.includes(kw))) return 'creative';
  return 'general';
}

function isFreeModelId(modelId: string, catalog?: RawOpenRouterModel[]): boolean {
  if (!modelId) return false;
  const n = modelId.trim().toLowerCase();
  if (n === 'openrouter/free' || n === 'openrouter/auto') return false;
  const found = catalog?.find((m) => m.id.toLowerCase() === n);
  if (found?.pricing) {
    const parse = (v: any) => parseFloat(String(v || '0'));
    const EPS = 0.000001;
    return (
      parse(found.pricing.request) <= EPS &&
      parse(found.pricing.prompt) <= EPS &&
      parse(found.pricing.completion) <= EPS
    );
  }
  return n.endsWith(':free');
}

function pickModel(
  preferred: string,
  usedModels: Set<string>,
  availableModels: Array<{ id: string; name: string }> | undefined,
  catalog: RawOpenRouterModel[],
  isFreeOnly: boolean
): { model: string; source: string; rejected: Array<{ candidate: string; reason: string }> } {
  const rejected: Array<{ candidate: string; reason: string }> = [];

  // 1. Preferred mapping
  if (!usedModels.has(preferred) && (!isFreeOnly || isFreeModelId(preferred, catalog))) {
    return { model: preferred, source: 'domain_mapping', rejected };
  }
  if (usedModels.has(preferred)) {
    rejected.push({ candidate: preferred, reason: 'Model already assigned to another panelist.' });
  } else if (isFreeOnly && !isFreeModelId(preferred, catalog)) {
    rejected.push({ candidate: preferred, reason: 'Not a verified free model (Strict Free budget).' });
  }

  // 2. Available models pool (prefers catalog)
  const pool = (catalog.length > 0 ? catalog.map((m) => ({ id: m.id, name: m.name || m.id })) : availableModels) || [];

  for (const option of pool) {
    if (!option?.id) continue;
    if (usedModels.has(option.id)) {
      rejected.push({ candidate: option.id, reason: 'Model already assigned to another panelist.' });
      continue;
    }
    if (isFreeOnly && !isFreeModelId(option.id, catalog)) {
      rejected.push({ candidate: option.id, reason: 'Not a verified free model (Strict Free budget).' });
      continue;
    }
    return { model: option.id, source: 'catalog', rejected };
  }

  // 3. Hardcoded fallback pool
  const fallbackPool = [
    'google/gemini-2.5-flash',
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-r1:free',
    'meta-llama/llama-3.2-3b-instruct:free',
  ];
  for (const id of fallbackPool) {
    if (usedModels.has(id)) {
      rejected.push({ candidate: id, reason: 'Model already assigned to another panelist.' });
      continue;
    }
    if (isFreeOnly && !isFreeModelId(id, catalog)) {
      rejected.push({ candidate: id, reason: 'Not a verified free model (Strict Free budget).' });
      continue;
    }
    return { model: id, source: 'hardcoded_fallback', rejected };
  }

  return { model: preferred, source: 'unchanged', rejected };
}

/**
 * Computes optimal persona + synthesizer model assignments for a task domain.
 */
export function applySmartModelSelection(
  domain: TaskDomain,
  personas: Persona[],
  synthesizer: Persona,
  options: ApplySmartSelectionOptions = {}
): SmartSelectionResult {
  const { availableModels, rawModelsCatalog = [], isFreeOnly = false, autoSelectModels = true } = options;
  const mapping = DOMAIN_MODEL_MAPPINGS[domain] || DOMAIN_MODEL_MAPPINGS.general;

  const enabledPersonas = personas.filter((p) => p.enabled !== false);
  const usedModels = new Set<string>();
  const selectionDetails: SmartSelectionDetail[] = [];

  const updatedPersonas = enabledPersonas.map((p, idx) => {
    const preferred = mapping.panelists[idx % mapping.panelists.length] || mapping.panelists[0];
    const { model, source, rejected } = pickModel(preferred, usedModels, availableModels, rawModelsCatalog, isFreeOnly);
    usedModels.add(model);
    selectionDetails.push({
      personaName: p.name,
      roleKey: p.role || p.id,
      source,
      previousModel: p.model,
      selectedModel: model,
      reason: `Domain "${domain}" maps this panelist to ${model}.`,
      rejectedCandidates: rejected.length > 0 ? rejected : undefined,
    });
    return { ...p, model };
  });

  const preferredSynth = mapping.synthesizer;
  const synthPick = pickModel(preferredSynth, usedModels, availableModels, rawModelsCatalog, isFreeOnly);
  const updatedSynthesizer = { ...synthesizer, model: synthPick.model };
  selectionDetails.push({
    personaName: updatedSynthesizer.name || 'Chairman',
    roleKey: 'synthesizer',
    source: synthPick.source,
    previousModel: synthesizer.model,
    selectedModel: synthPick.model,
    reason: `Domain "${domain}" maps the Chair to ${synthPick.model}.`,
    rejectedCandidates: synthPick.rejected.length > 0 ? synthPick.rejected : undefined,
  });

  const assignments: Record<string, { personaId: string; model: string; rationale: string }> = {};
  updatedPersonas.forEach((p) => {
    assignments[p.id] = { personaId: p.id, model: p.model, rationale: `Domain ${domain} smart assignment` };
  });
  assignments[updatedSynthesizer.id] = {
    personaId: updatedSynthesizer.id,
    model: updatedSynthesizer.model,
    rationale: `Domain ${domain} chair assignment`,
  };

  return {
    domain,
    updatedPersonas,
    updatedSynthesizer,
    assignments,
    autoSelectEnabled: autoSelectModels,
    selectionDetails,
  };
}

export interface RouteCouncilOptions {
  domain: TaskDomain;
  personas: Persona[];
  synthesizer: Persona;
  isFreeOnly?: boolean;
}

export interface RouteCouncilResult {
  assignments: Record<string, { personaId: string; model: string; rationale: string }>;
  updatedPersonas: Persona[];
  updatedSynthesizer: Persona;
}

/**
 * Lightweight routing helper used by pure pipeline consumers.
 */
export function routeCouncilModels(options: RouteCouncilOptions): RouteCouncilResult {
  const result = applySmartModelSelection(options.domain, options.personas, options.synthesizer, {
    isFreeOnly: options.isFreeOnly,
    autoSelectModels: true,
  });
  return {
    assignments: result.assignments,
    updatedPersonas: result.updatedPersonas,
    updatedSynthesizer: result.updatedSynthesizer,
  };
}
