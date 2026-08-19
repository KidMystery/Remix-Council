export type BudgetPolicy = 'free' | 'cheap' | 'quality';

export interface RawOpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: string | number;
    completion: string | number;
  };
  context_length?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  per_request_limits?: any;
}

export interface PersonaArchetype {
  id: string;
  name: string;
  category: 'security' | 'architecture' | 'strategy' | 'compliance' | 'finance' | 'creative';
  role: string;
  systemPrompt: string;
  recommendedModel: string;
  iconName: string;
}

export interface CouncilPersona {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
  enabled?: boolean;
  color?: string;
  icon?: string;
  archetypeId?: string;
}

export interface AttachedFile {
  name: string;
  content: string;
  type?: string;
  size?: number;
}

export interface CitationAnchor {
  source: string;
  quote: string;
  lineRange?: string;
}

export interface ConsensusMetric {
  agreementScore: number; // 0 to 100
  keyConsensusPoints: string[];
  keyDisagreements: string[];
  iterationDelta?: number; // e.g. +15% convergence shift
  panelistAlignment: Record<string, number>; // personaId -> alignment score (0-100)
}

export interface ToolExecutionTrace {
  id: string;
  toolName: 'web_search' | 'code_sandbox' | 'invariant_checker';
  input: string;
  output: string;
  status: 'running' | 'success' | 'failed';
  timestamp: number;
}

export interface Stage1Response {
  personaId: string;
  model: string;
  content: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  citations?: CitationAnchor[];
  toolTraces?: ToolExecutionTrace[];
  cost?: number;
  tokens?: number;
  error?: string;
}

export interface Stage2Response {
  reviewerId: string;
  model: string;
  content: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  citations?: CitationAnchor[];
  cost?: number;
  tokens?: number;
  error?: string;
}

export interface Stage3Synthesis {
  model: string;
  content: string;
  chairPersonaId?: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  citations?: CitationAnchor[];
  consensusMetric?: ConsensusMetric;
  cost?: number;
  tokens?: number;
  error?: string;
}

export interface CouncilDeliberation {
  stage1: Record<string, Stage1Response>;
  stage2: Record<string, Stage2Response>;
  stage3?: Stage3Synthesis;
}

export interface CouncilRound {
  id: string;
  userQuery: string;
  attachedTextFiles?: AttachedFile[];
  deliberation: CouncilDeliberation;
  mode?: 'full' | 'quick_panel' | 'autonomous' | 'nexus_lab';
  cost?: number;
  durationMs?: number;
  createdAt: number;
  isQuickPanel?: boolean;
  parentRoundId?: string;
  branchName?: string;
}

export interface CouncilSession {
  id: string;
  title: string;
  rounds: CouncilRound[];
  personas: CouncilPersona[];
  activePresetId?: string;
  contextSummary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CostCeilingConfig {
  maxSpendPerMissionDollars: number;
  requireApprovalAboveDollars: number;
  strictHardStop: boolean;
}

export interface AutonomousMission {
  id: string;
  goal: string;
  presetId: string;
  policyBudget: BudgetPolicy;
  rotatingChair: boolean;
  maxIterations: number;
  currentIteration: number;
  status: 'idle' | 'running' | 'paused' | 'converged' | 'max_reached' | 'awaiting_approval' | 'error';
  rounds: CouncilRound[];
  chairHistory: { roundIndex: number; personaId: string; personaName: string }[];
  consensusHistory: ConsensusMetric[];
  estimatedCost: number;
  actualCost: number;
  costCeiling: CostCeilingConfig;
}

export interface FallbackAuditLog {
  id: string;
  originalModel: string;
  attemptedModel: string;
  error: string;
  timestamp: number;
  sessionId?: string;
}
