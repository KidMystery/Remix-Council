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

export interface CouncilRound {
  id: string;
  userQuery: string;
  timestamp: number;
  executionMode?: ExecutionMode;
  resolvedMode?: ResolvedExecutionMode;
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
  auditLogId?: string;
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
  maxRoundCostCeiling?: number;
  stopAfterStage1?: boolean;
  useSingleModelForSimple?: boolean;
}
