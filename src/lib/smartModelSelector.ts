import type { RawOpenRouterModel, CouncilPersona } from '../types';
import { type ExecutionPolicy, assertPolicyModel, isFreeModelId } from './executionPolicy';

export type TaskDomain = 'general' | 'coding' | 'math_reasoning' | 'security_audit' | 'creative';

export function detectTaskDomain(queryText: string): TaskDomain {
  const lower = (queryText || '').toLowerCase();

  if (
    lower.includes('code') ||
    lower.includes('function') ||
    lower.includes('bug') ||
    lower.includes('typescript') ||
    lower.includes('refactor') ||
    lower.includes('api') ||
    lower.includes('sql') ||
    lower.includes('algorithm')
  ) {
    return 'coding';
  }

  if (
    lower.includes('security') ||
    lower.includes('vulnerability') ||
    lower.includes('auth') ||
    lower.includes('sanitize') ||
    lower.includes('attack') ||
    lower.includes('audit')
  ) {
    return 'security_audit';
  }

  if (
    lower.includes('math') ||
    lower.includes('proof') ||
    lower.includes('calculate') ||
    lower.includes('statistic') ||
    lower.includes('probability')
  ) {
    return 'math_reasoning';
  }

  if (
    lower.includes('story') ||
    lower.includes('brainstorm') ||
    lower.includes('pitch') ||
    lower.includes('creative')
  ) {
    return 'creative';
  }

  return 'general';
}

export function getModelFamily(modelId: string): string {
  const parts = modelId.toLowerCase().split('/');
  const name = parts[1] || parts[0];
  if (name.includes('llama')) return 'llama';
  if (name.includes('claude')) return 'claude';
  if (name.includes('gemini')) return 'gemini';
  if (name.includes('deepseek')) return 'deepseek';
  if (name.includes('qwen')) return 'qwen';
  if (name.includes('mistral') || name.includes('mixtral')) return 'mistral';
  if (name.includes('gpt') || name.includes('o1') || name.includes('o3')) return 'openai';
  return name.split('-')[0] || name;
}

export function getModelOrg(modelId: string): string {
  const parts = modelId.toLowerCase().split('/');
  return parts.length > 1 ? parts[0] : 'unknown';
}

export function routeCouncilModels(
  personas: CouncilPersona[],
  policy: ExecutionPolicy,
  catalog: RawOpenRouterModel[] = [],
  taskQuery: string = ''
): CouncilPersona[] {
  const isFree = policy.budget === 'free';
  const taskDomain = detectTaskDomain(taskQuery);
  const usedOrgs = new Set<string>();
  const usedFamilies = new Set<string>();

  const assigned = personas.map((persona) => {
    let candidate = persona.model;

    // Task-contingent optimization candidates
    if (taskDomain === 'coding') {
      if (persona.role.toLowerCase().includes('engineer') || persona.role.toLowerCase().includes('code')) {
        candidate = isFree ? 'google/gemini-2.0-flash-exp:free' : 'deepseek/deepseek-r1';
      }
    } else if (taskDomain === 'security_audit') {
      if (persona.role.toLowerCase().includes('skeptic') || persona.role.toLowerCase().includes('security')) {
        candidate = isFree ? 'qwen/qwen-2.5-72b-instruct:free' : 'openai/o3-mini';
      }
    }

    // Policy budget verification & fallback
    if (isFree && !isFreeModelId(candidate, catalog)) {
      const freeModel = catalog.find(
        (m) =>
          isFreeModelId(m.id, catalog) &&
          !usedOrgs.has(getModelOrg(m.id)) &&
          !usedFamilies.has(getModelFamily(m.id))
      );
      if (freeModel) {
        candidate = freeModel.id;
      } else {
        const fallbackFree = catalog.find((m) => isFreeModelId(m.id, catalog));
        if (fallbackFree) candidate = fallbackFree.id;
      }
    }

    const org = getModelOrg(candidate);
    const family = getModelFamily(candidate);
    usedOrgs.add(org);
    usedFamilies.add(family);

    assertPolicyModel(candidate, policy, catalog);

    return {
      ...persona,
      model: candidate,
    };
  });

  return assigned;
}
