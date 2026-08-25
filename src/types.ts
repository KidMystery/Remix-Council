export type BudgetPolicy = 'free' | 'cheap' | 'quality';

export interface RawOpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  benchmarks?: {
    intelligence?: number;
    arena_elo?: number;
    elo?: number;
    coding?: number;
    [key: string]: any;
  };
  pricing?: {
    request?: string | number;
    prompt: string | number;
    completion: string | number;
  };
  context_length?: number;
  created?: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
    context_length?: number;
  };
  per_request_limits?: any;
}

export type PersonaId = string;

export interface Persona {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  systemPrompt: string;
  model: string;
  enabled?: boolean;
  archetypeId?: string;
  /** Optional synthesis influence weight. Valid range 0.5 - 2.0. Default 1.0. */
  synthesisWeight?: number;
}

/** Backward-compatible alias used by legacy council components. */
export type CouncilPersona = Persona;

export interface PersonaArchetype {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  systemPrompt: string;
  recommendedModel: string;
}

export type ExtractorKind = 'pdf-text' | 'zip-code' | 'utf8' | 'image' | 'none' | 'failed';

/** How much of the original artifact the extractor actually read. */
export interface EvidenceCoverage {
  extractedChars: number;
  byteSize: number;
  pagesTotal?: number;
  pagesWithText?: number;
  filesInArchive?: number;
  filesExtracted?: number;
}

/**
 * Immutable exhibit metadata. The extracted body lives in IndexedDB (keyed by
 * `id`), never in session JSON. Drive sync sends this record, not the blob.
 */
export interface EvidenceRecord {
  id: string;
  name: string;
  mime: string;
  byteSize: number;
  sha256: string;
  extractor: ExtractorKind;
  extractorVersion: string;
  coverage: EvidenceCoverage;
  createdAt: number;
  /** First ~240 chars for the docket. Never a substitute for the blob. */
  preview: string;
  failDetail?: string;
}

export type RunStamp = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'stopped';

export type RunBlocker =
  | { type: 'extraction_failed'; evidenceId: string; detail: string }
  | { type: 'coverage_thin'; evidenceId: string; ratio: number; threshold: number; detail: string }
  | { type: 'partial_panel'; completed: number; required: number; detail: string }
  | { type: 'cost_unknown'; detail: string }
  | { type: 'legacy_truncated_inline'; detail: string }
  | { type: 'blob_missing'; evidenceId: string; detail: string }
  | { type: 'skipped_stages'; reason: string; detail: string };

export interface AttachedTextFile {
  name: string;
  /** In-memory body for the live run. Persisted JSON always stores ''. */
  content: string;
  size?: number;
  type?: string;
  summary?: string;
  evidenceId?: string;
}

/** Backward-compatible alias used by legacy components (Composer etc.). */
export type AttachedFile = AttachedTextFile;

export interface CitationAnchor {
  source: string;
  quote: string;
  lineRange?: string;
}

export interface ToolExecutionTrace {
  id: string;
  toolName: 'web_search' | 'code_sandbox' | 'invariant_checker';
  input: string;
  output: string;
  status: 'running' | 'success' | 'failed';
  timestamp: number;
}

export interface GroundingSource {
  title?: string;
  url: string;
}

export interface GroundingData {
  sources?: GroundingSource[];
  queries?: string[];
  searchCost?: number;
}

export type WebMode = 'off' | 'auto' | 'always';

export interface ConsensusMetric {
  agreementScore: number; // 0 to 100
  keyConsensusPoints: string[];
  keyDisagreements: string[];
  iterationDelta?: number; // e.g. +15% convergence shift
  panelistAlignment: Record<string, number>; // personaId -> alignment score (0-100)
}

export interface PersonaResponse {
  personaId: string;
  content: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  model?: string;
  actualModel?: string;
  grounding?: GroundingData;
  finishReason?: string;
  truncated?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  durationMs?: number;
  firstTokenMs?: number;
  citations?: CitationAnchor[];
  toolTraces?: ToolExecutionTrace[];
  fallbackChain?: string[];
  error?: string;
}

export type Stage1Response = PersonaResponse;
export type Stage2Response = PersonaResponse;

export interface Stage3Synthesis {
  content: string;
  status: 'pending' | 'streaming' | 'completed' | 'error' | 'idle';
  model?: string;
  chairPersonaId?: string;
  consensusMetric?: ConsensusMetric;
  grounding?: GroundingData;
  finishReason?: string;
  truncated?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  durationMs?: number;
  firstTokenMs?: number;
  citations?: CitationAnchor[];
  error?: string;
}

export type SynthesisResult = Stage3Synthesis;

export interface CouncilDeliberation {
  stage1: Record<PersonaId, PersonaResponse>;
  stage2: Record<PersonaId, PersonaResponse>;
  stage3?: Stage3Synthesis;
}

export interface RoundRating {
  score: number; // 1-5
  tags: string[];
  feedback?: string;
  timestamp: number;
}

export interface CouncilRound {
  id: string;
  userQuery: string;
  timestamp: number;
  deliberation: CouncilDeliberation;
  synthesis: Stage3Synthesis;
  rating?: RoundRating;
  attachedTextFiles?: AttachedTextFile[];
  /** Exhibit metadata. Bodies live in IndexedDB, never here. */
  evidence?: EvidenceRecord[];
  stamp?: RunStamp;
  blockers?: RunBlocker[];
  resolvedMode?: ResolvedExecutionMode;
  mode?: 'full' | 'quick_panel' | 'autonomous' | 'nexus_lab';
  isQuickPanel?: boolean;
  isFollowUp?: boolean;
  parentRoundId?: string;
  branchName?: string;
  cost?: number;
  durationMs?: number;
  /** Legacy field kept for backward compatibility with older session exports. */
  createdAt?: number;
}

export interface Session {
  id: string;
  title: string;
  rounds: CouncilRound[];
  personas: Persona[];
  synthesizer?: Persona;
  activePresetId?: string;
  contextSummary?: string;
  createdAt: number;
  updatedAt: number;
}

/** Backward-compatible alias used by legacy components. */
export type CouncilSession = Session;

export type ResolvedExecutionMode = 'quick_panel' | 'deep_council';

export interface ExecutionPlanSeat {
  personaId: string;
  personaName: string;
  roleKey: string;
  modelId: string;
  fallbackModels: string[];
}

export interface ExecutionPlan {
  roundId: string;
  depth: ResolvedExecutionMode;
  budget: BudgetPolicy;
  domain: string;
  complexity: 'simple' | 'moderate' | 'complex';
  panelists: ExecutionPlanSeat[];
  chair: ExecutionPlanSeat;
  stage1TokenLimit: number;
  stage2TokenLimit: number;
  chairTokenLimit: number;
  maxExpectedCost: number;
  costCeiling: number;
  webMode: WebMode;
  catalogTimestamp: number;
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

export interface NotificationPreferences {
  enableSoundAlerts: boolean;
  soundVolume: number; // 0 to 1
  enableBrowserNotifications: boolean;
  notifyOnDeliberationComplete: boolean;
  notifyOnError: boolean;
  notifyOnCostThreshold: boolean;
}

export interface ToastMessage {
  id: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  details?: string;
  duration?: number;
  action?: {
    label: string;
    variant?: 'primary' | 'secondary' | 'danger';
    onClick: () => void;
  };
}

export interface CapabilityFailure {
  personaId: string;
  personaName: string;
  model: string;
  stage: 1 | 2 | 3;
  reason: string;
  detectedSnippet: string;
}

export interface ArchiveManifestEntry {
  path: string;
  status: string;
  reason?: string;
  extractedChars?: number;
}

export interface ExtractedZipFile {
  path: string;
  name: string;
  size: number;
  content: string;
  isCode?: boolean;
  truncated?: boolean;
}

export interface ZipArchiveResult {
  filename: string;
  archiveType: 'zip' | 'rar';
  files: ExtractedZipFile[];
  totalFiles: number;
  extractedCodeFilesCount: number;
  wasTruncated: boolean;
  warnings: string[];
  formattedContext: string;
}

export interface AutoSaveState {
  lastSavedAt: number | null;
  isSaving: boolean;
  isSyncing: boolean;
  destination: 'cloud' | 'local' | null;
  error?: string | null;
}
