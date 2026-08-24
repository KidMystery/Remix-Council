import { pickBestFromCatalog, isUsableCatalogModel, modelHasVision } from './modelScoring';

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
  /**
   * True when vision was required (image attached) but at least one seated
   * model has no image input — the UI should warn instead of silently
   * wasting the user's time on a model that can't see the attachment.
   */
  visionGap: boolean;
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
  /** Restrict dynamic selection to image-capable models (image attachment present). */
  visionRequired?: boolean;
}): CouncilAllocationPlan {
  const { domain, budgetTier, personas, synthesizer, humanOverrides = {}, catalog, visionRequired = false } = params;

  // Domain-specific benchmark favorites (current Pareto tier, Aug 2026).
  // These are PREFERENCES: before any candidate is seated, it is validated
  // against the live catalog and dynamically re-resolved if it has vanished —
  // free endpoints and frontier models rotate, and we never seat a dead id.
  const DOMAIN_BENCHMARK_TARGETS: Record<TaskDomain, { quality: string[]; cheap: string[]; free: string[] }> = {
    code: {
      quality: ['anthropic/claude-sonnet-4.5', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro'],
      cheap: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
      free: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-oss-120b:free', 'qwen/qwen3-next-80b-a3b-instruct:free'],
    },
    math: {
      quality: ['deepseek/deepseek-r1', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5.1'],
      cheap: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
      free: ['qwen/qwen3-next-80b-a3b-instruct:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-oss-120b:free'],
    },
    finance: {
      quality: ['openai/gpt-5.1', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
      cheap: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'deepseek/deepseek-chat'],
      free: ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'openai/gpt-oss-20b:free'],
    },
    creative: {
      quality: ['google/gemini-2.5-pro', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5.1'],
      cheap: ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini'],
      free: ['google/gemma-4-31b-it:free', 'openai/gpt-oss-120b:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'],
    },
    general: {
      quality: ['google/gemini-2.5-pro', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5.1'],
      cheap: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'deepseek/deepseek-chat'],
      free: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-oss-120b:free', 'google/gemma-4-31b-it:free'],
    },
  };

  /** Live catalog of usable endpoint models (routers/local excluded). */
  const liveCatalog = Array.isArray(catalog) ? catalog.filter(isUsableCatalogModel) : [];
  const liveIds = new Set(liveCatalog.map((m) => String(m.id).toLowerCase()));

  /**
   * Validates a curated candidate against the live catalog; when it has
   * vanished, dynamically picks the best live model for the same tier.
   * Free-tier honesty: when the live catalog has no zero-cost models, the
   * seat is downgraded to a cheap paid model instead of seating a dead id.
   * Vision honesty: when vision is required, a live-but-text-only candidate
   * is swapped for a live vision-capable model (if one exists).
   */
  const resolveLive = (candidate: string, tier: BudgetTier, used: Set<string>): string => {
    if (liveIds.size === 0) return candidate; // offline — trust the curated preference
    const candLower = candidate.toLowerCase();
    const candEntry = liveCatalog.find((m) => m.id.toLowerCase() === candLower);
    const candUsable = candEntry ? (visionRequired ? modelHasVision(candEntry) : true) : false;
    if (candUsable) return candidate;
    const preferOrg = candidate.split('/')[0];
    if (visionRequired) {
      const vision =
        tier === 'free'
          ? pickBestFromCatalog(liveCatalog, 'free', preferOrg, used, true) ||
            pickBestFromCatalog(liveCatalog, 'cheap', preferOrg, used, true)
          : pickBestFromCatalog(liveCatalog, tier, preferOrg, used, true);
      if (vision) return vision.id;
    }
    if (tier === 'free') {
      const free = pickBestFromCatalog(liveCatalog, 'free', preferOrg, used);
      if (free) return free.id;
      const cheap = pickBestFromCatalog(liveCatalog, 'cheap', preferOrg, used);
      return cheap?.id || candidate;
    }
    const replacement = pickBestFromCatalog(liveCatalog, tier, preferOrg, used);
    return replacement?.id || candidate;
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

    // 3. Live-catalog validation: never seat a vanished model.
    selectedModel = resolveLive(selectedModel, budgetTier, assignedModelsInPlan);

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
        ? ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro']
        : budgetTier === 'cheap'
        ? ['google/gemini-2.5-flash', 'openai/gpt-4o-mini']
        : ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-oss-120b:free'];

    let chosenSynth = synthCandidates[0];
    for (const cand of synthCandidates) {
      if (!isDeprecatedModel(cand)) {
        chosenSynth = cand;
        break;
      }
    }

    // Live-catalog validation for the Chair as well.
    chosenSynth = resolveLive(chosenSynth, budgetTier, assignedModelsInPlan);

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

  // Vision gap: vision was required, but some seat is a verified text-only
  // model (e.g. only text-only models exist in the tier pool). The UI should
  // tell the user rather than silently ignoring their image.
  const visionGap = visionRequired
    ? [...Object.values(seats), synthSeat].some((s) => {
        const entry = liveCatalog.find((m) => m.id.toLowerCase() === s.assignedModel.toLowerCase());
        return entry ? !modelHasVision(entry) : false;
      })
    : false;

  return {
    domain,
    budgetTier,
    seats,
    synthesizer: synthSeat,
    estimatedCostPerRoundUSD: estRoundUSD,
    visionGap,
  };
}
