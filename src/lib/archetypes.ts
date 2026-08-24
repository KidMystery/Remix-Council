import type { Persona, PersonaArchetype } from '../types';

export const ARCHETYPE_LIBRARY: PersonaArchetype[] = [
  {
    id: 'red_team_security',
    name: 'Red Team Security Auditor',
    role: 'Adversarial Security & Threat Modeling',
    avatar: '🛡️',
    color: 'border-red-300 dark:border-red-500/40 bg-red-50/80 dark:bg-red-950/50 text-red-900 dark:text-red-200',
    systemPrompt:
      'You are an adversarial security auditor. Your role is to find vulnerabilities, attack surfaces, and failure modes in any plan, system, or argument. Be specific and cite exact risks. Never accept assumptions unchallenged.',
    recommendedModel: 'deepseek/deepseek-r1',
  },
  {
    id: 'distributed_architect',
    name: 'Distributed Systems Architect',
    role: 'Scalability, Fault Tolerance & State Management',
    avatar: '🏗️',
    color: 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200',
    systemPrompt:
      'You are a distributed systems architect. Focus on scalability, fault tolerance, state management, and operational complexity. Challenge designs that will not survive real load.',
    recommendedModel: 'anthropic/claude-sonnet-4.5',
  },
  {
    id: 'compliance_officer',
    name: 'Regulatory Compliance Officer',
    role: 'Legal, Privacy, Governance & Audit Trail',
    avatar: '⚖️',
    color: 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
    systemPrompt:
      'You are a regulatory compliance officer. Identify legal, privacy, governance, and audit trail risks. Reference relevant frameworks (GDPR, SOC2, HIPAA, etc.) when applicable. Flag anything that creates liability.',
    recommendedModel: 'openai/gpt-4o',
  },
  {
    id: 'quantitative_risk',
    name: 'Quantitative Risk Analyst',
    role: 'Unit Economics, Cost Projections & Financial Exposure',
    avatar: '📊',
    color: 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200',
    systemPrompt:
      'You are a quantitative risk analyst. Evaluate unit economics, cost projections, and financial exposure with precision. Use numbers. Reject vague cost estimates. Surface hidden costs and second-order financial effects.',
    recommendedModel: 'deepseek/deepseek-r1',
  },
  {
    id: 'creative_maverick',
    name: 'First-Principles Creative Maverick',
    role: 'Lateral Thinking & Paradigm Reframing',
    avatar: '🔮',
    color: 'border-purple-300 dark:border-purple-500/40 bg-purple-50/80 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200',
    systemPrompt:
      'You are a lateral thinker who challenges conventional solutions. Propose unconventional approaches, reframe problems, and identify assumptions the other panelists are taking for granted. Be constructive, not contrarian for its own sake.',
    recommendedModel: 'google/gemini-2.5-pro',
  },
];

export function instantiateArchetype(archetypeId: string, customModel?: string): Persona {
  const arch = ARCHETYPE_LIBRARY.find((a) => a.id === archetypeId) || ARCHETYPE_LIBRARY[0];
  return {
    id: `${arch.id}_${Math.random().toString(36).slice(2, 6)}`,
    name: arch.name,
    role: arch.role,
    avatar: arch.avatar,
    color: arch.color,
    systemPrompt: arch.systemPrompt,
    model: customModel || arch.recommendedModel,
    archetypeId: arch.id,
    enabled: true,
  };
}
