import type { RawOpenRouterModel, CouncilPersona } from '../types';

export interface CouncilPreset {
  id: string;
  name: string;
  description: string;
  policyBudget: 'free' | 'cheap' | 'quality';
  personas: CouncilPersona[];
}

export const PRESETS: CouncilPreset[] = [
  {
    id: 'fast_and_free',
    name: 'Fast & Free',
    description: 'Zero-cost deliberation utilizing verified free OpenRouter tier models.',
    policyBudget: 'free',
    personas: [
      {
        id: 'analyst',
        name: 'The Analyst',
        role: 'Fact-Checker & Analytical Deconstruction',
        systemPrompt: 'You are The Analyst. Break down facts, logic, constraints, and empirical realities.',
        model: 'google/gemini-2.0-flash-exp:free',
      },
      {
        id: 'pragmatist',
        name: 'The Pragmatist',
        role: 'Execution & Practical Feasibility',
        systemPrompt: 'You are The Pragmatist. Prioritize immediate viability, code stability, and implementation steps.',
        model: 'meta-llama/llama-3.3-70b-instruct:free',
      },
      {
        id: 'skeptic',
        name: 'The Skeptic',
        role: 'Risk Assessment & Edge Case Auditing',
        systemPrompt: 'You are The Skeptic. Identify vulnerabilities, points of failure, edge cases, and missing requirements.',
        model: 'qwen/qwen-2.5-72b-instruct:free',
      },
    ],
  },
  {
    id: 'deep_council',
    name: 'Deep Council',
    description: 'High-reasoning frontier models for deep multi-perspective architectural review.',
    policyBudget: 'quality',
    personas: [
      {
        id: 'visionary',
        name: 'The Architect',
        role: 'System Architecture & Long-term Strategy',
        systemPrompt: 'You are The Architect. Focus on overarching system design, scalability, and long-term design patterns.',
        model: 'anthropic/claude-3.7-sonnet',
      },
      {
        id: 'auditor',
        name: 'Security Auditor',
        role: 'Security, Boundary Conditions & Robustness',
        systemPrompt: 'You are the Security Auditor. Scrutinize boundaries, authentication, data validation, and threat surfaces.',
        model: 'openai/o3-mini',
      },
      {
        id: 'engineer',
        name: 'Lead Engineer',
        role: 'Clean Code, Implementation & Performance',
        systemPrompt: 'You are the Lead Engineer. Deliver precise, production-grade code, unit test invariants, and refactoring steps.',
        model: 'deepseek/deepseek-r1',
      },
    ],
  },
];
