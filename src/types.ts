import { WebMode } from './shared/webGrounding';
import type { PresetId } from './lib/presets';

export type PersonaId = string;

export interface GroundingSource {
  title?: string;
  url?: string;
}

export interface GroundingData {
  queries?: string[];
  sources?: GroundingSource[];
}

export interface Persona {
  id: PersonaId;
  name: string;
  role: string;
  avatar: string;
  model: string;
  systemPrompt: string;
  color: string;
  enabled?: boolean;
  enableSearchGrounding?: boolean;
}

export type StreamStatus = 'idle' | 'streaming' | 'completed' | 'error';

export interface PersonaResponse {
  personaId: PersonaId;
  content: string;
  status: StreamStatus;
  error?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  grounding?: GroundingData;
}

export interface DeliberationStage {
  stage1: Record<PersonaId, PersonaResponse>;
  stage2: Record<PersonaId, PersonaResponse>;
}

export type ExecutionMode = 'auto' | 'quick_panel' | 'deep_council';
export type ResolvedExecutionMode = 'quick_panel' | 'deep_council';
export type { TaskDomain } from './lib/smartModelSelector';

export interface AttachedTextFile {
  name: string;
  type: string;
  size: number;
  content: string;
  summary?: string;
}

export interface RoundRating {
  score: number; // 1 to 5
  feedback?: string;
  tags?: string[];
  timestamp: number;
}

export interface NotificationPreferences {
  enableSoundAlerts?: boolean;
  soundVolume?: number;
  enableBrowserNotifications?: boolean;
  notifyOnDeliberationComplete?: boolean;
  notifyOnError?: boolean;
  notifyOnCostThreshold?: boolean;
}

export interface CapabilityFailure {
  personaId: string;
  personaName: string;
  model: string;
  stage: 1 | 2 | 3;
  reason: string;
  detectedSnippet: string;
}

export interface CouncilRound {
  id: string;
  userQuery: string;
  timestamp: number;
  executionMode?: ExecutionMode;
  resolvedMode?: ResolvedExecutionMode;
  isIsolatedRound?: boolean;
  deliberation: DeliberationStage;
  synthesis: {
    content: string;
    status: StreamStatus;
    error?: string;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
    grounding?: GroundingData;
  };
  attachedImages?: { name: string; url: string; type: string }[];
  attachedTextFiles?: AttachedTextFile[];
  capabilityFailure?: CapabilityFailure;
  auditLogId?: string;
  archivistSummary?: string;
  rating?: RoundRating;
  proComparisonData?: {
    auditLogId: string;
    proModelId: string;
    proContent: string;
    councilLatencyMs: number;
    proLatencyMs: number;
    councilCost: number;
    proCost: number;
    answerAIsCouncil: boolean;
  };
}

export interface Session {
  id: string;
  title: string;
  rounds: CouncilRound[];
  createdAt: number;
  updatedAt: number;
  userId?: string;
  presetId?: PresetId;
  personas?: Persona[];
  synthesizer?: Persona;
  customModels?: Record<string, string>;
  synthesizerModel?: string;
  attachedFiles?: AttachedTextFile[];
}

export interface Settings {
  apiKey: string;
  defaultModels: Record<PersonaId, string>;
  temperature: number;
  maxTokens: number;
  executionMode?: ExecutionMode;
  quickPanelMaxTokens?: number;
  synthesisMaxTokens?: number;
  panelTimeoutSeconds?: number;
  enableSearchGrounding?: boolean;
  webMode?: WebMode;
  disableFallback?: boolean;
  disableLoadingOverlay?: boolean;
  maxRoundCostCeiling?: number;
  stopAfterStage1?: boolean;
  useSingleModelForSimple?: boolean;
  archivistRecentRounds?: number;
  proCompareModelId?: string;
  notificationPreferences?: NotificationPreferences;
}

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  action?: ToastAction;
  duration?: number;
  details?: string;
}
