import {
  BudgetPolicy,
  ExecutionPlan,
  ExecutionPlanSeat,
  Persona,
  ResolvedExecutionMode,
  WebMode,
} from '../types';
import { RawOpenRouterModel } from './presets';
import { isFreeModel, estimatedCost } from './modelMapper';
import { detectTaskDomain, TaskDomain } from './smartModelSelector';

export interface BuildExecutionPlanParams {
  roundId: string;
  query: string;
  depth?: 'quick' | 'full' | 'auto';
  budget?: BudgetPolicy;
  personas: Persona[];
  synthesizer: Persona;
  catalog?: RawOpenRouterModel[];
  customModels?: Record<string, string>;
  synthesizerModel?: string;
  costCeiling?: number;
  webMode?: WebMode;
  attachedFiles?: Array<{ name: string; content: string }>;
}

export function resolveDepth(
  depth: 'quick' | 'full' | 'auto' | undefined,
  query: string,
  attachedFiles?: Array<{ name: string; content: string }>
): ResolvedExecutionMode {
  if (depth === 'quick') return 'quick_panel';
  if (depth === 'full') return 'deep_council';

  // Auto depth detection
  const q = query.toLowerCase();
  const isShort = q.split(/\s+/).length < 15;
  const hasFiles = attachedFiles && attachedFiles.length > 0;

  if (hasFiles) return 'deep_council';
  if (isShort && !q.includes('debate') && !q.includes('compare') && !q.includes('deep')) {
    return 'quick_panel';
  }

  return 'deep_council';
}

export function buildExecutionPlan(params: BuildExecutionPlanParams): ExecutionPlan {
  const roundId = params.roundId || `round_${Date.now()}`;
  const budget: BudgetPolicy = params.budget || 'cheap';
  const resolvedDepth = resolveDepth(params.depth, params.query, params.attachedFiles);
  const domain: TaskDomain = detectTaskDomain(params.query, params.attachedFiles as any);
  const catalog = params.catalog || [];

  // Determine complexity
  const charCount = (params.query?.length || 0) + (params.attachedFiles?.reduce((acc, f) => acc + (f.content?.length || 0), 0) || 0);
  const complexity: 'simple' | 'moderate' | 'complex' =
    charCount > 10000 ? 'complex' : charCount > 1000 ? 'moderate' : 'simple';

  // Per-stage token limits based on complexity and depth
  const stage1TokenLimit = complexity === 'complex' ? 3000 : complexity === 'moderate' ? 2000 : 1200;
  const stage2TokenLimit = resolvedDepth === 'deep_council'
    ? (complexity === 'complex' ? 2500 : 1500)
    : 0;
  const chairTokenLimit = complexity === 'complex' ? 4000 : complexity === 'moderate' ? 2500 : 1500;

  const catalogMap = new Map<string, RawOpenRouterModel>();
  catalog.forEach((m) => catalogMap.set(m.id, m));

  // Build seats for enabled panelists
  const enabledPersonas = params.personas.filter((p) => p.enabled !== false);
  const panelists: ExecutionPlanSeat[] = enabledPersonas.map((p) => {
    const assignedModel = params.customModels?.[p.id] || p.model;
    const fallbacks: string[] = [];

    if (budget === 'free') {
      // Find verified free alternatives from catalog
      catalog.forEach((m) => {
        if (isFreeModel(m) && m.id !== assignedModel && !fallbacks.includes(m.id)) {
          fallbacks.push(m.id);
        }
      });
    }

    return {
      personaId: p.id,
      personaName: p.name,
      roleKey: p.role || p.id,
      modelId: assignedModel,
      fallbackModels: fallbacks.slice(0, 3),
    };
  });

  // Build chair seat
  const chairModel = params.synthesizerModel || params.synthesizer.model;
  const chairFallbacks: string[] = [];
  if (budget === 'free') {
    catalog.forEach((m) => {
      if (isFreeModel(m) && m.id !== chairModel && !chairFallbacks.includes(m.id)) {
        chairFallbacks.push(m.id);
      }
    });
  }

  const chair: ExecutionPlanSeat = {
    personaId: params.synthesizer.id,
    personaName: params.synthesizer.name || 'Chairman',
    roleKey: 'synthesizer',
    modelId: chairModel,
    fallbackModels: chairFallbacks.slice(0, 3),
  };

  // Calculate expected maximum cost
  let maxExpectedCost = 0;
  if (budget !== 'free') {
    panelists.forEach((seat) => {
      const model = catalogMap.get(seat.modelId);
      if (model) {
        maxExpectedCost += estimatedCost(model);
        if (resolvedDepth === 'deep_council') {
          maxExpectedCost += estimatedCost(model) * 0.8;
        }
      }
    });
    const synthModel = catalogMap.get(chair.modelId);
    if (synthModel) {
      maxExpectedCost += estimatedCost(synthModel) * 1.5;
    }
  }

  return {
    roundId,
    depth: resolvedDepth,
    budget,
    domain,
    complexity,
    panelists,
    chair,
    stage1TokenLimit,
    stage2TokenLimit,
    chairTokenLimit,
    maxExpectedCost,
    costCeiling: params.costCeiling || 1.0,
    webMode: params.webMode || 'off',
    catalogTimestamp: Date.now(),
  };
}

export function validateExecutionPlan(
  plan: ExecutionPlan,
  catalog?: RawOpenRouterModel[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!plan.roundId) errors.push('Plan must have a valid roundId.');
  if (!plan.panelists || plan.panelists.length === 0) errors.push('Plan must have at least one panelist seat.');
  if (!plan.chair || !plan.chair.modelId) errors.push('Plan must specify a valid chair seat and model.');

  if (plan.budget === 'free') {
    if (!catalog || catalog.length === 0) {
      errors.push('Strict Free requires an active, verified catalog cache. Catalog is currently unavailable.');
    } else {
      const catalogMap = new Map(catalog.map((m) => [m.id, m]));

      // Verify panelists
      for (const seat of plan.panelists) {
        const model = catalogMap.get(seat.modelId);
        if (!model) {
          errors.push(`Strict Free violation: Model '${seat.modelId}' for seat '${seat.personaName}' is not present in live catalog.`);
        } else if (!isFreeModel(model)) {
          errors.push(`Strict Free violation: Model '${seat.modelId}' for seat '${seat.personaName}' is not verified exact-zero free.`);
        }
      }

      // Verify chair
      const chairModel = catalogMap.get(plan.chair.modelId);
      if (!chairModel) {
        errors.push(`Strict Free violation: Chair model '${plan.chair.modelId}' is not present in live catalog.`);
      } else if (!isFreeModel(chairModel)) {
        errors.push(`Strict Free violation: Chair model '${plan.chair.modelId}' is not verified exact-zero free.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
