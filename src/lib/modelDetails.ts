import { RawOpenRouterModel, MODEL_PRESETS, cleanModelName } from './presets';
import { getAuthorOrganization, isFreeModel, estimatedCost } from './modelMapper';

export interface ModelDetails {
  id: string;
  displayName: string;
  authorOrg: string;
  isFree: boolean;
  costFormatted: string;
  selectionRationale: string;
  rankBadges: string[];
  modelAgeFormatted: string;
  contextLengthFormatted: string;
  isChair: boolean;
  isFallback: boolean;
  fallbackInfo?: string;
  alsoInPresets?: string[];
  qualityComparisonText?: string;
}

export function getModelDetails(
  modelId: string,
  personaRole?: string,
  rawModelsCatalog?: RawOpenRouterModel[] | null,
  fallbackLogs?: Array<{ personaId: string; originalModel: string; fallbackModel: string; reason: string }>,
  currentPresetId?: string
): ModelDetails {
  const modelObj = rawModelsCatalog?.find((m) => m.id === modelId) || null;

  // 1. Display name
  const displayName = cleanModelName(modelId, modelObj?.name);

  // 2. Author Organization
  const rawOrg = getAuthorOrganization(modelId);
  const authorOrg = formatOrgName(rawOrg);

  // 3. Free or Paid
  const isFree = modelObj ? isFreeModel(modelObj) : modelId.includes(':free') || modelId.toLowerCase().includes('openrouter/free');

  // 4. Estimated cost
  let costFormatted = '$0.00 / query';
  if (modelObj) {
    const cost = estimatedCost(modelObj);
    if (cost === 0 || isFree) {
      costFormatted = '$0.00 (Free)';
    } else {
      costFormatted = `$${cost.toFixed(5)} / query`;
    }
  } else if (!isFree) {
    costFormatted = 'Paid API';
  }

  // 5. Is Chair & Fallback
  const isChair = personaRole === 'synthesizer' || personaRole === 'Chair' || personaRole === 'Synthesizer';

  let isFallback = false;
  let fallbackInfo: string | undefined = undefined;
  if (fallbackLogs && personaRole) {
    const matchedLog = fallbackLogs.find(
      (log) => log.personaId === personaRole.toLowerCase() || log.fallbackModel === modelId
    );
    if (matchedLog) {
      isFallback = true;
      fallbackInfo = `Fell back from ${cleanModelName(matchedLog.originalModel)} due to ${matchedLog.reason}`;
    }
  }

  // 6. Model Age
  let modelAgeFormatted = 'Age unknown';
  if (modelObj?.created) {
    const nowSec = Math.floor(Date.now() / 1000);
    const ageDays = Math.floor((nowSec - modelObj.created) / 86400);
    if (ageDays <= 0) {
      modelAgeFormatted = 'Released today';
    } else if (ageDays < 30) {
      modelAgeFormatted = `Released ${ageDays}d ago`;
    } else if (ageDays < 365) {
      const months = Math.floor(ageDays / 30);
      modelAgeFormatted = `Released ${months}m ago`;
    } else {
      const years = (ageDays / 365).toFixed(1);
      modelAgeFormatted = `Released ${years}y ago`;
    }
  } else {
    const match = modelId.match(/-(\d{4}-\d{2}-\d{2})| -(\d{8})/);
    if (match) {
      modelAgeFormatted = 'Recent release';
    }
  }

  // 7. Context Length
  let contextLengthFormatted = '32k context';
  const ctx = modelObj?.context_length || modelObj?.top_provider?.context_length;
  if (ctx) {
    if (ctx >= 1000000) {
      contextLengthFormatted = `${(ctx / 1000000).toFixed(1)}M context`;
    } else if (ctx >= 1000) {
      contextLengthFormatted = `${Math.round(ctx / 1000)}k context`;
    } else {
      contextLengthFormatted = `${ctx} tokens`;
    }
  }

  // 8. Also in [Preset]
  const alsoInPresets: string[] = [];
  MODEL_PRESETS.forEach((preset) => {
    if (currentPresetId && preset.id === currentPresetId) return;
    const isUsedInPreset = Object.values(preset.assignments).some((asgn) => asgn.model === modelId);
    if (isUsedInPreset && !alsoInPresets.includes(preset.name)) {
      alsoInPresets.push(preset.name);
    }
  });

  // 9. Rank Badges
  const rankBadges: string[] = [];
  if (modelObj) {
    if ((modelObj as any)._latency_rank !== undefined && (modelObj as any)._latency_rank < 5) {
      rankBadges.push('Top Latency');
    }
    if ((modelObj as any)._throughput_rank !== undefined && (modelObj as any)._throughput_rank < 5) {
      rankBadges.push('Top Speed');
    }
    const intel = modelObj.benchmarks?.intelligence || modelObj.benchmarks?.arena_elo || modelObj.benchmarks?.elo;
    if (intel && intel > 1250) {
      rankBadges.push('Top Intelligence');
    } else if (modelObj.id.includes('claude-3.7') || modelObj.id.includes('gpt-4o') || modelObj.id.includes('gemini-2.0-pro') || modelObj.id.includes('deepseek-r1')) {
      rankBadges.push('Top Intelligence');
    }
    if (modelObj.benchmarks?.coding && modelObj.benchmarks.coding > 80) {
      rankBadges.push('Top Coding');
    }
  } else {
    if (modelId.includes('flash') || modelId.includes('haiku') || modelId.includes('mini')) {
      rankBadges.push('Top Speed');
    }
    if (modelId.includes('sonnet') || modelId.includes('pro') || modelId.includes('gpt-4o') || modelId.includes('deepseek-r1')) {
      rankBadges.push('Top Intelligence');
    }
  }
  if (rankBadges.length === 0) {
    rankBadges.push('Verified Model');
  }

  // 10. Selection Rationale
  let selectionRationale = 'Selected for reliable domain reasoning and balanced response output.';
  if (personaRole) {
    const roleLower = personaRole.toLowerCase();
    if (roleLower.includes('skeptic')) {
      selectionRationale = 'Selected for rigorous adversarial scrutiny, safety checks, and flaw identification.';
    } else if (roleLower.includes('visionary')) {
      selectionRationale = 'Selected for creative expansion, lateral thinking, and innovative strategic solutions.';
    } else if (roleLower.includes('pragmatist')) {
      selectionRationale = 'Selected for realistic execution planning, resource evaluation, and actionable clarity.';
    } else if (roleLower.includes('synthesizer') || roleLower.includes('chair')) {
      selectionRationale = 'Selected as Council Chair for long-context comprehension and balanced consensus synthesis.';
    }
  }

  // 11. Quality Comparison (Fast & Free only)
  let qualityComparisonText: string | undefined = undefined;
  if (isFree || currentPresetId === 'fast_and_free') {
    qualityComparisonText = calculateQualityComparison(modelObj, rawModelsCatalog);
  }

  return {
    id: modelId,
    displayName,
    authorOrg,
    isFree,
    costFormatted,
    selectionRationale,
    rankBadges,
    modelAgeFormatted,
    contextLengthFormatted,
    isChair,
    isFallback,
    fallbackInfo,
    alsoInPresets: alsoInPresets.length > 0 ? alsoInPresets : undefined,
    qualityComparisonText,
  };
}

function calculateQualityComparison(
  modelObj: RawOpenRouterModel | null,
  rawModelsCatalog?: RawOpenRouterModel[] | null
): string {
  if (!rawModelsCatalog || rawModelsCatalog.length === 0) {
    return 'Quality data unavailable';
  }

  let maxScore = 0;
  rawModelsCatalog.forEach((m) => {
    const score = getModelQualityScore(m);
    if (score > maxScore) maxScore = score;
  });

  if (!modelObj || maxScore === 0) {
    return 'Quality data unavailable';
  }

  const thisModelScore = getModelQualityScore(modelObj);
  if (thisModelScore === 0) {
    return 'Quality data unavailable';
  }

  const percentage = Math.min(100, Math.max(10, Math.round((thisModelScore / maxScore) * 100)));
  return `Estimated quality: ${percentage}% of top-rated model`;
}

/** Family-based fallback quality score for models without benchmark data
 *  (exact family matches — no loose substring collisions like gpt-4o-mini). */
function getModelQualityScore(m: RawOpenRouterModel): number {
  const b = m.benchmarks;
  if (!b) {
    const family = (m.id || '').split('/')[1] || '';
    const frontier = ['claude-sonnet-4.5', 'claude-opus-4', 'claude-opus-4.1', 'gpt-5.1', 'gemini-2.5-pro'];
    if (frontier.some((f) => family === f || family.startsWith(f + '-'))) return 100;
    if (family.startsWith('deepseek-r1') || family === 'gemini-3.7-flash' || family === 'gpt-4o') return 96;
    if (family === 'gemini-2.5-flash' || family === 'gpt-4o-mini' || family.startsWith('o3-mini')) return 90;
    if (family.startsWith('llama-3.3-70b') || family.startsWith('qwen3-235b')) return 88;
    if (family.startsWith('gemma-4')) return 78;
    if (family.startsWith('nemotron-3')) return 72;
    if (family.startsWith('laguna')) return 68;
    if (family.startsWith('ling-3.0')) return 65;
    return 0;
  }

  let total = 0;
  let count = 0;

  if (b.intelligence) { total += b.intelligence; count++; }
  if (b.arena_elo || b.elo || b.design_arena_elo) { total += (b.arena_elo || b.elo || b.design_arena_elo || 0) / 15; count++; }
  if (b.coding) { total += b.coding; count++; }
  if (b.agentic) { total += b.agentic; count++; }

  if (count === 0) {
    if (m.context_length && m.context_length >= 100000) return 70;
    return 0;
  }

  return total / count;
}

function formatOrgName(org: string): string {
  const map: Record<string, string> = {
    google: 'Google',
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    'meta-llama': 'Meta Llama',
    meta: 'Meta',
    nvidia: 'NVIDIA',
    qwen: 'Qwen (Alibaba)',
    poolside: 'Poolside',
    inclusionai: 'InclusionAI',
    mistralai: 'Mistral AI',
    cohere: 'Cohere',
    perplexity: 'Perplexity',
    microsoft: 'Microsoft',
  };
  return map[org.toLowerCase()] || org.charAt(0).toUpperCase() + org.slice(1);
}
