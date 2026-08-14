import { RawOpenRouterModel } from './presets';

export function cleanModelName(modelId: string, modelName?: string): string {
  if (modelName && modelName.trim() && modelName !== modelId) {
    return modelName.replace(/\s*\(free\)/i, '').replace(/\s*\(nitro\)/i, '').trim();
  }
  if (!modelId) return 'Unknown Model';
  const parts = modelId.split('/');
  const namePart = parts.length > 1 ? parts[1] : parts[0];
  return namePart
    .replace(/:free$/i, '')
    .replace(/:thinking$/i, '')
    .replace(/:extended$/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .trim();
}

export interface AssignedModel {
  personaId: 'skeptic' | 'visionary' | 'pragmatist' | 'synthesizer';
  model: string;
  name: string;
  alsoInPresets?: string[];
}

export interface MappedModels {
  fastAndFree: AssignedModel[];
  fastAndCheap: AssignedModel[];
  bestValue: AssignedModel[];
  highestQuality: AssignedModel[];
  // Alias for backward compatibility
  fastest: AssignedModel[];
  warnings: string[];
}

export const EXPECTED_INPUT_TOKENS = 1500;
export const EXPECTED_OUTPUT_TOKENS = 600;

export function safeParseFloat(val: string | number | undefined): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
}

export function estimatedCost(model: RawOpenRouterModel): number {
  const requestPrice    = safeParseFloat(model.pricing?.request);
  const promptPrice     = safeParseFloat(model.pricing?.prompt);
  const completionPrice = safeParseFloat(model.pricing?.completion);

  return requestPrice
       + promptPrice    * EXPECTED_INPUT_TOKENS
       + completionPrice * EXPECTED_OUTPUT_TOKENS;
}

export function isFreeModel(model: RawOpenRouterModel): boolean {
  if (!model?.id || !model.pricing) return false;

  const id = model.id.toLowerCase();
  if (id === 'openrouter/free' || id === 'openrouter/auto' || id.includes('openrouter/free')) {
    return false;
  }

  const request = safeParseFloat(model.pricing.request);
  const prompt = safeParseFloat(model.pricing.prompt);
  const completion = safeParseFloat(model.pricing.completion);

  const FREE_EPSILON = 0.000001; // OpenRouter sometimes returns 0.0000001

  return (
    request <= FREE_EPSILON &&
    prompt <= FREE_EPSILON &&
    completion <= FREE_EPSILON &&
    (model.context_length ?? 4096) >= 2048
  );
}

/**
 * Extracts the author organization from an OpenRouter model ID.
 * Removes optional leading tilde, takes portion before first slash, normalized to lowercase.
 */
export function getAuthorOrganization(modelId: string): string {
  const cleaned = modelId.startsWith('~') ? modelId.slice(1) : modelId;
  return cleaned.split('/')[0].toLowerCase();
}

/**
 * Alias for backward compatibility.
 */
export function getProvider(id: string): string {
  return getAuthorOrganization(id);
}

/**
 * Constructs the base model family key.
 * - Uses canonical_slug when available
 * - Strips variant suffixes: :free, :thinking, :extended, :batch
 * - Strips trailing pinned dates (e.g. -20241022, -2024-10-22)
 * - Preserves meaningful generation numbers (2.5, 4.1, 3.7, 3.5, 4o, 2.0, etc.)
 * - Does not merge different model generations
 */
export function getFamily(input: RawOpenRouterModel | string): string {
  let id = typeof input === 'string' ? input : (input.canonical_slug || input.id);
  let family = id.toLowerCase().trim();
  if (family.startsWith('~')) family = family.substring(1);

  // Strip variant suffixes
  family = family.replace(/:(free|thinking|extended|batch|nitro)$/i, '');
  family = family.replace(/:[\w-]+$/, '');

  // Strip trailing pinned dates
  family = family.replace(/-\d{4}-\d{2}-\d{2}(?:-\d+)?$/, '');
  family = family.replace(/-\d{8}$/, '');

  // Strip status/mode tags while preserving generation numbers
  family = family.replace(/-(preview|exp|latest|instruct|beta|experimental)$/i, '');

  return family;
}

/**
 * Extracts the concrete canonical target ID to prevent selecting both an alias
 * and the concrete model it points to.
 */
export function getCanonicalTarget(m: RawOpenRouterModel): string {
  const raw = (m.canonical_slug || m.id).toLowerCase().trim();
  return raw.startsWith('~') ? raw.substring(1) : raw;
}

export function parseVal(val: string | number | undefined): number {
  return safeParseFloat(val);
}

export function getModelPrice(m: RawOpenRouterModel): number {
  return estimatedCost(m);
}

export function isZeroCostModel(m: RawOpenRouterModel): boolean {
  return isFreeModel(m);
}

/**
 * Filters models by maximum age in days (e.g. 365 or 540) and excludes expired models.
 */
function filterByAgeAndExpiration(rawModels: RawOpenRouterModel[], maxAgeDays: number): RawOpenRouterModel[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - 86400 * maxAgeDays;

  return rawModels.filter(m => {
    if ((m as any).expiration_date) {
      const expTs = new Date((m as any).expiration_date).getTime() / 1000;
      if (expTs < nowSec) return false;
    }

    if (m.created && m.created < cutoffSec) return false;

    const match = m.id.match(/-(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const dateTs = new Date(match[1]).getTime() / 1000;
      if (dateTs < cutoffSec) return false;
    }

    return true;
  });
}

// =========================================================================
// RANK MAPS & SCORING
// =========================================================================

/**
 * Builds a rank map for a list of items along a given dimension.
 * Formula: normalizedRank = 1 - rankIndex / Math.max(listLength - 1, 1)
 * First-ranked model ≈ 1.0, Last-ranked model ≈ 0.0
 */
export function buildRankMap<T>(
  items: T[],
  getValue: (item: T) => number | undefined,
  higherIsBetter: boolean
): Map<T, number> {
  const validItems = items.filter(item => {
    const val = getValue(item);
    return val !== undefined && val !== null && !isNaN(val);
  });

  validItems.sort((a, b) => {
    const valA = getValue(a)!;
    const valB = getValue(b)!;
    const d = higherIsBetter ? valB - valA : valA - valB;
    if (Math.abs(d) > 1e-6) return d;
    const idA = (a as any).id || '';
    const idB = (b as any).id || '';
    return idA.localeCompare(idB);
  });

  const rankMap = new Map<T, number>();
  const listLength = validItems.length;
  const divisor = Math.max(listLength - 1, 1);

  validItems.forEach((item, index) => {
    const normalizedRank = 1 - index / divisor;
    rankMap.set(item, normalizedRank);
  });

  return rankMap;
}

export interface DimensionSpec {
  getValue: (m: RawOpenRouterModel) => number | undefined;
  higherIsBetter: boolean;
  weight: number;
}

/**
 * Computes model score across available dimensions.
 * If a dimension is unavailable for a model:
 * - Reweights remaining available dimensions proportionally
 * - Does NOT treat missing values as perfect scores (does not default to 1.0)
 */
export function computeModelScore(
  model: RawOpenRouterModel,
  dimensions: { rankMap: Map<RawOpenRouterModel, number>; weight: number }[]
): number {
  let totalScore = 0;
  let totalWeight = 0;

  for (const { rankMap, weight } of dimensions) {
    const rankVal = rankMap.get(model);
    if (rankVal !== undefined) {
      totalScore += rankVal * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 0.0;
  return totalScore / totalWeight;
}

/**
 * Greedy selection: highest-scoring model whose organization, family, and canonical target
 * are not yet used.
 * Maximum 1 model per author organization and 1 model per model family per council.
 * Excludes aliases of already selected concrete models.
 */
function selectGreedyUniqueOrgAndFamily(candidates: RawOpenRouterModel[]): RawOpenRouterModel[] {
  const selected: RawOpenRouterModel[] = [];
  const usedOrgs = new Set<string>();
  const usedFamilies = new Set<string>();
  const usedCanonicalTargets = new Set<string>();

  for (const m of candidates) {
    if (selected.length >= 4) break;
    const org = getAuthorOrganization(m.id);
    const family = getFamily(m);
    const target = getCanonicalTarget(m);

    // Filter pure auto router / generic router alias IDs or unverified test endpoints
    const lowerId = m.id.toLowerCase();
    if (
      lowerId === 'openrouter/auto' ||
      lowerId === 'openrouter/free' ||
      lowerId.startsWith('~') ||
      lowerId.includes('/~') ||
      lowerId.includes(':batch') ||
      lowerId.includes('auto-beta')
    ) {
      continue;
    }

    if (usedOrgs.has(org) || usedFamilies.has(family) || usedCanonicalTargets.has(target)) {
      continue;
    }

    selected.push(m);
    usedOrgs.add(org);
    usedFamilies.add(family);
    usedCanonicalTargets.add(target);
  }

  return selected;
}

/**
 * Builds a council with age limit relaxation (365 days -> 540 days if < 4 orgs found).
 * NEVER relaxes the unique author organization rule.
 */
function buildCouncilWithAgeRelaxation(
  rawModels: RawOpenRouterModel[],
  getCandidatePoolAndScore: (models: RawOpenRouterModel[]) => { pool: RawOpenRouterModel[]; scores: Map<RawOpenRouterModel, number> },
  councilName: string,
  warnings: string[]
): { council: RawOpenRouterModel[]; pool: RawOpenRouterModel[]; scores: Map<RawOpenRouterModel, number> } {
  // 1. Try initial age cutoff of 365 days
  const models365 = filterByAgeAndExpiration(rawModels, 365);
  const { pool: pool365, scores: scores365 } = getCandidatePoolAndScore(models365);
  let council = selectGreedyUniqueOrgAndFamily(pool365);
  let activePool = pool365;
  let activeScores = scores365;

  // 2. If fewer than 4 unique author orgs found, relax age cutoff to 540 days
  if (council.length < 4) {
    const models540 = filterByAgeAndExpiration(rawModels, 540);
    const { pool: pool540, scores: scores540 } = getCandidatePoolAndScore(models540);
    council = selectGreedyUniqueOrgAndFamily(pool540);
    activePool = pool540;
    activeScores = scores540;
  }

  // 3. If still fewer than 4 unique author orgs, issue a UI warning (never add duplicate orgs!)
  if (council.length < 4) {
    warnings.push(`Warning: Only ${council.length} distinct author organization(s) could be found for the ${councilName} council (4 required).`);
  }

  return { council, pool: activePool, scores: activeScores };
}

interface PresetCouncilData {
  presetKey: 'fastAndFree' | 'fastAndCheap' | 'bestValue' | 'highestQuality';
  presetName: string;
  isFreeOnly: boolean;
  isPaidOnly: boolean;
  council: RawOpenRouterModel[];
  pool: RawOpenRouterModel[];
  scores: Map<RawOpenRouterModel, number>;
}

export function mapOpenRouterModels(rawModels: RawOpenRouterModel[]): MappedModels {
  const warnings: string[] = [];

  // Extractors for rank maps
  const getLatency = (m: RawOpenRouterModel) => m.top_provider?.latency ?? m.benchmarks?.latency;
  const getThroughput = (m: RawOpenRouterModel) => m.top_provider?.throughput ?? m.benchmarks?.throughput;
  const getPricing = (m: RawOpenRouterModel) => estimatedCost(m);
  const getIntelligence = (m: RawOpenRouterModel) => m.benchmarks?.intelligence ?? (m.context_length ? Math.min(m.context_length, 2000000) : undefined);
  const getCoding = (m: RawOpenRouterModel) => m.benchmarks?.coding;
  const getAgentic = (m: RawOpenRouterModel) => m.benchmarks?.agentic;
  const getDesignArenaElo = (m: RawOpenRouterModel) => m.benchmarks?.design_arena_elo ?? m.benchmarks?.arena_elo ?? m.benchmarks?.elo;
  const getWeeklyPopularity = (m: RawOpenRouterModel) => m.benchmarks?.weekly_popularity;
  const getRecency = (m: RawOpenRouterModel) => m.created;

  // =========================================================================
  // 1. FAST & FREE ($0 models optimized for speed)
  // =========================================================================
  const getFastAndFreePoolAndScore = (models: RawOpenRouterModel[]) => {
    const freeCandidates = models.filter(m => isFreeModel(m));

    const latencyRankMap = buildRankMap(freeCandidates, getLatency, false);
    const throughputRankMap = buildRankMap(freeCandidates, getThroughput, true);
    const intelRankMap = buildRankMap(freeCandidates, getIntelligence, true);
    const recencyRankMap = buildRankMap(freeCandidates, getRecency, true);

    const dims = [
      { rankMap: throughputRankMap, weight: 0.45 },
      { rankMap: latencyRankMap, weight: 0.35 },
      { rankMap: intelRankMap, weight: 0.15 },
      { rankMap: recencyRankMap, weight: 0.05 },
    ];

    const scores = new Map<RawOpenRouterModel, number>();
    freeCandidates.forEach(m => scores.set(m, computeModelScore(m, dims)));

    const pool = [...freeCandidates].sort((a, b) => {
      const d = (scores.get(b) || 0) - (scores.get(a) || 0);
      return Math.abs(d) > 1e-6 ? d : a.id.localeCompare(b.id);
    });
    return { pool, scores };
  };

  const fastAndFreeRes = buildCouncilWithAgeRelaxation(rawModels, getFastAndFreePoolAndScore, 'Fast & Free', warnings);

  // =========================================================================
  // 2. FAST & CHEAP (Fast paid models at a low cost)
  // =========================================================================
  const getFastAndCheapPoolAndScore = (models: RawOpenRouterModel[]) => {
    const paidEligible = models.filter(m => {
      const cost = estimatedCost(m);
      if (cost <= 0) return false;
      if (m.id.endsWith(':free')) return false;
      if (m.id.toLowerCase().includes('openrouter/free')) return false;
      return true;
    });

    paidEligible.sort((a, b) => estimatedCost(a) - estimatedCost(b));

    let poolCutoffCount = Math.max(4, Math.ceil(paidEligible.length * 0.35));
    let pool = paidEligible.slice(0, poolCutoffCount);

    const orgCountInPool = new Set(pool.map(m => getAuthorOrganization(m.id))).size;
    if (orgCountInPool < 4 && paidEligible.length > poolCutoffCount) {
      poolCutoffCount = Math.max(4, Math.ceil(paidEligible.length * 0.50));
      pool = paidEligible.slice(0, poolCutoffCount);
    }

    const latencyRankMap = buildRankMap(pool, getLatency, false);
    const throughputRankMap = buildRankMap(pool, getThroughput, true);
    const pricingRankMap = buildRankMap(pool, getPricing, false);
    const intelRankMap = buildRankMap(pool, getIntelligence, true);

    const dims = [
      { rankMap: latencyRankMap, weight: 0.40 },
      { rankMap: throughputRankMap, weight: 0.25 },
      { rankMap: pricingRankMap, weight: 0.25 },
      { rankMap: intelRankMap, weight: 0.10 },
    ];

    const scores = new Map<RawOpenRouterModel, number>();
    pool.forEach(m => scores.set(m, computeModelScore(m, dims)));

    const sortedPool = [...pool].sort((a, b) => {
      const d = (scores.get(b) || 0) - (scores.get(a) || 0);
      return Math.abs(d) > 1e-6 ? d : a.id.localeCompare(b.id);
    });
    return { pool: sortedPool, scores };
  };

  const fastAndCheapRes = buildCouncilWithAgeRelaxation(rawModels, getFastAndCheapPoolAndScore, 'Fast & Cheap', warnings);

  // =========================================================================
  // 3. BEST VALUE (Best quality-to-cost balance)
  // =========================================================================
  const getBestValuePoolAndScore = (models: RawOpenRouterModel[]) => {
    const paidEligible = models.filter(m => {
      const cost = estimatedCost(m);
      if (cost <= 0) return false;
      if (m.id.endsWith(':free')) return false;
      if (m.id.toLowerCase().includes('openrouter/free')) return false;
      return true;
    });

    const intelRankMap = buildRankMap(paidEligible, getIntelligence, true);
    const codingRankMap = buildRankMap(paidEligible, getCoding, true);
    const agenticRankMap = buildRankMap(paidEligible, getAgentic, true);
    const designEloRankMap = buildRankMap(paidEligible, getDesignArenaElo, true);
    const popRankMap = buildRankMap(paidEligible, getWeeklyPopularity, true);
    const pricingRankMap = buildRankMap(paidEligible, getPricing, false);
    const latencyRankMap = buildRankMap(paidEligible, getLatency, false);
    const recencyRankMap = buildRankMap(paidEligible, getRecency, true);

    const dims = [
      { rankMap: intelRankMap, weight: 0.20 },
      { rankMap: codingRankMap, weight: 0.15 },
      { rankMap: agenticRankMap, weight: 0.10 },
      { rankMap: designEloRankMap, weight: 0.10 },
      { rankMap: popRankMap, weight: 0.10 },
      { rankMap: pricingRankMap, weight: 0.25 },
      { rankMap: latencyRankMap, weight: 0.05 },
      { rankMap: recencyRankMap, weight: 0.05 },
    ];

    const scores = new Map<RawOpenRouterModel, number>();
    paidEligible.forEach(m => scores.set(m, computeModelScore(m, dims)));

    const sortedPool = [...paidEligible].sort((a, b) => {
      const d = (scores.get(b) || 0) - (scores.get(a) || 0);
      return Math.abs(d) > 1e-6 ? d : a.id.localeCompare(b.id);
    });
    return { pool: sortedPool, scores };
  };

  const bestValueRes = buildCouncilWithAgeRelaxation(rawModels, getBestValuePoolAndScore, 'Best Value', warnings);

  // =========================================================================
  // 4. HIGHEST QUALITY (Top overall capability; price is secondary)
  // =========================================================================
  const getHighestQualityPoolAndScore = (models: RawOpenRouterModel[]) => {
    const intelRankMap = buildRankMap(models, getIntelligence, true);
    const codingRankMap = buildRankMap(models, getCoding, true);
    const agenticRankMap = buildRankMap(models, getAgentic, true);
    const designEloRankMap = buildRankMap(models, getDesignArenaElo, true);
    const popRankMap = buildRankMap(models, getWeeklyPopularity, true);
    const recencyRankMap = buildRankMap(models, getRecency, true);

    const dims = [
      { rankMap: intelRankMap, weight: 0.35 },
      { rankMap: codingRankMap, weight: 0.20 },
      { rankMap: agenticRankMap, weight: 0.15 },
      { rankMap: designEloRankMap, weight: 0.15 },
      { rankMap: popRankMap, weight: 0.10 },
      { rankMap: recencyRankMap, weight: 0.05 },
    ];

    const scores = new Map<RawOpenRouterModel, number>();
    models.forEach(m => scores.set(m, computeModelScore(m, dims)));

    const sortedPool = [...models].sort((a, b) => {
      const d = (scores.get(b) || 0) - (scores.get(a) || 0);
      return Math.abs(d) > 1e-6 ? d : a.id.localeCompare(b.id);
    });
    return { pool: sortedPool, scores };
  };

  const highestQualityRes = buildCouncilWithAgeRelaxation(rawModels, getHighestQualityPoolAndScore, 'Highest Quality', warnings);

  const presetsData: PresetCouncilData[] = [
    {
      presetKey: 'fastAndFree',
      presetName: 'Fast & Free',
      isFreeOnly: true,
      isPaidOnly: false,
      council: [...fastAndFreeRes.council],
      pool: fastAndFreeRes.pool,
      scores: fastAndFreeRes.scores,
    },
    {
      presetKey: 'fastAndCheap',
      presetName: 'Fast & Cheap',
      isFreeOnly: false,
      isPaidOnly: true,
      council: [...fastAndCheapRes.council],
      pool: fastAndCheapRes.pool,
      scores: fastAndCheapRes.scores,
    },
    {
      presetKey: 'bestValue',
      presetName: 'Best Value',
      isFreeOnly: false,
      isPaidOnly: true,
      council: [...bestValueRes.council],
      pool: bestValueRes.pool,
      scores: bestValueRes.scores,
    },
    {
      presetKey: 'highestQuality',
      presetName: 'Highest Quality',
      isFreeOnly: false,
      isPaidOnly: false,
      council: [...highestQualityRes.council],
      pool: highestQualityRes.pool,
      scores: highestQualityRes.scores,
    },
  ];

  // =========================================================================
  // CROSS-PRESET DEDUPLICATION & SUBSTITUTION
  // =========================================================================
  // Rule 1: If the same canonical model appears in >1 preset:
  // - Keep it in the preset where it scores highest relative to that preset's formula
  // - For other presets: substitute next-best eligible candidate not used anywhere in any preset
  // Rule 2: If no valid substitute exists without violating eligibility, allow overlap & flag badge
  // Rule 3: Free/paid eligibility rules are never relaxed during substitution

  let changedInPass = true;
  let passCount = 0;

  while (changedInPass && passCount < 10) {
    changedInPass = false;
    passCount++;

    // Find models appearing in multiple presets
    const targetToPresets = new Map<string, { presetIndex: number; model: RawOpenRouterModel; score: number }[]>();

    presetsData.forEach((pData, pIdx) => {
      pData.council.forEach(m => {
        const target = getCanonicalTarget(m);
        const score = pData.scores.get(m) ?? 0;
        if (!targetToPresets.has(target)) {
          targetToPresets.set(target, []);
        }
        targetToPresets.get(target)!.push({ presetIndex: pIdx, model: m, score });
      });
    });

    for (const [target, occurrences] of targetToPresets.entries()) {
      if (occurrences.length <= 1) continue;

      // Find the preset where this model achieved the HIGHEST relative formula score
      occurrences.sort((a, b) => b.score - a.score);
      const winner = occurrences[0];
      const losers = occurrences.slice(1);

      // Collect all model canonical targets currently in use across ALL 4 preset councils
      const allSelectedTargets = new Set<string>();
      presetsData.forEach(pd => pd.council.forEach(m => allSelectedTargets.add(getCanonicalTarget(m))));

      for (const loser of losers) {
        const loserData = presetsData[loser.presetIndex];
        const modelToReplace = loser.model;

        // Current used orgs, families, targets in loser's council (excluding modelToReplace)
        const loserOtherOrgs = new Set<string>(
          loserData.council.filter(m => m !== modelToReplace).map(m => getAuthorOrganization(m.id))
        );
        const loserOtherFamilies = new Set<string>(
          loserData.council.filter(m => m !== modelToReplace).map(m => getFamily(m))
        );
        const loserOtherTargets = new Set<string>(
          loserData.council.filter(m => m !== modelToReplace).map(m => getCanonicalTarget(m))
        );

        // Find best substitute S from loserData.pool
        let substitute: RawOpenRouterModel | null = null;

        for (const candidate of loserData.pool) {
          const candTarget = getCanonicalTarget(candidate);
          const candOrg = getAuthorOrganization(candidate.id);
          const candFamily = getFamily(candidate);

          // Must not be currently used in ANY preset council
          if (allSelectedTargets.has(candTarget)) continue;

          // Must satisfy loser preset's eligibility
          if (loserData.isFreeOnly && !isFreeModel(candidate)) continue;
          if (loserData.isPaidOnly) {
            const cost = estimatedCost(candidate);
            if (cost <= 0 || candidate.id.endsWith(':free') || candidate.id.toLowerCase().includes('openrouter/free')) {
              continue;
            }
          }

          // Must satisfy loser council's org and family uniqueness
          if (loserOtherOrgs.has(candOrg)) continue;
          if (loserOtherFamilies.has(candFamily)) continue;
          if (loserOtherTargets.has(candTarget)) continue;

          // Found a valid substitute!
          substitute = candidate;
          break;
        }

        if (substitute) {
          const idx = loserData.council.indexOf(modelToReplace);
          if (idx !== -1) {
            loserData.council[idx] = substitute;
            changedInPass = true;
          }
        }
      }
    }
  }

  // Final check for unavoidable overlaps and mark overlap badges ("Also in [Preset Name]")
  const modelToPresetNames = new Map<string, string[]>();

  presetsData.forEach(pData => {
    pData.council.forEach(m => {
      const target = getCanonicalTarget(m);
      if (!modelToPresetNames.has(target)) {
        modelToPresetNames.set(target, []);
      }
      if (!modelToPresetNames.get(target)!.includes(pData.presetName)) {
        modelToPresetNames.get(target)!.push(pData.presetName);
      }
    });
  });

  const assignRoles = (council: RawOpenRouterModel[], currentPresetName: string): AssignedModel[] => {
    const roles: ('skeptic' | 'visionary' | 'pragmatist' | 'synthesizer')[] = ['skeptic', 'visionary', 'pragmatist', 'synthesizer'];
    if (council.length === 0) {
      return roles.map(r => ({ personaId: r, model: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash' }));
    }

  // Role capability scoring functions based on personality traits
  const getEstimatedCapabilities = (m: RawOpenRouterModel) => {
    const id = m.id.toLowerCase();
    
    let coding = m.benchmarks?.coding;
    let intel = m.benchmarks?.intelligence;
    let agentic = m.benchmarks?.agentic;
    let design = m.benchmarks?.design_arena_elo ?? m.benchmarks?.arena_elo;

    // Intelligent capability fallbacks based on model provider strengths
    if (coding === undefined) {
      if (id.includes('claude-3.7-sonnet') || id.includes('claude-3-7-sonnet')) coding = 0.99;
      else if (id.includes('claude-3.5-sonnet') || id.includes('claude-3-5-sonnet')) coding = 0.98;
      else if (id.includes('deepseek-r1') || id.includes('deepseek-coder')) coding = 0.96;
      else if (id.includes('qwen-2.5-coder') || id.includes('qwen-2.5-72b')) coding = 0.94;
      else if (id.includes('o3-mini') || id.includes('o1')) coding = 0.93;
      else if (id.includes('claude-3.5-haiku') || id.includes('claude-3-5-haiku')) coding = 0.90;
      else if (id.includes('gpt-4o')) coding = 0.90;
      else if (id.includes('gemini-3.7-flash')) coding = 0.92;
      else if (id.includes('gemini-2.5-pro') || id.includes('gemini-2.0-pro')) coding = 0.90;
      else if (id.includes('gemini-2.5-flash') || id.includes('gemini-2.0-flash')) coding = 0.85;
      else if (id.includes('anthropic/')) coding = 0.92;
      else if (id.includes('deepseek/')) coding = 0.90;
      else coding = 0.50;
    }

    if (intel === undefined) {
      if (id.includes('claude-3.7-sonnet') || id.includes('claude-3-7-sonnet')) intel = 0.99;
      else if (id.includes('deepseek-r1')) intel = 0.98;
      else if (id.includes('o3-mini') || id.includes('o1')) intel = 0.97;
      else if (id.includes('claude-3.5-sonnet') || id.includes('claude-3-5-sonnet')) intel = 0.96;
      else if (id.includes('gpt-4o')) intel = 0.95;
      else if (id.includes('gemini-3.7-flash')) intel = 0.94;
      else if (id.includes('gemini-2.5-pro') || id.includes('gemini-2.0-pro')) intel = 0.93;
      else if (id.includes('gemini-2.5-flash') || id.includes('gemini-2.0-flash')) intel = 0.88;
      else if (id.includes('llama-3.3-70b')) intel = 0.89;
      else intel = 0.60;
    }

    if (agentic === undefined) {
      if (id.includes('claude-3.7-sonnet') || id.includes('claude-3.5-sonnet')) agentic = 0.98;
      else if (id.includes('gpt-4o') || id.includes('o3-mini')) agentic = 0.94;
      else if (id.includes('deepseek-r1')) agentic = 0.93;
      else if (id.includes('gemini-3.7') || id.includes('gemini-2.5')) agentic = 0.92;
      else agentic = 0.60;
    }

    if (design === undefined) {
      if (id.includes('gemini-3.7-flash') || id.includes('gemini-2.5-flash')) design = 0.98;
      else if (id.includes('claude-3.7-sonnet') || id.includes('claude-3.5-sonnet')) design = 0.96;
      else if (id.includes('gpt-4o')) design = 0.95;
      else design = 0.60;
    }

    return { coding, intel, agentic, design };
  };

  const getSkepticScore = (m: RawOpenRouterModel) => {
    const caps = getEstimatedCapabilities(m);
    return caps.coding * 0.50 + caps.intel * 0.30 + caps.agentic * 0.20;
  };

  const getVisionaryScore = (m: RawOpenRouterModel) => {
    const caps = getEstimatedCapabilities(m);
    const ctx = m.context_length ? Math.min(m.context_length / 200000, 1) : 0.5;
    return caps.design * 0.50 + ctx * 0.30 + caps.intel * 0.20;
  };

  const getPragmatistScore = (m: RawOpenRouterModel) => {
    const tp = getThroughput(m) ?? 0.5;
    const lat = getLatency(m) !== undefined ? (1 - Math.min(getLatency(m)! / 5000, 1)) : 0.5;
    const price = 1 - Math.min(estimatedCost(m) / 0.01, 1);
    const caps = getEstimatedCapabilities(m);
    return tp * 0.35 + lat * 0.25 + price * 0.20 + caps.coding * 0.20;
  };

  const getSynthesizerScore = (m: RawOpenRouterModel) => {
    const caps = getEstimatedCapabilities(m);
    return caps.intel * 0.50 + caps.agentic * 0.30 + caps.design * 0.20;
  };

    // Permutation optimizer to assign 4 council models to the 4 personality roles
    const permute = (arr: RawOpenRouterModel[]): RawOpenRouterModel[][] => {
      if (arr.length <= 1) return [arr];
      const res: RawOpenRouterModel[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of permute(rest)) {
          res.push([arr[i], ...p]);
        }
      }
      return res;
    };

    const permutations = permute(council);
    let bestPerm = council;
    let bestScore = -Infinity;

    for (const perm of permutations) {
      const s0 = getSkepticScore(perm[0] || council[0]);
      const s1 = getVisionaryScore(perm[1] || council[0]);
      const s2 = getPragmatistScore(perm[2] || council[0]);
      const s3 = getSynthesizerScore(perm[3] || council[0]);
      const total = s0 + s1 + s2 + s3;
      if (total > bestScore) {
        bestScore = total;
        bestPerm = perm;
      }
    }

    const assigned: AssignedModel[] = [];
    for (let i = 0; i < 4; i++) {
      const role = roles[i];
      const modelObj = bestPerm[i] || council[0];
      const target = getCanonicalTarget(modelObj);
      const allPresetsWithModel = modelToPresetNames.get(target) || [];
      const otherPresets = allPresetsWithModel.filter(p => p !== currentPresetName);

      assigned.push({
        personaId: role,
        model: modelObj.id,
        name: cleanModelName(modelObj.id, modelObj.name),
        alsoInPresets: otherPresets.length > 0 ? otherPresets : undefined,
      });
    }

    return assigned;
  };

  const mappedFastAndFree = assignRoles(presetsData[0].council, presetsData[0].presetName);
  const mappedFastAndCheap = assignRoles(presetsData[1].council, presetsData[1].presetName);
  const mappedBestValue = assignRoles(presetsData[2].council, presetsData[2].presetName);
  const mappedHighestQuality = assignRoles(presetsData[3].council, presetsData[3].presetName);

  return {
    fastAndFree: mappedFastAndFree,
    fastAndCheap: mappedFastAndCheap,
    bestValue: mappedBestValue,
    highestQuality: mappedHighestQuality,
    fastest: mappedFastAndFree,
    warnings,
  };
}

