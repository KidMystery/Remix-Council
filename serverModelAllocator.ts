export type TaskDomain = 'code' | 'math' | 'finance' | 'creative' | 'general';
export type BudgetTier = 'free' | 'cheap' | 'quality';

export interface ModelPricing {
  promptUSDPer1M: number;
  completionUSDPer1M: number;
}

export interface AllocatedSeat {
  personaId: string;
  personaName: string;
  role: string;
  assignedModel: string;
  source: 'explicit_override' | 'curated_pareto' | 'policy_default';
  pricing: ModelPricing;
  isFree: boolean;
}

export interface CouncilAllocationPlan {
  domain: TaskDomain;
  budgetTier: BudgetTier;
  seats: Record<string, AllocatedSeat>;
  synthesizer: AllocatedSeat;
  estimatedCostPerRoundUSD: number;
}

export const DEPRECATED_MODEL_PATTERNS = [
  /gpt-3\.5/i,
  /gemini-1\.0/i,
  /gemini-1\.5-flash-8b/i,
  /llama-2/i,
  /claude-1/i,
  /claude-2/i,
  /mistral-7b-instruct-v0\.1/i,
  /deepseek-coder-6\.7b/i,
];

/**
 * Checks if a model identifier matches known deprecated patterns.
 */
export function isDeprecatedModel(modelId: string): boolean {
  if (!modelId) return false;
  return DEPRECATED_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}

/**
 * Extracts normalized USD pricing per 1M tokens from OpenRouter model schema.
 */
export function extractPricingUSD(modelObj: any): ModelPricing {
  if (!modelObj?.pricing) {
    return { promptUSDPer1M: 0.30, completionUSDPer1M: 1.20 };
  }
  const prompt = parseFloat(String(modelObj.pricing.prompt || '0'));
  const completion = parseFloat(String(modelObj.pricing.completion || '0'));
  return {
    promptUSDPer1M: Number.isFinite(prompt) ? prompt * 1_000_000 : 0.30,
    completionUSDPer1M: Number.isFinite(completion) ? completion * 1_000_000 : 1.20,
  };
}

/**
 * Allocates optimal council seats obeying explicit human overrides first.
 */
export function allocateCouncilSeats(params: {
  domain: TaskDomain;
  budgetTier: BudgetTier;
  personas: Array<{ id: string; name: string; role: string; model?: string }>;
  synthesizer: { id: string; name: string; role: string; model?: string };
  humanOverrides?: Record<string, string>; // personaId -> requested modelId
  catalog: any[];
}): CouncilAllocationPlan {
  const { domain, budgetTier, personas, synthesizer, humanOverrides = {}, catalog } = params;

  // Domain-specific benchmark favorites (Modern Pareto tier)
  const DOMAIN_BENCHMARK_TARGETS: Record<TaskDomain, { quality: string[]; cheap: string[]; free: string[] }> = {
    code: {
      quality: ['anthropic/claude-3.7-sonnet', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro'],
      cheap: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
      free: ['deepseek/deepseek-r1:free', 'meta-llama/llama-3.2-3b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
    },
    math: {
      quality: ['deepseek/deepseek-r1', 'anthropic/claude-3.7-sonnet', 'openai/o3-mini'],
      cheap: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
      free: ['deepseek/deepseek-r1:free', 'google/gemini-2.0-flash-exp:free', 'qwen/qwen-2.5-72b-instruct:free'],
    },
    finance: {
      quality: ['openai/gpt-4o', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-pro'],
      cheap: ['google/gemini-2.5-flash', 'anthropic/claude-3.5-haiku', 'deepseek/deepseek-chat'],
      free: ['google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-r1:free', 'meta-llama/llama-3.2-3b-instruct:free'],
    },
    creative: {
      quality: ['google/gemini-2.5-pro', 'anthropic/claude-3.7-sonnet', 'openai/gpt-4o'],
      cheap: ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.5-flash', 'anthropic/claude-3.5-haiku'],
      free: ['meta-llama/llama-3.2-3b-instruct:free', 'google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-r1:free'],
    },
    general: {
      quality: ['google/gemini-2.5-pro', 'anthropic/claude-3.7-sonnet', 'openai/gpt-4o'],
      cheap: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku'],
      free: ['google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.2-3b-instruct:free', 'deepseek/deepseek-r1:free'],
    },
  };

  const assignedModelsInPlan = new Set<string>();
  const seats: Record<string, AllocatedSeat> = {};

  // Resolve Panelists
  personas.forEach((p, idx) => {
    const override = humanOverrides[p.id];

    // 1. Human Explicit Command Override
    if (override && override.trim()) {
      const target = override.trim();
      const catalogEntry = catalog.find((m) => m?.id?.toLowerCase() === target.toLowerCase());
      const pricing = extractPricingUSD(catalogEntry);
      seats[p.id] = {
        personaId: p.id,
        personaName: p.name,
        role: p.role,
        assignedModel: catalogEntry?.id || target,
        source: 'explicit_override',
        pricing,
        isFree: target.endsWith(':free') || (catalogEntry ? pricing.promptUSDPer1M === 0 : false),
      };
      assignedModelsInPlan.add(seats[p.id].assignedModel.toLowerCase());
      return;
    }

    // 2. Dynamic Pareto Selection (filtered against deprecation)
    const domainTargets = DOMAIN_BENCHMARK_TARGETS[domain] || DOMAIN_BENCHMARK_TARGETS.general;
    const candidates = domainTargets[budgetTier] || domainTargets.cheap || DOMAIN_BENCHMARK_TARGETS.general[budgetTier];
    let selectedModel = candidates[idx % candidates.length] || candidates[0];

    // Find first distinct, non-deprecated model from candidates
    for (const cand of candidates) {
      if (!assignedModelsInPlan.has(cand.toLowerCase()) && !isDeprecatedModel(cand)) {
        selectedModel = cand;
        break;
      }
    }

    const catalogEntry = catalog.find((m) => m?.id?.toLowerCase() === selectedModel.toLowerCase());
    const pricing = extractPricingUSD(catalogEntry);
    seats[p.id] = {
      personaId: p.id,
      personaName: p.name,
      role: p.role,
      assignedModel: catalogEntry?.id || selectedModel,
      source: 'curated_pareto',
      pricing,
      isFree: budgetTier === 'free' || selectedModel.endsWith(':free') || (catalogEntry ? pricing.promptUSDPer1M === 0 : false),
    };
    assignedModelsInPlan.add(seats[p.id].assignedModel.toLowerCase());
  });

  // Resolve Synthesizer (The Chair)
  const synthOverride = humanOverrides[synthesizer.id] || humanOverrides['synthesizer'];
  let synthSeat: AllocatedSeat;

  if (synthOverride && synthOverride.trim()) {
    const target = synthOverride.trim();
    const catalogEntry = catalog.find((m) => m?.id?.toLowerCase() === target.toLowerCase());
    const pricing = extractPricingUSD(catalogEntry);
    synthSeat = {
      personaId: synthesizer.id,
      personaName: synthesizer.name,
      role: synthesizer.role,
      assignedModel: catalogEntry?.id || target,
      source: 'explicit_override',
      pricing,
      isFree: target.endsWith(':free') || (catalogEntry ? pricing.promptUSDPer1M === 0 : false),
    };
  } else {
    // Chair requires strong synthesis capabilities
    const synthCandidates =
      budgetTier === 'quality'
        ? ['google/gemini-2.5-pro', 'anthropic/claude-3.7-sonnet']
        : budgetTier === 'cheap'
        ? ['google/gemini-2.5-flash', 'openai/gpt-4o-mini']
        : ['google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-r1:free'];

    let chosenSynth = synthCandidates[0];
    for (const cand of synthCandidates) {
      if (!isDeprecatedModel(cand)) {
        chosenSynth = cand;
        break;
      }
    }

    const catalogEntry = catalog.find((m) => m?.id?.toLowerCase() === chosenSynth.toLowerCase());
    const pricing = extractPricingUSD(catalogEntry);
    synthSeat = {
      personaId: synthesizer.id,
      personaName: synthesizer.name,
      role: synthesizer.role,
      assignedModel: catalogEntry?.id || chosenSynth,
      source: 'curated_pareto',
      pricing,
      isFree: budgetTier === 'free' || chosenSynth.endsWith(':free') || (catalogEntry ? pricing.promptUSDPer1M === 0 : false),
    };
  }

  // Pre-calculate estimated cost per round (assuming 2k input, 800 output tokens per seat)
  let estRoundUSD = 0;
  Object.values(seats).forEach((s) => {
    estRoundUSD += (2000 / 1_000_000) * s.pricing.promptUSDPer1M + (800 / 1_000_000) * s.pricing.completionUSDPer1M;
  });
  estRoundUSD += (4000 / 1_000_000) * synthSeat.pricing.promptUSDPer1M + (1500 / 1_000_000) * synthSeat.pricing.completionUSDPer1M;

  return {
    domain,
    budgetTier,
    seats,
    synthesizer: synthSeat,
    estimatedCostPerRoundUSD: estRoundUSD,
  };
}
