import { PersonaId } from '../types';
import { getAuthorOrganization } from './modelMapper';

export interface ScoreBreakdown {
  intelligence: number; // 0-100 scale
  speed: number;        // 0-100 scale
  latencyRating: number;// 0-100 scale
  costRating: number;   // 0-100 scale
}

export interface ModelRequestAudit {
  personaId: PersonaId | 'synthesizer' | 'pro_challenger';
  selectedModelId: string;
  resolvedModelId: string;
  authorOrg: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  scores: ScoreBreakdown;
  fallbackEvent?: {
    reason: string;
    replacementModel: string;
  };
}

export interface CouncilRequestAuditLog {
  id: string;
  timestamp: number;
  presetName: string;
  answerMode: string;
  totalWallClockMs: number;
  panelSuccessCount: number;
  panelTotalCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCost: number;
  modelAudits: ModelRequestAudit[];
  fallbackEvents: Array<{
    personaId: string;
    originalModel: string;
    replacementModel: string;
    reason: string;
  }>;
  // Phase 2: Blind Comparison Data if enabled
  proComparison?: {
    proModelId: string;
    proModelOrg: string;
    answerAIsCouncil: boolean; // if true, Answer A = Council synthesis, Answer B = Pro
    councilLatencyMs: number;
    proLatencyMs: number;
    councilCost: number;
    proCost: number;
    userVote?: 'answer_a' | 'answer_b' | 'tie' | null;
    voteTimestamp?: number;
  };
}

const AUDIT_LOGS_STORAGE_KEY = 'council_chamber_audit_logs_v1';
const PRO_COMPARE_ENABLED_KEY = 'council_chamber_pro_compare_enabled_v1';

export function getStoredAuditLogs(): CouncilRequestAuditLog[] {
  try {
    const raw = localStorage.getItem(AUDIT_LOGS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load audit logs:', err);
    return [];
  }
}

export function saveAuditLog(log: CouncilRequestAuditLog): CouncilRequestAuditLog[] {
  const logs = getStoredAuditLogs();
  const updated = [log, ...logs].slice(0, 100); // Keep last 100 logs
  try {
    localStorage.setItem(AUDIT_LOGS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save audit log:', err);
  }
  return updated;
}

export function updateAuditLogVote(logId: string, vote: 'answer_a' | 'answer_b' | 'tie'): CouncilRequestAuditLog[] {
  const logs = getStoredAuditLogs();
  const updated = logs.map((log) => {
    if (log.id === logId && log.proComparison) {
      return {
        ...log,
        proComparison: {
          ...log.proComparison,
          userVote: vote,
          voteTimestamp: Date.now(),
        },
      };
    }
    return log;
  });
  try {
    localStorage.setItem(AUDIT_LOGS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to update audit log vote:', err);
  }
  return updated;
}

export function clearAuditLogs(): void {
  try {
    localStorage.removeItem(AUDIT_LOGS_STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear audit logs:', err);
  }
}

export function getProCompareSetting(): boolean {
  try {
    const val = localStorage.getItem(PRO_COMPARE_ENABLED_KEY);
    return val === 'true'; // OFF by default
  } catch (err) {
    return false;
  }
}

export function setProCompareSetting(enabled: boolean): void {
  try {
    localStorage.setItem(PRO_COMPARE_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    console.error('Failed to set pro compare setting:', err);
  }
}

export function calculateScoresForModel(modelId: string, isFree: boolean): ScoreBreakdown {
  const idLower = modelId.toLowerCase();
  let intelligence = 75;
  let speed = 80;
  let latencyRating = 80;
  let costRating = isFree ? 100 : 70;

  if (idLower.includes('claude-3.7-sonnet') || idLower.includes('gpt-4o') || idLower.includes('gemini-2.0-pro') || idLower.includes('deepseek-r1')) {
    intelligence = 98;
    speed = 65;
    latencyRating = 60;
    costRating = 40;
  } else if (idLower.includes('flash') || idLower.includes('haiku') || idLower.includes('mini')) {
    intelligence = 82;
    speed = 98;
    latencyRating = 95;
    costRating = isFree ? 100 : 90;
  } else if (idLower.includes('gemma-4') || idLower.includes('nemotron') || idLower.includes('qwen-2.5')) {
    intelligence = 80;
    speed = 85;
    latencyRating = 85;
    costRating = isFree ? 100 : 80;
  }

  return { intelligence, speed, latencyRating, costRating };
}
