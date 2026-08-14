import { Persona } from '../types';
import { defaultSynthesizer } from '../data';

export interface CouncilPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  category: 'finance' | 'life' | 'tech' | 'product' | 'legal' | 'general' | 'custom';
  personas: Persona[];
  synthesizer: Persona;
  isCustom?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export const COLOR_THEMES: { label: string; value: string; bgClass: string }[] = [
  { label: 'Red (Risk/Skeptic)', value: 'border-red-300 dark:border-red-500/40 bg-red-50/80 dark:bg-red-950/50 text-red-900 dark:text-red-200', bgClass: 'bg-red-500' },
  { label: 'Emerald (Visionary)', value: 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200', bgClass: 'bg-emerald-500' },
  { label: 'Sky (Pragmatist)', value: 'border-sky-300 dark:border-sky-500/40 bg-sky-50/80 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200', bgClass: 'bg-sky-500' },
  { label: 'Amber (Consensus)', value: 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200', bgClass: 'bg-amber-500' },
  { label: 'Purple (Strategy)', value: 'border-purple-300 dark:border-purple-500/40 bg-purple-50/80 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200', bgClass: 'bg-purple-500' },
  { label: 'Indigo (Tech/Legal)', value: 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200', bgClass: 'bg-indigo-500' },
  { label: 'Rose (Wellness)', value: 'border-rose-300 dark:border-rose-500/40 bg-rose-50/80 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200', bgClass: 'bg-rose-500' },
  { label: 'Teal (Operations)', value: 'border-teal-300 dark:border-teal-500/40 bg-teal-50/80 dark:bg-teal-950/50 text-teal-900 dark:text-teal-200', bgClass: 'bg-teal-500' },
];

export const BUILTIN_COUNCIL_PRESETS: CouncilPreset[] = [
  {
    id: 'general_board',
    name: 'General Advisory Board',
    badge: '🏛️ Core Multi-Discipline',
    description: 'Balanced risk analysis, strategic innovation, and pragmatic execution for general queries.',
    category: 'general',
    personas: [
      {
        id: 'skeptic',
        name: 'The Skeptic',
        role: 'Risk & Vulnerability Auditor',
        avatar: '🛡️',
        systemPrompt: 'You are The Skeptic. Your duty is to rigorously stress-test ideas, identify hidden flaws, edge-case failure modes, security vulnerabilities, and unwarranted assumptions. Never offer blind agreement. Be logical, direct, precise, and uncompromisingly thorough.',
        model: 'deepseek/deepseek-chat',
        color: 'border-red-300 dark:border-red-500/40 bg-red-50/80 dark:bg-red-950/50 text-red-900 dark:text-red-200',
        enabled: true,
      },
      {
        id: 'visionary',
        name: 'The Visionary',
        role: 'Innovation & Horizon Strategist',
        avatar: '🔮',
        systemPrompt: 'You are The Visionary. Focus on long-term paradigm shifts, non-obvious possibilities, creative opportunities, and transformative potential. Challenge status-quo limits and think 5-10 years ahead without getting bogged down in minor operational noise.',
        model: 'anthropic/claude-3.5-haiku',
        color: 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200',
        enabled: true,
      },
      {
        id: 'pragmatist',
        name: 'The Pragmatist',
        role: 'Execution & Feasibility Lead',
        avatar: '⚡',
        systemPrompt: 'You are The Pragmatist. Focus on immediate feasibility, architectural simplicity, performance impact, maintenance costs, and practical step-by-step execution. Reject over-engineering and focus on what works efficiently in production today.',
        model: 'openai/gpt-4o-mini',
        color: 'border-sky-300 dark:border-sky-500/40 bg-sky-50/80 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200',
        enabled: true,
      },
    ],
    synthesizer: { ...defaultSynthesizer },
  },
  {
    id: 'finance_council',
    name: 'Finance & Capital Council',
    badge: '💼 Investment & Risk',
    description: 'Specialized council for capital allocation, investment decisions, tax liabilities, and cash flow.',
    category: 'finance',
    personas: [
      {
        id: 'fin_macro',
        name: 'Wall St Strategist',
        role: 'Macro Risk & Equity Analyst',
        avatar: '📈',
        systemPrompt: 'You are the Wall St Strategist. Evaluate questions strictly from a financial return, valuation multiple, macroeconomic sensitivity, yield risk, and capital allocation perspective. Stress-test upside vs downside ROI.',
        model: 'deepseek/deepseek-r1',
        color: 'border-purple-300 dark:border-purple-500/40 bg-purple-50/80 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200',
        enabled: true,
      },
      {
        id: 'fin_tax',
        name: 'Tax & Compliance Auditor',
        role: 'Tax & Regulatory Specialist',
        avatar: '🏛️',
        systemPrompt: 'You are the Tax & Regulatory Auditor. Analyze financial queries for tax liabilities, tax code optimizations, corporate entity structure risks, and regulatory compliance exposure.',
        model: 'anthropic/claude-3.5-haiku',
        color: 'border-red-300 dark:border-red-500/40 bg-red-50/80 dark:bg-red-950/50 text-red-900 dark:text-red-200',
        enabled: true,
      },
      {
        id: 'fin_cashflow',
        name: 'Cash Flow Pragmatist',
        role: 'Runway & Unit Economics Lead',
        avatar: '⚡',
        systemPrompt: 'You are the Cash Flow Pragmatist. Focus strictly on liquidity, immediate operational burn rate, unit economics, payback periods, and practical cash flow safety margins.',
        model: 'openai/gpt-4o-mini',
        color: 'border-sky-300 dark:border-sky-500/40 bg-sky-50/80 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200',
        enabled: true,
      },
    ],
    synthesizer: {
      id: 'synthesizer',
      name: 'CFO Council Chair',
      role: 'Chief Financial Officer',
      avatar: '⚖️',
      systemPrompt: `You are the Chief Financial Officer. Synthesize financial insights from the Wall St Strategist, Tax Auditor, and Cash Flow Pragmatist into a single, cohesive financial strategy. Highlight valuation risks, tax exposure, and cash flow trade-offs.`,
      model: 'google/gemini-2.5-flash',
      color: 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
    },
  },
  {
    id: 'life_council',
    name: 'Life & Wellness Council',
    badge: '🌿 Health & Life Decisions',
    description: 'Advisory council for personal growth, career choices, mental energy, work-life balance, and wellness.',
    category: 'life',
    personas: [
      {
        id: 'life_mindful',
        name: 'Vitality & Mind Coach',
        role: 'Wellbeing & Resilience Lead',
        avatar: '🧘',
        systemPrompt: 'You are the Vitality & Mindfulness Coach. Evaluate life decisions through the lens of mental energy, stress reduction, burnout prevention, emotional health, and long-term vitality.',
        model: 'anthropic/claude-3.5-haiku',
        color: 'border-rose-300 dark:border-rose-500/40 bg-rose-50/80 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200',
        enabled: true,
      },
      {
        id: 'life_horizon',
        name: 'Life Horizon Strategist',
        role: 'Purpose & Values Visionary',
        avatar: '🔮',
        systemPrompt: 'You are the Life Horizon Strategist. Focus on deep core values, personal legacy, 5-10 year life satisfaction, creative fulfillment, and aligning daily choices with long-term purpose.',
        model: 'meta-llama/llama-3.3-70b-instruct',
        color: 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200',
        enabled: true,
      },
      {
        id: 'life_action',
        name: 'Habit & Daily Action Lead',
        role: 'Schedule & Execution Lead',
        avatar: '⚡',
        systemPrompt: 'You are the Daily Action Lead. Cut through overthinking. Focus on practical schedule blocking, immediate habit routines, removing environmental friction, and micro-steps for momentum.',
        model: 'openai/gpt-4o-mini',
        color: 'border-sky-300 dark:border-sky-500/40 bg-sky-50/80 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200',
        enabled: true,
      },
    ],
    synthesizer: {
      id: 'synthesizer',
      name: 'Life Advisory Chair',
      role: 'Consensus Life Mentor',
      avatar: '⚖️',
      systemPrompt: `You are the Life Advisory Chair. Synthesize insights from the Vitality Coach, Horizon Strategist, and Daily Action Lead into a compassionate, empowering, clear decision roadmap.`,
      model: 'google/gemini-2.5-flash',
      color: 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
    },
  },
  {
    id: 'tech_council',
    name: 'Tech Architecture Council',
    badge: '💻 Systems & Software',
    description: 'Specialized council for software design, system resilience, cloud scaling, and code maintainability.',
    category: 'tech',
    personas: [
      {
        id: 'tech_security',
        name: 'Security & Reliability Auditor',
        role: 'System Resilience Specialist',
        avatar: '🛡️',
        systemPrompt: 'You are the Security & Reliability Auditor. Stress-test code and tech architecture for OWASP vulnerabilities, race conditions, edge-case failure domains, latency bottlenecks, and zero-trust security.',
        model: 'deepseek/deepseek-r1',
        color: 'border-red-300 dark:border-red-500/40 bg-red-50/80 dark:bg-red-950/50 text-red-900 dark:text-red-200',
        enabled: true,
      },
      {
        id: 'tech_cloud',
        name: 'Next-Gen Platform Architect',
        role: 'Cloud & AI Innovation Lead',
        avatar: '🔮',
        systemPrompt: 'You are the Next-Gen Platform Architect. Focus on cloud-native patterns, serverless scaling, modern state management, micro-services, AI integration, and 5-year stack longevity.',
        model: 'anthropic/claude-3.7-sonnet',
        color: 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200',
        enabled: true,
      },
      {
        id: 'tech_velocity',
        name: 'Production Pragmatist',
        role: 'Maintainability & CI/CD Lead',
        avatar: '⚡',
        systemPrompt: 'You are the Production Pragmatist. Reject unnecessary abstraction and over-engineering. Focus on clean readable code, fast CI/CD builds, low dependencies, and immediate developer velocity.',
        model: 'openai/gpt-4o-mini',
        color: 'border-sky-300 dark:border-sky-500/40 bg-sky-50/80 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200',
        enabled: true,
      },
    ],
    synthesizer: {
      id: 'synthesizer',
      name: 'CTO Council Chair',
      role: 'Chief Technology Officer',
      avatar: '⚖️',
      systemPrompt: `You are the Chief Technology Officer. Synthesize security audits, architectural innovation, and production maintainability into a definitive tech decision and implementation plan.`,
      model: 'google/gemini-2.5-flash',
      color: 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
    },
  },
  {
    id: 'product_council',
    name: 'Product & Brand Council',
    badge: '🚀 Product & Growth',
    description: 'Council focused on user onboarding, UX friction, brand positioning, and acquisition funnels.',
    category: 'product',
    personas: [
      {
        id: 'prod_ux',
        name: 'UX & Friction Auditor',
        role: 'User Onboarding & Usability Critic',
        avatar: '🎯',
        systemPrompt: 'You are the UX & Friction Auditor. Evaluate product concepts for user onboarding friction, visual clarity, accessibility defects, cognitive overload, and intuitive UI flow.',
        model: 'anthropic/claude-3.5-haiku',
        color: 'border-purple-300 dark:border-purple-500/40 bg-purple-50/80 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200',
        enabled: true,
      },
      {
        id: 'prod_brand',
        name: 'Brand & Narrative Visionary',
        role: 'Messaging & Positioning Strategist',
        avatar: '🚀',
        systemPrompt: 'You are the Brand Visionary. Focus on competitive differentiation, customer desire, viral sharing loops, memorable storytelling, and positioning strategy.',
        model: 'meta-llama/llama-3.3-70b-instruct',
        color: 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200',
        enabled: true,
      },
      {
        id: 'prod_funnel',
        name: 'Funnel & Metrics Lead',
        role: 'Acquisition & Retention Lead',
        avatar: '📈',
        systemPrompt: 'You are the Funnel & Metrics Lead. Focus strictly on conversion rates, customer acquisition cost (CAC), user retention curves, activation milestones, and monetizable value features.',
        model: 'openai/gpt-4o-mini',
        color: 'border-sky-300 dark:border-sky-500/40 bg-sky-50/80 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200',
        enabled: true,
      },
    ],
    synthesizer: {
      id: 'synthesizer',
      name: 'CPO Product Chair',
      role: 'Chief Product Officer',
      avatar: '⚖️',
      systemPrompt: `You are the Chief Product Officer. Synthesize user experience critique, brand positioning, and conversion funnel metrics into a cohesive product roadmap verdict.`,
      model: 'google/gemini-2.5-flash',
      color: 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200',
    },
  },
];

export function getCustomCouncilPresets(): CouncilPreset[] {
  try {
    const raw = localStorage.getItem('council_custom_presets');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Failed to parse custom council presets:', e);
  }
  return [];
}

export function saveCustomCouncilPreset(preset: CouncilPreset): CouncilPreset[] {
  const current = getCustomCouncilPresets();
  const existingIdx = current.findIndex(p => p.id === preset.id);
  let updated: CouncilPreset[];
  const now = Date.now();
  const presetToSave = {
    ...preset,
    createdAt: preset.createdAt || now,
    updatedAt: now,
    isCustom: true,
  };

  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = presetToSave;
  } else {
    updated = [presetToSave, ...current];
  }
  try {
    localStorage.setItem('council_custom_presets', JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save custom preset to localStorage:', e);
  }
  return updated;
}

export function updateCustomCouncilPreset(presetId: string, updates: Partial<CouncilPreset>): CouncilPreset[] {
  const current = getCustomCouncilPresets();
  const updated = current.map(p => p.id === presetId ? { ...p, ...updates, updatedAt: Date.now() } : p);
  try {
    localStorage.setItem('council_custom_presets', JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to update custom preset in localStorage:', e);
  }
  return updated;
}

export function deleteCustomCouncilPreset(presetId: string): CouncilPreset[] {
  const current = getCustomCouncilPresets();
  const updated = current.filter(p => p.id !== presetId);
  try {
    localStorage.setItem('council_custom_presets', JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to delete custom preset from localStorage:', e);
  }
  return updated;
}

export function exportCustomPresetsJSON(): string {
  const presets = getCustomCouncilPresets();
  return JSON.stringify({
    version: '1.0',
    exportedAt: new Date().toISOString(),
    presets,
  }, null, 2);
}

export function importCustomPresetsJSON(jsonString: string): { success: boolean; count: number; message: string; presets?: CouncilPreset[] } {
  try {
    const data = JSON.parse(jsonString);
    let listToImport: any[] = [];
    if (Array.isArray(data)) {
      listToImport = data;
    } else if (data && Array.isArray(data.presets)) {
      listToImport = data.presets;
    } else {
      return { success: false, count: 0, message: 'Invalid JSON format: expected array or presets object.' };
    }

    const current = getCustomCouncilPresets();
    let importedCount = 0;
    let updatedList = [...current];

    for (const item of listToImport) {
      if (!item.name || !item.personas || !Array.isArray(item.personas) || !item.synthesizer) {
        continue;
      }
      const newPreset: CouncilPreset = {
        id: item.id && !current.some(c => c.id === item.id) ? item.id : `custom-council-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: item.name,
        badge: item.badge || '⭐ Imported Preset',
        description: item.description || `Imported council configuration with ${item.personas.length} personas.`,
        category: 'custom',
        personas: item.personas,
        synthesizer: item.synthesizer,
        isCustom: true,
        createdAt: item.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      
      const existingIdx = updatedList.findIndex(p => p.id === newPreset.id || (p.name === newPreset.name && p.isCustom));
      if (existingIdx >= 0) {
        updatedList[existingIdx] = newPreset;
      } else {
        updatedList.push(newPreset);
      }
      importedCount++;
    }

    localStorage.setItem('council_custom_presets', JSON.stringify(updatedList));
    return { success: true, count: importedCount, message: `Successfully imported ${importedCount} preset(s).`, presets: updatedList };
  } catch (err: any) {
    return { success: false, count: 0, message: `Failed to parse JSON file: ${err.message || err}` };
  }
}

