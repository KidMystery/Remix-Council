import React, { useState, useEffect, useRef } from 'react';
import {
  Orbit,
  Play,
  Pause,
  RotateCcw,
  Terminal,
  ShieldCheck,
  Zap,
  Globe,
  Code2,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  Layers,
  ArrowRight,
  Cpu,
  FileDown,
  Printer,
  Paperclip,
  FileCode,
  FileText,
  Archive,
  X,
  Eye,
  Loader2,
  ChevronDown,
  Moon,
  Pencil,
  Copy,
} from 'lucide-react';
import type {
  Persona,
  RawOpenRouterModel,
  CouncilRound,
  CostCeilingConfig,
  ConsensusMetric,
  AttachedTextFile,
  ZipArchiveResult,
} from '../types';
import { policyForPreset, type ExecutionPolicy } from '../lib/executionPolicy';
import { pickBestFromCatalog, pricingIsFree } from '../lib/modelScoring';
import { streamPersonaWithFallback } from '../lib/fallbackManager';
import { ingestFile } from '../lib/evidenceIngest';
import { dropLocalStorageKey, kvDel, kvGet, kvSet, KV_KEYS, readLocalStorageJson } from '../lib/kvStore';
import type { EvidenceRecord } from '../types';
import { copyToClipboard } from '../lib/clipboard';
import { summarizeTitle } from '../lib/titleUtils';
import {
  deleteNexusMission,
  isPersistedMission,
  listNexusMissions,
  mergeNexusDocs,
  NEXUS_SERVER_DEFAULT,
  applyServerJobSummaryToMission,
  buildConsensusCopyText,
  openNexusMission,
  parkActiveMission,
  renameNexusMission,
  sanitizeMissionForStorage,
  type PersistedMission,
  type Tombstone,
} from '../lib/nexusMission';
import { NexusSidebar } from './NexusSidebar';
import {
  DRIVE_AUTH_RESTORED_EVENT,
  isGoogleSignedIn,
  loadNexusDriveDoc,
  saveNexusToDrive,
} from '../lib/drivePersistence';
import type { DocumentChunkPlan } from '../lib/documentChunker';
import {
  buildOvernightPlan,
  canLaunchNexus,
  packExhibitsForServerJob,
} from '../lib/nexusExhibits';
import { archivesFromFiles, isArchiveAttachment, zipResultFromAttached } from '../lib/zipUtils';
import { formatSandboxReport, verifyMissionCode } from '../lib/codeSandbox';
import { ZipFilesModal } from './ZipFilesModal';
import { CreatePersonalityModal } from './CreatePersonalityModal';
import { MessageMarkdown } from './MessageMarkdown';
import {
  launchAgentJob,
  getAgentJob,
  cancelAgentJob,
  isAgentJobTerminal,
} from '../lib/agentClient';
import type { AgentJobFull } from '../lib/agentClient';
import { ConsensusVisualizer } from './ConsensusVisualizer';

export interface NexusLabViewProps {
  personas: Persona[];
  synthesizer: Persona;
  catalog: RawOpenRouterModel[];
  costCeiling: CostCeilingConfig;
  isSignedIn?: boolean;
  isSidebarOpen?: boolean;
  onCloseSidebar?: () => void;
}

export type NexusExecutionMode = 'agent' | 'autonomous' | 'mini_deliberation' | 'model_rotation';
export type NexusEnginePreset = 'frontier_trio' | 'deep_reasoning' | 'fast_and_free' | 'active_council' | 'custom';

export const CURATED_NEXUS_MODELS = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', tag: 'Top Frontier' },
  { id: 'openai/gpt-5.1', name: 'GPT-5.1', tag: 'Omni Frontier' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', tag: 'Fast & Smart' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', tag: 'Deep Context' },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', tag: 'Fast Frontier' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', tag: 'Deep Reasoning' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 Chat', tag: 'Efficient' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', tag: 'Open Weights' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B (Free)', tag: 'Free Tier' },
  { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (Free)', tag: 'Free Tier' },
];

/**
 * Curated live-free fallback for the Nexus free roster (verified Aug 2026).
 * Used only when the live catalog is unavailable or has no zero-cost models
 * left — the dynamic builder below always prefers the live catalog.
 */
const CURATED_NEXUS_FREE_FALLBACK = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B (Free)' },
  { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (Free)' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Free)' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B (Free)' },
];

/**
 * Builds the Nexus free-tier roster dynamically:
 * 1. If a live catalog is available, seats are the best live zero-cost models
 *    (scored by context/recency, distinct from each other).
 * 2. Otherwise it falls back to the curated live-free set.
 */
function buildFreeRoster(catalog?: RawOpenRouterModel[]): { personas: Persona[]; synthesizer: Persona } {
  const used = new Set<string>();
  const picks: Array<{ id: string; name: string }> = [];
  const take = (id: string, name: string) => {
    const key = id.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      picks.push({ id, name });
    }
  };

  if (catalog && catalog.length > 0) {
    for (let i = 0; i < 4; i += 1) {
      const m = pickBestFromCatalog(catalog, 'free', undefined, used);
      if (!m) break;
      take(m.id, m.name || m.id);
    }
  }
  for (const c of CURATED_NEXUS_FREE_FALLBACK) take(c.id, c.name);
  if (picks.length === 0) take('openrouter/free', 'Free Models Router');

  const roles = [
    {
      id: 'nexus_free_a',
      personaName: 'The Sprinter',
      role: 'Fast Specialist',
      avatar: '⚡',
      color: '#10b981',
      prompt: 'You are The Sprinter, the Fast Specialist in Nexus Lab. Provide rapid, concise, structured domain analysis.',
    },
    {
      id: 'nexus_free_b',
      personaName: 'The Open-Weights Juror',
      role: 'Open Weights Evaluator',
      avatar: '🦙',
      color: '#f97316',
      prompt: 'You are The Open-Weights Juror in Nexus Lab. Provide clear open-weights domain analysis and actionable recommendations.',
    },
    {
      id: 'nexus_free_c',
      personaName: 'The Context Keeper',
      role: 'Context Analyst',
      avatar: '🔎',
      color: '#0ea5e9',
      prompt: 'You are The Context Keeper in Nexus Lab. Verify long-range context, flag inconsistencies, and keep the mission grounded.',
    },
  ];

  const panelistCount = picks.length >= 4 ? 3 : Math.max(1, picks.length - 1);
  const personas = roles.slice(0, panelistCount).map((r, i) => ({
    id: r.id,
    name: r.personaName,
    role: r.role,
    avatar: r.avatar,
    color: r.color,
    model: picks[i].id,
    systemPrompt: r.prompt,
    enabled: true,
  }));
  const chairPick = picks[Math.max(3, picks.length - 1)] || picks[0];

  return {
    personas,
    synthesizer: {
      id: 'synth_free',
      name: 'Free Tier Chair',
      role: 'Consensus Chair',
      avatar: '⚖️',
      color: '#6366f1',
      model: chairPick.id,
      systemPrompt: 'You are the Presiding Chair. Synthesize decisive consensus without cost overhead.',
      enabled: true,
    },
  };
}

export function getPresetRoster(
  preset: NexusEnginePreset,
  basePersonas: Persona[],
  baseSynthesizer: Persona,
  catalog?: RawOpenRouterModel[]
): { personas: Persona[]; synthesizer: Persona } {
  if (preset === 'frontier_trio') {
    return {
      personas: [
        {
          id: 'nexus_architect',
          name: 'The Architect',
          role: 'Lead Architect',
          avatar: '🧠',
          color: '#3b82f6',
          model: 'anthropic/claude-sonnet-4.5',
          systemPrompt:
            'You are The Architect, Lead Architect in Nexus Lab. Provide profound structural insights, robust logic, and clear architectural trade-offs.',
          enabled: true,
        },
        {
          id: 'nexus_executor',
          name: 'The Executor',
          role: 'Strategy & Execution',
          avatar: '⚡',
          color: '#10b981',
          model: 'openai/gpt-4o',
          systemPrompt:
            'You are The Executor, Strategy & Execution Specialist in Nexus Lab. Focus on operational execution, edge-case mitigation, and pragmatic paths.',
          enabled: true,
        },
        {
          id: 'nexus_verifier',
          name: 'The Verifier',
          role: 'Verification & Speed',
          avatar: '✨',
          color: '#f59e0b',
          model: 'google/gemini-2.5-flash',
          systemPrompt:
            'You are The Verifier, Verification Specialist in Nexus Lab. Stress-test assumptions, verify facts, and test for hidden vulnerabilities.',
          enabled: true,
        },
      ],
      synthesizer: {
        id: 'synth_frontier',
        name: 'Frontier Consensus Chair',
        role: 'Consensus Chair',
        avatar: '⚖️',
        color: '#6366f1',
        model: 'anthropic/claude-sonnet-4.5',
        systemPrompt:
          'You are the Presiding Chair. Synthesize decisive consensus across all panelists and output invariant agreements.',
        enabled: true,
      },
    };
  }
  if (preset === 'deep_reasoning') {
    return {
      personas: [
        {
          id: 'nexus_first_principles',
          name: 'The First-Principles Analyst',
          role: 'Deep Reasoning Engine',
          avatar: '🔬',
          color: '#8b5cf6',
          model: 'deepseek/deepseek-r1',
          systemPrompt:
            'You are The First-Principles Analyst, Deep Reasoning Engine in Nexus Lab. Perform exhaustive first-principles reasoning and mathematical verification.',
          enabled: true,
        },
        {
          id: 'nexus_system_designer',
          name: 'The System Designer',
          role: 'System Designer',
          avatar: '💡',
          color: '#ec4899',
          model: 'anthropic/claude-sonnet-4.5',
          systemPrompt:
            'You are The System Designer in Nexus Lab. Analyze core problem topology and build complete solution frameworks.',
          enabled: true,
        },
        {
          id: 'nexus_context_synthesist',
          name: 'The Context Synthesist',
          role: 'Contextual Synthesist',
          avatar: '🌐',
          color: '#06b6d4',
          model: 'google/gemini-2.5-pro',
          systemPrompt:
            'You are The Context Synthesist in Nexus Lab. Analyze deep contextual nuances, edge cases, and long-range system trajectories.',
          enabled: true,
        },
      ],
      synthesizer: {
        id: 'synth_deep_reasoning',
        name: 'Reasoning Synthesis Chair',
        role: 'Consensus Chair',
        avatar: '⚖️',
        color: '#6366f1',
        model: 'deepseek/deepseek-r1',
        systemPrompt:
          'You are the Presiding Chair. Synthesize decisive consensus and alignment across deep reasoning passes.',
        enabled: true,
      },
    };
  }
  if (preset === 'fast_and_free') {
    return buildFreeRoster(catalog);
  }
  return { personas: basePersonas, synthesizer: baseSynthesizer };
}

/** Safe hostname for citation chips (annotations should always carry URLs). */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url || '').slice(0, 40) || 'source';
  }
}

const MISSIONS_STORAGE_KEY = 'nexus-missions-v1';
const ARCHIVE_STORAGE_KEY = 'nexus-missions-archive-v1';
const NEXUS_DRIVE_THROTTLE_MS = 4000;

function newMissionId(): string {
  return `nexus_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function loadArchive(): Promise<PersistedMission[]> {
  try {
    const fromIdb = await kvGet<unknown>(KV_KEYS.nexusArchive);
    if (Array.isArray(fromIdb)) return fromIdb as PersistedMission[];
  } catch (err) {
    console.warn('[NexusLab] IndexedDB archive read failed:', err);
  }
  const fromLs = readLocalStorageJson<unknown>(ARCHIVE_STORAGE_KEY);
  return Array.isArray(fromLs) ? (fromLs as PersistedMission[]) : [];
}

let cachedArchive: PersistedMission[] = [];
let cachedDeleted: Tombstone[] = [];

function rememberNexusList(archive: PersistedMission[], deleted?: Tombstone[]): void {
  cachedArchive = archive;
  if (deleted) cachedDeleted = deleted;
}

async function loadDeleted(): Promise<Tombstone[]> {
  try {
    const fromIdb = await kvGet<unknown>(KV_KEYS.nexusDeleted);
    if (Array.isArray(fromIdb)) return fromIdb as Tombstone[];
  } catch (err) {
    console.warn('[NexusLab] IndexedDB tombstone read failed:', err);
  }
  return [];
}

function persistNexusList(archive: PersistedMission[], deleted: Tombstone[] = cachedDeleted): void {
  rememberNexusList(archive, deleted);
  void (async () => {
    try {
      await kvSet(KV_KEYS.nexusArchive, archive);
      await kvSet(KV_KEYS.nexusDeleted, deleted);
      dropLocalStorageKey(ARCHIVE_STORAGE_KEY);
    } catch (err) {
      console.warn('[NexusLab] Failed to persist mission list. Last good copy kept.', err);
    }
  })();
}

async function loadPersistedMission(): Promise<PersistedMission | null> {
  try {
    const fromIdb = await kvGet<unknown>(KV_KEYS.nexusMission);
    if (isPersistedMission(fromIdb)) return fromIdb;
  } catch (err) {
    console.warn('[NexusLab] IndexedDB mission read failed:', err);
  }
  const fromLs = readLocalStorageJson<unknown>(MISSIONS_STORAGE_KEY);
  return isPersistedMission(fromLs) ? fromLs : null;
}

let pendingDriveMission: PersistedMission | null | undefined;
let drivePersistTimer: ReturnType<typeof setTimeout> | null = null;

async function persistMissionLocal(mission: PersistedMission | null): Promise<void> {
  try {
    if (!mission) {
      await kvDel(KV_KEYS.nexusMission);
      dropLocalStorageKey(MISSIONS_STORAGE_KEY);
      return;
    }
    await kvSet(KV_KEYS.nexusMission, sanitizeMissionForStorage(mission));
    dropLocalStorageKey(MISSIONS_STORAGE_KEY);
  } catch (err) {
    console.warn('[NexusLab] Failed to persist mission. Last good copy kept.', err);
  }
}

async function persistMissionToDrive(mission: PersistedMission | null): Promise<void> {
  if (!isGoogleSignedIn()) return;
  try {
    await saveNexusToDrive(mission, cachedArchive, cachedDeleted);
    const { collectMissionEvidenceIds, pushEvidenceBlobsToDrive } = await import('../lib/evidenceDrive');
    const ids = new Set(collectMissionEvidenceIds(mission));
    for (const parked of cachedArchive) {
      for (const id of collectMissionEvidenceIds(parked)) ids.add(id);
    }
    await pushEvidenceBlobsToDrive(Array.from(ids));
  } catch (err) {
    console.warn('[NexusLab] Drive persist failed (local copy kept):', err);
  }
}

function flushNexusDrive(mission: PersistedMission | null): void {
  pendingDriveMission = undefined;
  if (drivePersistTimer) {
    clearTimeout(drivePersistTimer);
    drivePersistTimer = null;
  }
  void persistMissionToDrive(mission);
}

function scheduleNexusDrive(mission: PersistedMission | null): void {
  pendingDriveMission = mission;
  if (drivePersistTimer) return;
  drivePersistTimer = setTimeout(() => {
    drivePersistTimer = null;
    const next = pendingDriveMission;
    pendingDriveMission = undefined;
    if (next === undefined) return;
    void persistMissionToDrive(next);
  }, NEXUS_DRIVE_THROTTLE_MS);
}

function persistMission(mission: PersistedMission | null, immediate = false): void {
  void persistMissionLocal(mission);
  if (immediate) flushNexusDrive(mission);
  else scheduleNexusDrive(mission);
}

function stripJsonBlocks(text: string): string {
  return (text || '').replace(/```json\s*([\s\S]*?)```/g, '').trim();
}

/**
 * Catalog-based mission cost estimate.
 */
function calculateEstimatedCost(
  personas: Persona[],
  rawModelsCatalog: RawOpenRouterModel[],
  maxIterations: number,
  isFreePreset: boolean
): number {
  if (isFreePreset) return 0;
  const INPUT_TOKENS = 2000;
  const OUTPUT_TOKENS = 800;
  const parse = (v: any) => parseFloat(String(v || '0'));
  let costPerIteration = 0;
  for (const p of personas) {
    const m = rawModelsCatalog.find((r) => r.id === p.model);
    if (!m?.pricing) continue;
    costPerIteration += INPUT_TOKENS * parse(m.pricing.prompt) + OUTPUT_TOKENS * parse(m.pricing.completion);
  }
  return costPerIteration * maxIterations;
}

export const NexusLabView: React.FC<NexusLabViewProps> = ({
  personas,
  synthesizer,
  catalog,
  costCeiling,
  isSignedIn = false,
  isSidebarOpen = true,
  onCloseSidebar,
}) => {
  const [missionGoal, setMissionGoal] = useState('');
  const [missionTitle, setMissionTitle] = useState('Nexus Mission');
  const [followUpDirective, setFollowUpDirective] = useState('');
  const [followUpContext, setFollowUpContext] = useState<string | null>(null);
  const [parentMissionId, setParentMissionId] = useState<string | null>(null);
  const [archive, setArchive] = useState<PersistedMission[]>([]);
  const [deletedMissions, setDeletedMissions] = useState<Tombstone[]>([]);
  const [maxIterations, setMaxIterations] = useState(3);
  // Overnight on artifacts is the job. Agent Mode (web theater) is explicit.
  const [executionMode, setExecutionMode] = useState<NexusExecutionMode>('autonomous');
  const [enginePreset, setEnginePreset] = useState<NexusEnginePreset>('frontier_trio');
  const [activePreset, setActivePreset] = useState<'fast_and_free' | 'deep_council'>('deep_council');
  
  const [activeRosterPersonas, setActiveRosterPersonas] = useState<Persona[]>(() =>
    getPresetRoster('frontier_trio', personas, synthesizer, catalog).personas
  );
  const [activeRosterSynthesizer, setActiveRosterSynthesizer] = useState<Persona>(() =>
    getPresetRoster('frontier_trio', personas, synthesizer, catalog).synthesizer
  );
  // Personality editor for the Active Model Panel (per-seat, in place).
  const [editingSeat, setEditingSeat] = useState<Persona | null>(null);

  const handleSelectEnginePreset = (preset: NexusEnginePreset) => {
    setEnginePreset(preset);
    setActivePreset(preset === 'fast_and_free' ? 'fast_and_free' : 'deep_council');
    const roster = getPresetRoster(preset, personas, synthesizer, catalog);
    setActiveRosterPersonas(roster.personas);
    setActiveRosterSynthesizer(roster.synthesizer);
  };

  const handleUpdatePersonaModel = (personaId: string, modelId: string) => {
    setEnginePreset('custom');
    setActiveRosterPersonas((prev) =>
      prev.map((p) => (p.id === personaId ? { ...p, model: modelId } : p))
    );
  };

  const handleUpdateSynthesizerModel = (modelId: string) => {
    setEnginePreset('custom');
    setActiveRosterSynthesizer((prev) => ({ ...prev, model: modelId }));
  };

  /** Save an edited seat personality in place (name, role, avatar, prompt, model). */
  const handleSaveSeatPersona = (saved: Persona) => {
    if (saved.id === activeRosterSynthesizer.id) {
      setActiveRosterSynthesizer(saved);
    } else {
      setActiveRosterPersonas((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    }
    setEnginePreset('custom');
    setEditingSeat(null);
  };

  /** Model palette offered to the per-seat personality editor.
   *  FULL live catalog from /api/council/models — no curated subset cap.
   *  Falls back to the curated list only when the live catalog is empty. */
  const rosterModelOptions = catalog.length > 0
    ? catalog.map((c: RawOpenRouterModel) => ({ id: c.id, name: (c as any).name || c.id }))
    : CURATED_NEXUS_MODELS.map((m) => ({ id: m.id, name: m.name }));
  const [enableWebGrounding, setEnableWebGrounding] = useState(false);
  const [enableCodeSandbox, setEnableCodeSandbox] = useState(true);
  const [deepDocumentMode, setDeepDocumentMode] = useState(false);
  const [pagesPerChunk, setPagesPerChunk] = useState(20);
  // Night Shift: deeper falsification passes + a Morning Brief changelog.
  const [nightShiftEnabled, setNightShiftEnabled] = useState(true);
  const [nightShiftCycles, setNightShiftCycles] = useState(5);
  const [nightShiftPaceMinutes, setNightShiftPaceMinutes] = useState(0);
  const [morningBrief, setMorningBrief] = useState<string | null>(null);
    // Server-run missions: the agent loop lives in server.ts, survives tab close.
    // Default ON (NEXUS_SERVER_DEFAULT) — phone-safe; bounded by server job cost cap.
    const [serverMode, setServerMode] = useState(NEXUS_SERVER_DEFAULT);
  const [serverJobId, setServerJobId] = useState<string | null>(null);
  const [serverJob, setServerJob] = useState<AgentJobFull | null>(null);
  const [documentPlan, setDocumentPlan] = useState<DocumentChunkPlan | null>(null);

  const [attachedFiles, setAttachedFiles] = useState<AttachedTextFile[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [activeZipResult, setActiveZipResult] = useState<ZipArchiveResult | null>(null);
  const [zipArchives, setZipArchives] = useState<Record<string, ZipArchiveResult>>({});
  const [isZipModalOpen, setIsZipModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [rounds, setRounds] = useState<CouncilRound[]>([]);
  const [consensusMetrics, setConsensusMetrics] = useState<ConsensusMetric[]>([]);
  const [missionStatus, setMissionStatus] = useState<PersistedMission['status']>('idle');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  // Clean-by-default display: the telemetry terminal is collapsed until
  // expanded, and the deliberation feed shows only the final verdict plus
  // one-line summaries of earlier cycles (expandable).
  const [showTerminal, setShowTerminal] = useState(false);
  const [showFullDeliberation, setShowFullDeliberation] = useState(false);
  const [showCostApprovalModal, setShowCostApprovalModal] = useState(false);

  // Auto-open the telemetry terminal while a mission runs; collapse it when the
  // run finishes so the results view stays clean.
  const wasRunningRef = useRef(false);
  const isRunningRef = useRef(false);
  const missionIdRef = useRef<string>(newMissionId());
  const [driveTick, setDriveTick] = useState(0);
  useEffect(() => {
    isRunningRef.current = isRunning;
    if (isRunning && !wasRunningRef.current) setShowTerminal(true);
    if (!isRunning && wasRunningRef.current) setShowTerminal(false);
    wasRunningRef.current = isRunning;
  }, [isRunning]);
  const [estimatedMissionCost, setEstimatedMissionCost] = useState(0);
  const [showDossier, setShowDossier] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const pauseRequestedRef = useRef(false);

  const snapshotCurrentMission = (overrides: Partial<PersistedMission> = {}): PersistedMission => ({
    id: missionIdRef.current,
    goal: missionGoal,
    title: missionTitle,
    presetId: activePreset,
    maxIterations,
    currentIteration,
    status: missionStatus,
    rounds,
    consensusMetrics,
    estimatedCost: getEstimatedCost(),
    attachedFiles,
    evidence,
    morningBrief,
    nightShift: nightShiftEnabled ? { cycles: nightShiftCycles, paceMinutes: nightShiftPaceMinutes } : null,
    serverJobId,
    executionMode,
    parentMissionId: parentMissionId || undefined,
    followUpContext,
    updatedAt: Date.now(),
    ...overrides,
  });

  const commitList = (nextArchive: PersistedMission[], nextDeleted: Tombstone[] = deletedMissions) => {
    setArchive(nextArchive);
    setDeletedMissions(nextDeleted);
    persistNexusList(nextArchive, nextDeleted);
  };

  const blankLab = (opts?: { park?: boolean; tombstone?: boolean }) => {
    if (opts?.tombstone) {
      const gone = deleteNexusMission(missionIdRef.current, snapshotCurrentMission(), archive, deletedMissions);
      commitList(gone.archive, gone.deleted);
    } else if (opts?.park) {
      commitList(parkActiveMission(snapshotCurrentMission(), archive), deletedMissions);
    }
    setIsRunning(false);
    pauseRequestedRef.current = false;
    setCurrentIteration(0);
    setRounds([]);
    setConsensusMetrics([]);
    setTerminalLogs([]);
    setAttachedFiles([]);
    setEvidence([]);
    setZipArchives({});
    setActiveZipResult(null);
    setIsZipModalOpen(false);
    setMissionStatus('idle');
    setMissionGoal('');
    setMissionTitle('Nexus Mission');
    setFollowUpContext(null);
    setFollowUpDirective('');
    setParentMissionId(null);
    setDocumentPlan(null);
    setShowDossier(false);
    setMorningBrief(null);
    setNightShiftEnabled(true);
    setServerJobId(null);
    setServerJob(null);
    setServerMode(NEXUS_SERVER_DEFAULT);
    missionIdRef.current = newMissionId();
    persistMission(null, true);
  };

  const applyPersistedMission = (persisted: PersistedMission, cancelled: () => boolean) => {
    if (cancelled()) return;
    missionIdRef.current = persisted.id || missionIdRef.current;
    setMissionGoal(persisted.goal);
    setMissionTitle(persisted.title || summarizeTitle(persisted.goal));
    setMaxIterations(persisted.maxIterations);
    setActivePreset(persisted.presetId === 'deep_council' ? 'deep_council' : 'fast_and_free');
    setCurrentIteration(persisted.currentIteration);
    setRounds(persisted.rounds);
    setConsensusMetrics(persisted.consensusMetrics);
    setMissionStatus(persisted.status);
    setEstimatedMissionCost(persisted.estimatedCost);
    setMorningBrief(persisted.morningBrief || null);
    if (persisted.nightShift) {
      setNightShiftEnabled(true);
      setNightShiftCycles(persisted.nightShift.cycles || 5);
      setNightShiftPaceMinutes(persisted.nightShift.paceMinutes || 0);
    }
    if (persisted.serverJobId) {
      setServerMode(true);
      setServerJobId(persisted.serverJobId);
      setExecutionMode('agent');
    }
    if (persisted.executionMode && ['agent', 'autonomous', 'mini_deliberation', 'model_rotation'].includes(persisted.executionMode)) {
      setExecutionMode(persisted.executionMode as NexusExecutionMode);
    }
    if (persisted.attachedFiles && Array.isArray(persisted.attachedFiles)) {
      setAttachedFiles(persisted.attachedFiles);
      setZipArchives(archivesFromFiles(persisted.attachedFiles));
      if (persisted.evidence) setEvidence(persisted.evidence);
      void import('../lib/evidenceIngest').then(({ hydrateAttachedBodies }) =>
        hydrateAttachedBodies(persisted.attachedFiles || [], persisted.evidence || []).then((h) => {
          if (cancelled()) return;
          setAttachedFiles(h.files);
          setZipArchives((prev) => ({ ...archivesFromFiles(h.files), ...prev }));
          if (h.driveUnread) {
            console.warn('[NexusLab] Drive unread — exhibit bodies not hydrated.');
          } else if (h.missingBlobIds.length) {
            console.warn('[NexusLab] Exhibit bodies missing on this device and Drive:', h.missingBlobIds);
          }
        })
      );
    } else {
      setAttachedFiles([]);
      setEvidence(persisted.evidence || []);
      setZipArchives({});
    }
    setParentMissionId(persisted.parentMissionId || null);
    setFollowUpContext(persisted.followUpContext || null);
    setFollowUpDirective('');
    setDocumentPlan(null);
    setShowDossier(false);
    setTerminalLogs([]);
    if (!persisted.serverJobId) {
      setServerJobId(null);
      setServerJob(null);
    }
  };

  // Restore the last persisted mission + archive on mount (IndexedDB, then leftover LS).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [persisted, localArchive, localDeleted] = await Promise.all([
        loadPersistedMission(),
        loadArchive(),
        loadDeleted(),
      ]);
      if (cancelled) return;
      rememberNexusList(localArchive, localDeleted);
      setArchive(localArchive);
      setDeletedMissions(localDeleted);
      if (persisted) applyPersistedMission(persisted, () => cancelled);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onRestored = () => setDriveTick((n) => n + 1);
    window.addEventListener(DRIVE_AUTH_RESTORED_EVENT, onRestored);
    return () => window.removeEventListener(DRIVE_AUTH_RESTORED_EVENT, onRestored);
  }, []);

  // Pull council-nexus.json on sign-in and after a silent token restore.
  useEffect(() => {
    if (!isSignedIn || !isGoogleSignedIn()) return;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await loadNexusDriveDoc();
        if (cancelled || !remote) return;
        const localMission = await loadPersistedMission();
        const localArchive = await loadArchive();
        const localDeleted = await loadDeleted();
        const merged = mergeNexusDocs(
          {
            version: 2,
            updatedAt: localMission?.updatedAt || 0,
            mission: localMission,
            archive: localArchive,
            deleted: localDeleted,
          },
          remote
        );
        rememberNexusList(merged.archive, merged.deleted);
        setArchive(merged.archive);
        setDeletedMissions(merged.deleted);
        try {
          if (merged.mission) await kvSet(KV_KEYS.nexusMission, merged.mission);
          else await kvDel(KV_KEYS.nexusMission);
          await kvSet(KV_KEYS.nexusArchive, merged.archive);
          await kvSet(KV_KEYS.nexusDeleted, merged.deleted);
        } catch (err) {
          console.warn('[NexusLab] Could not write merged Drive mission locally:', err);
        }
        if (isRunningRef.current) return;
        if (merged.mission) {
          applyPersistedMission(merged.mission, () => cancelled);
        } else if (localMission && (merged.updatedAt || 0) >= (localMission.updatedAt || 0)) {
          blankLab();
        }
      } catch (err) {
        console.warn('[NexusLab] Drive hydrate failed (local mission kept):', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, driveTick]);

  // Poll an in-flight server agent job. Re-attaches after a reload or tab
  // close; the job lives on the server, not in this component.
  useEffect(() => {
    if (!serverJobId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const job = await getAgentJob(serverJobId);
        if (stopped) return;
        if (!job) {
          setIsRunning(false);
          setMissionStatus('error');
          addLog('Mission lost on redeploy (this server has no persistent volume).');
          return;
        }
        setServerJob(job);
        if (isAgentJobTerminal(job.status)) {
          if (job.status === 'done' || job.status === 'stopped_budget') {
            hydrateServerAgentJob(job);
          } else if (job.status === 'failed') {
            setIsRunning(false);
            setMissionStatus('error');
            addLog(`❌ Server mission failed: ${job.error || 'unknown error'}`);
          } else if (job.status === 'cancelled' || job.status === 'interrupted') {
            setIsRunning(false);
            setMissionStatus('paused');
            addLog(`⏸️ Server mission ${job.status === 'cancelled' ? 'cancelled' : 'interrupted'}.`);
          }
          return;
        }
        timeoutRef = window.setTimeout(tick, 4000);
      } catch (err) {
        if (!stopped) {
          console.warn('[Nexus] Server job poll failed:', err);
          timeoutRef = window.setTimeout(tick, 6000);
        }
      }
    };
    let timeoutRef = window.setTimeout(tick, 800);
    return () => {
      stopped = true;
      window.clearTimeout(timeoutRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverJobId]);

  // One-shot sweep: archived missions whose server job finished while the app
  // was closed still say 'running' in the list. Fold each finished job's
  // outcome (status / brief / cost) into the archive so the mission list tells
  // the truth. Full round hydration still happens when the mission is opened.
  const sweptServerJobsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const stale = archive.filter(
      (m) => m.serverJobId && m.status === 'running' && !sweptServerJobsRef.current.has(m.serverJobId)
    );
    if (stale.length === 0) return;
    for (const m of stale) sweptServerJobsRef.current.add(m.serverJobId as string);
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        stale.map(async (m) => {
          try {
            return { m, job: await getAgentJob(m.serverJobId as string) };
          } catch {
            return { m, job: null };
          }
        })
      );
      if (cancelled) return;
      const folded = new Map<
        string,
        ReturnType<typeof applyServerJobSummaryToMission>
      >();
      for (const { m, job } of results) {
        if (job && isAgentJobTerminal(job.status)) {
          const next = applyServerJobSummaryToMission(m, job);
          if (next !== m) folded.set(m.id, next);
        }
      }
      if (folded.size > 0) commitList(archive.map((m) => folded.get(m.id) || m));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive]);

  const addLog = (msg: string) => {
    setTerminalLogs((prev) => [...prev.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Consensus copy buttons (Morning Brief + Agent Mission Report).
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const handleCopyText = async (key: string, text: string) => {
    if (!text.trim()) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const processFiles = async (filesList: FileList | File[]) => {
    if (!filesList || filesList.length === 0) return;

    setIsProcessingFiles(true);
    const newAttachments: AttachedTextFile[] = [];
    const newEvidence: EvidenceRecord[] = [];
    const filesArray = Array.from(filesList);

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      try {
        addLog(`📎 Ingesting exhibit: ${file.name}...`);
        const ingested = await ingestFile(file);
        newAttachments.push(ingested.attached);
        newEvidence.push(ingested.evidence);
        const zip = ingested.archive || zipResultFromAttached(ingested.attached);
        if (zip) {
          setZipArchives((prev) => ({ ...prev, [file.name]: zip }));
        }
        const extracted = ingested.evidence.coverage.filesExtracted;
        addLog(
          ingested.evidence.extractor === 'failed'
            ? `❌ ${file.name}: ${ingested.evidence.failDetail || 'extractor failed'}`
            : extracted != null
              ? `✓ ${file.name} — ${extracted} file${extracted === 1 ? '' : 's'} extracted (${ingested.evidence.coverage.extractedChars.toLocaleString()} chars). Eye to inspect.`
              : `✓ ${file.name} — ${ingested.evidence.coverage.extractedChars.toLocaleString()} chars on docket (blob on this device${isGoogleSignedIn() ? ' + Drive' : ''}).`
        );
      } catch (err: any) {
        addLog(`❌ Error loading file ${file.name}: ${err.message}`);
      }
    }

    setAttachedFiles((prev) => [...prev, ...newAttachments]);
    setEvidence((prev) => [...prev, ...newEvidence]);
    setIsProcessingFiles(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isRunning && !isDraggingOver) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (isRunning) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles((prev) => {
      const removed = prev[index];
      if (removed) {
        setZipArchives((z) => {
          const next = { ...z };
          delete next[removed.name];
          return next;
        });
        setActiveZipResult((cur) => (cur?.filename === removed.name ? null : cur));
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const getEstimatedCost = (): number => {
    // Honest cost: the "free" estimate only holds when every seated model is
    // actually verified zero-cost in the live catalog (or the catalog is
    // unavailable, in which case we can't verify either way).
    const rosterAll = [...(activeRosterPersonas || []), activeRosterSynthesizer].filter(Boolean);
    const isFree =
      enginePreset === 'fast_and_free' &&
      (catalog.length === 0 ||
        rosterAll.every((p) => {
          if (!p?.model) return true;
          if (p.model.toLowerCase() === 'openrouter/free') return true;
          const m = catalog.find((r) => r.id?.toLowerCase() === p.model.toLowerCase());
          if (!m) return p.model.endsWith(':free');
          return pricingIsFree(m);
        }));
    const activePersonas = activeRosterPersonas.filter((p) => p.enabled !== false);
    let passes = executionMode === 'mini_deliberation' ? 1 : maxIterations;
    // Night Shift adds one more paid pass: the Morning Brief synthesis.
    if (nightShiftEnabled && passes > 1) passes += 1;
    return calculateEstimatedCost(activePersonas, catalog, passes, isFree);
  };

  const handlePreLaunchCheck = () => {
    const launch = canLaunchNexus({ files: attachedFiles, followUp: followUpContext });
    if (!launch.ok) {
      addLog(`⛔ ${launch.reason}`);
      return;
    }

    const estCost = getEstimatedCost();
    setEstimatedMissionCost(estCost);

    if (executionMode === 'agent' || serverMode) {
      startServerAgentExecution();
      return;
    }

    if (estCost > costCeiling.requireApprovalAboveDollars && costCeiling.requireApprovalAboveDollars > 0) {
      setShowCostApprovalModal(true);
    } else {
      startAutonomousExecution();
    }
  };

  /**
   * Server-run mission: plan → research → falsify → Morning Brief, executed
   * inside server.ts. Survives tab close; polls until a terminal state.
   */
  const startServerAgentExecution = async () => {
    setShowCostApprovalModal(false);
    setIsRunning(true);
    pauseRequestedRef.current = false;
    setMissionStatus('running');
    setMorningBrief(null);
    const title = summarizeTitle(missionGoal);
    setMissionTitle(title);

    const packed = packExhibitsForServerJob(attachedFiles);
    if (!packed.ok && (attachedFiles.length > 0 || !followUpContext)) {
      addLog(`⛔ ${packed.error}`);
      setIsRunning(false);
      setMissionStatus('idle');
      return;
    }
    const carriedContext = followUpContext ? `[Prior Mission Consensus Memory]\n${followUpContext.slice(0, 6000)}` : '';

    const budget =
      enginePreset === 'fast_and_free' ? 'free' : enginePreset === 'frontier_trio' || enginePreset === 'deep_reasoning' ? 'quality' : 'cheap';
    const capRaw = costCeiling.requireApprovalAboveDollars;
    const jobCap = capRaw > 0 ? Math.min(25, Math.max(0.5, capRaw)) : undefined;

    addLog(
      packed.ok && packed.wasChunked
        ? `📖 Exhibits are ${packed.chars.toLocaleString()} chars — the server will read all ${packed.chunkCount} part${packed.chunkCount === 1 ? '' : 's'} before falsifying${jobCap ? ` (capped at $${jobCap.toFixed(2)})` : ''}...`
        : `☁️ Launching overnight server mission on the exhibits (plan → work the files → falsify)${jobCap ? ` — capped at $${jobCap.toFixed(2)}` : ' — server cost cap applies'}...`
    );
    try {
      const { id } = await launchAgentJob({
        goal: missionGoal || 'Produce a plan from the attached exhibits.',
        mode: 'nexus',
        context: carriedContext || undefined,
        exhibits: packed.ok ? packed.exhibits.map((f) => ({ name: f.name, content: f.content })) : undefined,
        model: activeRosterSynthesizer?.model,
        budget,
        maxResearchQueries: enableWebGrounding ? 3 : 0,
        maxDeliberationPasses: nightShiftEnabled ? nightShiftCycles : maxIterations,
        pacedMinutes: nightShiftEnabled ? nightShiftPaceMinutes : 0,
        maxJobCostUSD: jobCap,
      });
      setServerJobId(id);
      persistMission({
        id: missionIdRef.current,
        goal: missionGoal,
        title,
        presetId: activePreset,
        maxIterations,
        currentIteration: 0,
        status: 'running',
        rounds,
        consensusMetrics,
        estimatedCost: getEstimatedCost(),
        attachedFiles,
        morningBrief: null,
        nightShift: nightShiftEnabled ? { cycles: nightShiftCycles, paceMinutes: nightShiftPaceMinutes } : null,
        serverJobId: id,
        executionMode,
        parentMissionId: parentMissionId || undefined,
        followUpContext,
        updatedAt: Date.now(),
      });
      addLog(`📡 Server mission ${id} accepted — you can close this tab; it keeps working.`);
    } catch (err: any) {
      setIsRunning(false);
      setMissionStatus('error');
      addLog(`❌ Failed to launch server mission: ${err.message}`);
    }
  };

  /** Fold a finished server job back into the mission view. */
  const hydrateServerAgentJob = (job: AgentJobFull) => {
    addLog(
      `🏁 Server mission finished (${job.usageUSD.toFixed(4)} USD${job.readings?.length ? `, ${job.readings.length} exhibit part${job.readings.length === 1 ? '' : 's'} read` : ''}) — hydrating results...`
    );
    const hydratedRounds: CouncilRound[] = job.passes.map((p, i) => ({
      id: `server_${job.id}_pass_${p.index}`,
      userQuery: `[Server mission pass ${p.index}] ${missionGoal}`,
      timestamp: Date.now() + i,
      mode: 'nexus_lab',
      attachedTextFiles: [...attachedFiles],
      deliberation: { stage1: {}, stage2: {} },
      synthesis: {
        content: p.consensus,
        status: 'completed',
        model: job.spec?.model || '',
        consensusMetric: {
          agreementScore: p.agreementScore ?? 50,
          keyConsensusPoints: [],
          keyDisagreements: [],
          panelistAlignment: {},
        },
      },
    }));
    if (job.verdict) {
      hydratedRounds.push({
        id: `server_${job.id}_final`,
        userQuery: `[Server mission final verdict] ${missionGoal}`,
        timestamp: Date.now() + hydratedRounds.length,
        mode: 'nexus_lab',
        attachedTextFiles: [...attachedFiles],
        deliberation: { stage1: {}, stage2: {} },
        synthesis: {
          content: job.verdict,
          status: 'completed',
          model: job.spec?.model || '',
          grounding: { sources: job.citationsList || [], queries: [] },
          consensusMetric: {
            agreementScore: job.passes[job.passes.length - 1]?.agreementScore ?? 50,
            keyConsensusPoints: [],
            keyDisagreements: [],
            panelistAlignment: {},
          },
        },
      });
    }
    const metrics = job.passes
      .filter((p) => typeof p.agreementScore === 'number')
      .map((p) => ({
        agreementScore: p.agreementScore!,
        keyConsensusPoints: [] as string[],
        keyDisagreements: [] as string[],
        panelistAlignment: {} as Record<string, number>,
      }));
    const lastScore = job.passes[job.passes.length - 1]?.agreementScore ?? 50;
    setRounds(hydratedRounds);
    setConsensusMetrics(metrics);
    setMorningBrief(job.brief || null);
    setIsRunning(false);
    setMissionStatus(job.status === 'done' ? (lastScore >= 85 ? 'converged' : 'max_reached') : 'max_reached');
    persistMission({
      id: missionIdRef.current,
      goal: missionGoal,
      title: missionTitle,
      presetId: activePreset,
      maxIterations,
      currentIteration: job.passes.length,
      status: job.status === 'done' ? (lastScore >= 85 ? 'converged' : 'max_reached') : 'max_reached',
      rounds: hydratedRounds,
      consensusMetrics: metrics,
      estimatedCost: job.usageUSD,
      attachedFiles,
      morningBrief: job.brief || null,
      nightShift: nightShiftEnabled ? { cycles: nightShiftCycles, paceMinutes: nightShiftPaceMinutes } : null,
      serverJobId: job.id,
      executionMode,
      parentMissionId: parentMissionId || undefined,
      followUpContext,
      updatedAt: Date.now(),
    });
    addLog(`✨ Server mission complete — ${job.passes.length} pass(es), ${job.research.length} research item(s), ${(job.citationsList || []).length} source(s).`);
  };

  const startAutonomousExecution = async () => {
    setShowCostApprovalModal(false);
    setIsRunning(true);
    pauseRequestedRef.current = false;
    setMissionStatus('running');
    const title = summarizeTitle(missionGoal);
    setMissionTitle(title);

    const policy: ExecutionPolicy = policyForPreset(activePreset);
    const activePersonas = activeRosterPersonas.filter((p) => p.enabled !== false);

    let accumulatedRounds: CouncilRound[] = [...rounds];
    let accumulatedMetrics: ConsensusMetric[] = [...consensusMetrics];

    const overnight = buildOvernightPlan({
      goal: missionGoal,
      files: attachedFiles,
      carriedContext: followUpContext || undefined,
      passes:
        executionMode === 'mini_deliberation'
          ? 1
          : nightShiftEnabled
            ? Math.max(2, nightShiftCycles)
            : maxIterations,
      pagesPerChunk,
      mode: executionMode === 'agent' ? 'autonomous' : executionMode,
    });
    if (!overnight.ok) {
      addLog(`⛔ ${overnight.reason}`);
      setIsRunning(false);
      setMissionStatus('idle');
      return;
    }
    overnight.messages.forEach((m) => addLog(m));
    if (nightShiftEnabled && executionMode !== 'mini_deliberation') {
      addLog(
        `🌙 Night Shift armed: ${overnight.passes.length} pass(es)${
          nightShiftPaceMinutes > 0 ? `, ${nightShiftPaceMinutes} min pacing` : ''
        } + Morning Brief.`
      );
    }

    interface CyclePlan {
      label: string;
      iter: number;
      query: string;
      isFinalSynthesis?: boolean;
      rotationFocus?: string;
    }
    let plan: CyclePlan[] = overnight.passes;
    let docPlan: DocumentChunkPlan | null = overnight.docPlan;
    let docChunks = overnight.docPlan?.chunks || [];
    let documentLedger = '';
    if (docPlan) setDocumentPlan(docPlan);
    addLog(`🚀 Overnight plan: ${plan.length} pass(es) — every exhibit part is read.`);

    const totalPasses = plan.length;

    // Self-correction memory: each cycle's chair consensus is carried into the
    // next cycle, which is instructed to falsify it before building on it.
    let previousSynthesis: string | null = null;
    let previousMetric: ConsensusMetric | undefined;

    for (let qi = 0; qi < plan.length && !pauseRequestedRef.current; qi++) {
      const p = plan[qi];
      const chair =
        executionMode === 'model_rotation'
          ? activePersonas[qi % activePersonas.length] || activeRosterSynthesizer
          : activePersonas[qi % activePersonas.length] || activeRosterSynthesizer;

      let cycleQuery: string;
      if (p.isFinalSynthesis) {
        cycleQuery = `[Deep Document Mode — Final Synthesis]\nDirective: ${missionGoal}\n\nBelow are the accumulated findings from all ${docChunks.length} reviewed sections. Synthesize them into one authoritative, structured report.\n\n${documentLedger || '(no section findings recorded)'}\n\nPresiding Chair: ${chair.name}`;
      } else {
        cycleQuery = `${p.query}\nPresiding Chair: ${chair.name}`;
      }
      // Persist the directive only. The live call still gets cycleQuery (full
      // exhibit dump). Copying that dump into userQuery is what blew
      // council-sessions-v3 when Nexus wrote each cycle into the Chamber session.
      const storedQuery = p.isFinalSynthesis
        ? `[Deep Document Mode — Final Synthesis]\nDirective: ${missionGoal}`
        : `${p.label}\nDirective: ${missionGoal}`;

      setCurrentIteration(qi + 1);
      addLog(`${p.label}: generating proposals across active panel...`);

      const newRound: CouncilRound = {
        id: `nexus_round_${Date.now()}_${qi + 1}`,
        userQuery: storedQuery,
        timestamp: Date.now(),
        mode: 'nexus_lab',
        attachedTextFiles: [...attachedFiles],
        deliberation: { stage1: {}, stage2: {} },
        synthesis: { content: '', status: 'idle' },
      };

      // Stage 1: Proposals (via policy-compliant fallback streaming)
      const s1Promises = activePersonas.map(async (pers) => {
        addLog(`• Model [${pers.name} - ${pers.model.split('/').pop()}] analyzing objective...`);
        try {
          const res = await streamPersonaWithFallback({
            persona: pers,
            messages: [
              { role: 'system', content: pers.systemPrompt },
              { role: 'user', content: cycleQuery },
            ],
            policy,
            rawModels: catalog,
            sessionId: missionIdRef.current,
          });
          newRound.deliberation.stage1[pers.id] = {
            personaId: pers.id,
            model: pers.model,
            actualModel: res.actualModel,
            content: res.content,
            status: 'completed',
            finishReason: res.finishReason,
          };
        } catch (e: any) {
          newRound.deliberation.stage1[pers.id] = {
            personaId: pers.id,
            model: pers.model,
            content: `[Error: ${e.message}]`,
            status: 'error',
            error: e.message,
          };
        }
      });

      await Promise.allSettled(s1Promises);
      addLog(`✓ ${p.label} proposals generated. Chair [${activeRosterSynthesizer.name}] synthesizing consensus...`);

      // Stage 3 Synthesis & Convergence
      const s1Text = Object.entries(newRound.deliberation.stage1)
        .map(([id, r]) => `Persona (${id}):\n${r.content}`)
        .join('\n\n');

      let sandboxBlock = '';
      if (enableCodeSandbox) {
        const checks = verifyMissionCode({
          texts: Object.values(newRound.deliberation.stage1).map((r) => r.content || ''),
          files: attachedFiles.map((f) => ({ name: f.name, content: f.content || '' })),
        });
        sandboxBlock = formatSandboxReport(checks);
        if (checks.length === 0) {
          addLog('🔬 Code verifier: no fences or .js/.json files to check.');
        } else {
          const ok = checks.filter((c) => c.status === 'ok').length;
          const bad = checks.filter((c) => c.status === 'error').length;
          const skipped = checks.filter((c) => c.status === 'skipped').length;
          addLog(`🔬 Code verifier: ${ok} ok, ${bad} error, ${skipped} skipped (compile only).`);
        }
      }

      let synthesis = '';
      let consensusMetric: ConsensusMetric | undefined;
      try {
        const chairPersona: Persona = {
          ...activeRosterSynthesizer,
          id: activeRosterSynthesizer.id || 'synthesizer',
          name: activeRosterSynthesizer.name || 'Presiding Nexus Chair',
          role: activeRosterSynthesizer.role || 'Chair',
        };

        // Reconsideration pass: from cycle 2 onward, the chair must adversarially
        // re-examine the previous consensus instead of simply repeating it.
        // Night Shift escalates the falsification focus pass by pass.
        const NIGHT_SHIFT_ESCALATION = [
          'the factual claims and cited numbers',
          'the cost, pricing, and estimate assumptions',
          'the failure modes, edge cases, and risks',
          'the overconfident generalizations and unstated assumptions',
          'whether the final recommendation is actually actionable given real constraints',
        ];
        const nightShiftFocus =
          nightShiftEnabled && qi > 0
            ? `\n5) Night Shift focus for this pass — concentrate your falsification on: ${
                NIGHT_SHIFT_ESCALATION[(qi - 1) % NIGHT_SHIFT_ESCALATION.length]
              }.`
            : '';
        const reconsiderBlock =
          qi > 0 && previousSynthesis
            ? `\n\n[Self-Correction Pass — do NOT simply repeat the previous cycle]:\nPrevious consensus (${previousMetric?.agreementScore ?? 'unknown'}% agreement):\n${previousSynthesis.slice(0, 3500)}\n\nInstructions:\n1) Adversarially falsify the previous consensus: hunt for factual errors, unsupported claims, missing failure modes, and overconfident generalizations.\n2) Re-derive any critical claim you cannot defend from the panel's findings; if you have web tooling, prefer live verification over memory.\n3) Only change the consensus where you have substantive justification.\n4) State explicitly: what you changed versus the previous cycle and why, and list the top remaining risks/pitfalls.${nightShiftFocus}`
            : '';

        const synthRes = await streamPersonaWithFallback({
          persona: chairPersona,
          messages: [
            { role: 'system', content: 'You are the Presiding Nexus Chair. Synthesize decisive consensus, list immutable invariants, and calculate convergence alignment. After your synthesis append exactly one fenced JSON block with keys: agreementScore (integer 0-100), keyConsensusPoints (array), keyDisagreements (array), panelistAlignment (object of persona id -> integer 0-100).' },
            { role: 'user', content: `Synthesize ${p.label} findings:\n\n${s1Text}${sandboxBlock ? `\n\n${sandboxBlock}` : ''}${reconsiderBlock}` },
          ],
          policy,
          rawModels: catalog,
          sessionId: missionIdRef.current,
        });

        // Real consensus parser from the Chair output.
        synthesis = synthRes.content;
        const jsonMatch = synthesis.match(/```json\s*([\s\S]*?)```/);
        consensusMetric = {
          agreementScore: 50,
          keyConsensusPoints: [] as string[],
          keyDisagreements: [] as string[],
          panelistAlignment: {} as Record<string, number>,
        };
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (typeof parsed.agreementScore === 'number') {
              consensusMetric = parsed as ConsensusMetric;
              synthesis = synthesis.replace(jsonMatch[0], '').trim();
            }
          } catch {
            // ignore parse failure
          }
        }

        consensusMetric = {
          ...consensusMetric,
          iterationDelta:
            qi > 0 && accumulatedMetrics.length > 0
              ? consensusMetric.agreementScore - (accumulatedMetrics[accumulatedMetrics.length - 1]?.agreementScore || consensusMetric.agreementScore)
              : undefined,
        };

        newRound.deliberation.stage3 = {
          model: synthRes.actualModel || chairPersona.model,
          chairPersonaId: chairPersona.id,
          content: synthesis,
          consensusMetric,
          status: 'completed',
          finishReason: synthRes.finishReason,
        };
        newRound.synthesis = {
          model: synthRes.actualModel || chairPersona.model,
          chairPersonaId: chairPersona.id,
          content: synthesis,
          consensusMetric,
          status: 'completed',
          finishReason: synthRes.finishReason,
        };

        accumulatedMetrics = [...accumulatedMetrics, consensusMetric];
        setConsensusMetrics(accumulatedMetrics);
        previousSynthesis = synthesis;
        previousMetric = consensusMetric;
        addLog(`✨ ${p.label} consensus: ${consensusMetric.agreementScore}% alignment.`);
      } catch (err: any) {
        addLog(`❌ Chair synthesis error: ${err.message}`);
      }

      // In deep-document mode, accumulate each section's findings into the ledger.
      if (docPlan && !p.isFinalSynthesis) {
        const partNo = qi + 1;
        const chunk = docChunks[qi];
        documentLedger += `## Part ${partNo} (${chunk?.sourceName || 'document'} — ${chunk?.estimatedPages || '?'} pages)\n${(synthesis || 'No synthesis').slice(0, 1600)}\n\n`;
      }

      accumulatedRounds = [...accumulatedRounds, newRound];
      setRounds(accumulatedRounds);

      // Persist mission progress (truncated for storage).
      persistMission({
        id: missionIdRef.current,
        goal: missionGoal,
        title,
        presetId: activePreset,
        maxIterations: totalPasses,
        currentIteration: qi + 1,
        status: 'running',
        rounds: accumulatedRounds,
        consensusMetrics: accumulatedMetrics,
        estimatedCost: getEstimatedCost(),
        attachedFiles,
        morningBrief,
        nightShift: nightShiftEnabled ? { cycles: nightShiftCycles, paceMinutes: nightShiftPaceMinutes } : null,
        executionMode,
        parentMissionId: parentMissionId || undefined,
        followUpContext,
        updatedAt: Date.now(),
      });

      // Inter-pass pacing. Night Shift can spread passes out across the night;
      // the wait stays interruptible so Pause always responds quickly.
      if (nightShiftEnabled && qi < plan.length - 1 && nightShiftPaceMinutes > 0) {
        addLog(
          `🌙 Night Shift: pacing ${nightShiftPaceMinutes} min before the next falsification pass (the mission keeps working while this tab is open).`
        );
        const paceMs = nightShiftPaceMinutes * 60_000;
        const startedAt = Date.now();
        while (Date.now() - startedAt < paceMs && !pauseRequestedRef.current) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } else {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    // Night Shift Morning Brief: one final chair pass that turns the whole
    // cycle history into a "what changed overnight" changelog.
    let finalMorningBrief: string | null = null;
    if (nightShiftEnabled && totalPasses > 1) {
      addLog('🌅 Night Shift: writing the Morning Brief (what changed overnight)...');
      try {
        const chairPersona: Persona = {
          ...activeRosterSynthesizer,
          id: activeRosterSynthesizer.id || 'synthesizer',
          name: activeRosterSynthesizer.name || 'Presiding Nexus Chair',
          role: activeRosterSynthesizer.role || 'Chair',
        };
        const cycleDigest = accumulatedRounds
          .map((r, i) => {
            const content = stripJsonBlocks(
              r.synthesis?.content || r.deliberation?.stage3?.content || ''
            );
            const score = r.synthesis?.consensusMetric?.agreementScore;
            return `## Cycle ${i + 1} consensus${typeof score === 'number' ? ` (${score}% agreement)` : ''}\n${content.slice(0, 1400)}`;
          })
          .join('\n\n');
        const briefRes = await streamPersonaWithFallback({
          persona: chairPersona,
          messages: [
            {
              role: 'system',
              content:
                'You are the Presiding Nexus Chair writing the Morning Brief for an overnight Night Shift mission. The owner is waking up and needs a changelog, not a rerun. Output exactly these markdown sections with no preamble:\n## What I set out to do\n## Initial consensus\n## What changed overnight\n(for each reversal: what changed and why it changed)\n## Final verdict\n## Top remaining pitfalls\n## Confidence\n(honest: what supports it, what would raise it — do not oversell).',
            },
            {
              role: 'user',
              content: `Mission directive:\n${missionGoal}\n\nFull cycle consensus history:\n${cycleDigest}`,
            },
          ],
          policy,
          rawModels: catalog,
          sessionId: missionIdRef.current,
        });
        finalMorningBrief = briefRes.content || '';
      } catch (err: any) {
        addLog(`❌ Morning Brief failed (final verdicts still stand): ${err.message}`);
      }
    }
    if (finalMorningBrief) setMorningBrief(finalMorningBrief);

    const finalMetrics = accumulatedMetrics;
    const lastScore = finalMetrics.length > 0 ? finalMetrics[finalMetrics.length - 1].agreementScore : 50;
    const finalStatus: PersistedMission['status'] = docPlan
      ? 'converged'
      : lastScore >= 85
        ? 'converged'
        : 'max_reached';

    setIsRunning(false);
    setMissionStatus(finalStatus);
    addLog(
      docPlan
        ? `🏁 Deep Document review complete — ${docChunks.length} parts reviewed and synthesized.`
        : `🏁 Nexus Lab Mission finalized (${lastScore >= 85 ? 'CONVERGED' : 'MAX ITERATIONS REACHED'}).`
    );

    persistMission({
      id: missionIdRef.current,
      goal: missionGoal,
      title,
      presetId: activePreset,
      maxIterations: totalPasses,
      currentIteration: totalPasses,
      status: finalStatus,
      rounds: accumulatedRounds,
      consensusMetrics: finalMetrics,
      estimatedCost: getEstimatedCost(),
      attachedFiles,
      morningBrief: finalMorningBrief || morningBrief,
      nightShift: nightShiftEnabled ? { cycles: nightShiftCycles, paceMinutes: nightShiftPaceMinutes } : null,
        executionMode,
      parentMissionId: parentMissionId || undefined,
      followUpContext,
      updatedAt: Date.now(),
    });
  };

  const handlePause = () => {
    pauseRequestedRef.current = true;
    setIsRunning(false);
    setMissionStatus('paused');
    if (serverJobId) {
      void cancelAgentJob(serverJobId).catch(() => {});
      addLog(`⏸️ Nexus Lab Mission paused — server job cancelled.`);
    } else {
      addLog(`⏸️ Nexus Lab Mission paused.`);
    }
  };

  const handleReset = () => {
    if (serverJobId) void cancelAgentJob(serverJobId).catch(() => {});
    blankLab({ tombstone: true });
    addLog(`🔄 Nexus Lab reset — this mission was removed from the list.`);
  };

  const handleNewMission = () => {
    if (isRunning) return;
    blankLab({ park: true });
    addLog(`📄 New mission. Previous job stayed in the list.`);
    onCloseSidebar?.();
  };

  const handleSelectMission = (id: string) => {
    if (isRunning) {
      addLog('⏸️ Pause the running mission before switching.');
      return;
    }
    if (id === missionIdRef.current) {
      onCloseSidebar?.();
      return;
    }
    const opened = openNexusMission(id, snapshotCurrentMission(), archive);
    if (!opened.active) {
      addLog('⛔ That mission is not in the list.');
      return;
    }
    commitList(opened.archive, deletedMissions);
    applyPersistedMission(opened.active, () => false);
    persistMission(sanitizeMissionForStorage(opened.active), true);
    addLog(`📂 Opened mission: ${opened.active.title || opened.active.goal || opened.active.id}`);
    onCloseSidebar?.();
  };

  const handleDeleteMission = (id: string) => {
    if (isRunning && id === missionIdRef.current) return;
    const next = deleteNexusMission(id, snapshotCurrentMission(), archive, deletedMissions);
    commitList(next.archive, next.deleted);
    if (id === missionIdRef.current) {
      if (next.active) {
        applyPersistedMission(next.active, () => false);
        persistMission(sanitizeMissionForStorage(next.active), true);
      } else {
        blankLab();
      }
    } else {
      persistMission(snapshotCurrentMission(), true);
    }
    addLog('🗑️ Mission removed from the list.');
  };

  const handleRenameMission = (id: string, title: string) => {
    const next = renameNexusMission(id, title, snapshotCurrentMission(), archive);
    commitList(next.archive, deletedMissions);
    if (id === missionIdRef.current) {
      setMissionTitle(title.trim());
      persistMission({ ...snapshotCurrentMission(), title: title.trim() }, true);
    } else {
      persistMission(snapshotCurrentMission(), true);
    }
  };

  const handleFollowUp = () => {
    const directive = followUpDirective.trim();
    if (!directive) return;

    const lastRound = rounds[rounds.length - 1];
    const finalSynthesis = stripJsonBlocks(lastRound?.synthesis?.content || lastRound?.deliberation?.stage3?.content || '');
    const priorConsensus = `Goal: ${missionGoal}\nFinal Consensus:\n${finalSynthesis.slice(0, 4000) || 'No synthesis recorded.'}`;
    const parentId = missionIdRef.current;
    const parked = parkActiveMission(snapshotCurrentMission(), archive);
    commitList(parked, deletedMissions);

    const childId = newMissionId();
    missionIdRef.current = childId;
    setParentMissionId(parentId);
    setFollowUpContext(priorConsensus);
    setMissionGoal(directive);
    setMissionTitle(summarizeTitle(directive) || 'Follow-up');
    setFollowUpDirective('');
    setCurrentIteration(0);
    setRounds([]);
    setConsensusMetrics([]);
    setDocumentPlan(null);
    setMissionStatus('idle');
    setTerminalLogs([]);
    setMorningBrief(null);
    setNightShiftEnabled(true);
    setServerJobId(null);
    setServerJob(null);
    setServerMode(NEXUS_SERVER_DEFAULT);
    persistMission({
      id: childId,
      goal: directive,
      title: summarizeTitle(directive) || 'Follow-up',
      presetId: activePreset,
      maxIterations,
      currentIteration: 0,
      status: 'idle',
      rounds: [],
      consensusMetrics: [],
      estimatedCost: 0,
      attachedFiles,
      evidence,
      morningBrief: null,
      nightShift: nightShiftEnabled ? { cycles: nightShiftCycles, paceMinutes: nightShiftPaceMinutes } : null,
      parentMissionId: parentId,
      followUpContext: priorConsensus,
      executionMode,
      updatedAt: Date.now(),
    }, true);
    addLog(`🔁 Follow-up is its own mission. Last job stayed in the list.`);
  };

  const canExport = missionStatus === 'converged' || missionStatus === 'max_reached';

  const buildDossierMarkdown = (): string => {
    const lines: string[] = [];
    lines.push(`# Council Mission Dossier`);
    lines.push('');
    lines.push(`**Mission:** ${missionTitle}`);
    lines.push(`**Mission Goal:** ${missionGoal}`);
    lines.push(`**Preset:** ${activePreset === 'fast_and_free' ? 'Fast & Free' : 'Deep Frontier'}`);
    lines.push(`**Iterations Run:** ${currentIteration}/${maxIterations}`);
    lines.push(`**Status:** ${missionStatus === 'converged' ? 'Converged' : 'Max Iterations Reached'}`);
    lines.push('');

    if (attachedFiles.length > 0) {
      lines.push(`### Attached Context Files (${attachedFiles.length})`);
      attachedFiles.forEach((f) => {
        lines.push(`- **${f.name}** ${f.size ? `(${Math.round(f.size / 1024)} KB)` : ''}`);
      });
      lines.push('');
    }

    rounds.forEach((r, idx) => {
      lines.push(`## Cycle ${idx + 1}`);
      lines.push('');
      const synthesis = r.synthesis || r.deliberation?.stage3;
      if (synthesis?.content) {
        lines.push(stripJsonBlocks(synthesis.content));
        lines.push('');
      }
      const metric = synthesis?.consensusMetric;
      if (metric) {
        lines.push(`**Agreement Score:** ${metric.agreementScore}%`);
        if (metric.keyConsensusPoints.length > 0) {
          lines.push('**Consensus Points:**');
          metric.keyConsensusPoints.forEach((pt) => lines.push(`- ${pt}`));
        }
        if (metric.keyDisagreements.length > 0) {
          lines.push('**Key Disagreements:**');
          metric.keyDisagreements.forEach((d) => lines.push(`- ${d}`));
        }
        lines.push('');
      }
    });

    const lastMetric = consensusMetrics[consensusMetrics.length - 1];
    lines.push(`## Final Convergence Verdict`);
    lines.push('');
    if (missionStatus === 'converged') {
      lines.push(`The mission converged with a final agreement score of ${lastMetric?.agreementScore ?? 'N/A'}%.`);
    } else {
      lines.push(`The mission reached the maximum iteration limit with a final agreement score of ${lastMetric?.agreementScore ?? 'N/A'}%. Consider refining the directive or raising the cycle budget.`);
    }
    lines.push('');

    if (morningBrief) {
      lines.push(`## 🌅 Morning Brief (Night Shift)`);
      lines.push('');
      lines.push(morningBrief);
      lines.push('');
    }

    return lines.join('\n');
  };

  const handleExportMarkdown = () => {
    const md = buildDossierMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `council-mission-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    setShowDossier(true);
    // Give the print-only dossier a moment to render before opening print dialog.
    setTimeout(() => {
      window.print();
    }, 150);
  };

  const latestMetric = consensusMetrics[consensusMetrics.length - 1];
  const listedMissions = listNexusMissions(snapshotCurrentMission(), archive);

  return (
    <div className="flex flex-1 w-full min-w-0">
      <NexusSidebar
        isOpen={isSidebarOpen}
        onClose={() => onCloseSidebar?.()}
        missions={listedMissions}
        activeMissionId={missionIdRef.current}
        isRunning={isRunning}
        onCreateNew={handleNewMission}
        onSelect={handleSelectMission}
        onRename={handleRenameMission}
        onDelete={handleDeleteMission}
      />
      <div className="min-h-[calc(100vh-65px)] flex-1 min-w-0 bg-slate-950 text-slate-100 p-3 sm:p-6 font-sans">
      {/* Nexus Lab Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 p-4 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-indigo-950/60 border border-emerald-500/30 rounded-3xl shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-2xl shadow-lg shadow-emerald-500/20 text-slate-950">
            <Orbit size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-extrabold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-indigo-200">
                Nexus Autonomous Intelligence Lab
              </h1>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-300">
                Lab Environment
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Overnight multi-pass on artifacts — a tree, a CSV, a statement. Then a plan.
            </p>
          </div>
        </div>

        {/* Status Pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300">
            <Terminal size={13} className="text-emerald-400" />
            <span className="max-w-[180px] truncate" title={missionTitle}>{missionTitle}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300">
            <Cpu size={13} className="text-emerald-400" />
            <span>Cycle: {currentIteration} / {maxIterations}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300">
            <DollarSign size={13} className="text-emerald-400" />
            <span>Est: ${getEstimatedCost().toFixed(3)}</span>
          </div>
          {canExport && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsExportOpen(!isExportOpen)}
                className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 border border-emerald-400/60 shadow-lg shadow-emerald-900/30 cursor-pointer"
              >
                <FileDown size={13} />
                <span>Export Dossier</span>
              </button>
              {isExportOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-2 space-y-1">
                  <button
                    type="button"
                    onClick={() => { handleExportMarkdown(); setIsExportOpen(false); }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-800 text-xs font-semibold text-slate-200 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <FileDown size={14} className="text-emerald-400" />
                    <span>
                      Markdown
                      <span className="block text-[10px] font-mono text-slate-500">council-mission-TIMESTAMP.md</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { handleExportPdf(); setIsExportOpen(false); }}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-800 text-xs font-semibold text-slate-200 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <Printer size={14} className="text-cyan-400" />
                    <span>
                      Print / Save as PDF
                      <span className="block text-[10px] font-mono text-slate-500">Uses the browser print dialog</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Print-only Dossier (invisible on screen) */}
      {showDossier && (
        <div className="nexus-dossier-print hidden print:block">
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-900">
            {buildDossierMarkdown()}
          </pre>
        </div>
      )}

      {/* Main 3-Column Lab Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Command & Tools (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            {/* Research Objective with Drag and Drop */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`space-y-3 p-1 rounded-2xl transition-all ${
                isDraggingOver ? 'ring-2 ring-emerald-400 bg-emerald-950/20' : ''
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Zap size={15} />
                  <span>Research Objective</span>
                </span>
                {isDraggingOver && (
                  <span className="text-[11px] font-mono text-emerald-300 animate-pulse">
                    Drop files to attach
                  </span>
                )}
              </div>

              <textarea
                value={missionGoal}
                onChange={(e) => setMissionGoal(e.target.value)}
                placeholder="What should come out overnight? e.g. Turn this repo + the bank CSV into a Monday plan…"
                rows={4}
                disabled={isRunning}
                className="w-full bg-slate-950 text-slate-100 text-xs sm:text-sm p-3.5 rounded-2xl border border-slate-800 focus:outline-none focus:border-emerald-500 transition-all resize-none shadow-inner leading-relaxed"
              />

              {followUpContext && (
                <div className="text-[11px] text-emerald-300/90 bg-emerald-950/40 border border-emerald-700/40 rounded-xl px-3 py-2 flex items-start gap-2">
                  <ArrowRight size={12} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-bold uppercase tracking-wider text-emerald-400">Follow-up mission</div>
                    <div className="text-slate-400 font-mono mt-0.5">
                      Prior consensus is carried. Last night&apos;s job stayed in the list.
                    </div>
                  </div>
                </div>
              )}

              {/* Prominent File Attachment Dropzone */}
              <div className="space-y-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  multiple
                  accept=".ts,.tsx,.js,.jsx,.py,.json,.sql,.rs,.go,.java,.cpp,.c,.md,.txt,.yaml,.yml,.csv,.pdf,.zip,.rar,.tar,.gz"
                  className="hidden"
                />

                <div
                  onClick={() => {
                    if (!isRunning && !isProcessingFiles) {
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`border-2 border-dashed rounded-2xl p-3 sm:p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1.5 ${
                    isDraggingOver
                      ? 'border-emerald-400 bg-emerald-950/40 text-emerald-200'
                      : 'border-slate-800 hover:border-emerald-500/50 bg-slate-950/60 hover:bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <Paperclip size={16} />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold text-slate-200">
                        {isProcessingFiles
                          ? 'Extracting exhibits...'
                          : 'Attach the artifacts (required)'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        App tree, CSV, statement, PDF — overnight work starts here
                      </div>
                    </div>
                  </div>

                  {isProcessingFiles && (
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono mt-1">
                      <Loader2 size={12} className="animate-spin" />
                      <span>Unpacking files &amp; parsing AST...</span>
                    </div>
                  )}
                </div>

                {/* Attached Files List */}
                {attachedFiles.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between px-1">
                      <span>Attached Context ({attachedFiles.length})</span>
                      <span>
                        {(attachedFiles.reduce((acc, f) => acc + (f.size || 0), 0) / 1024).toFixed(1)} KB Total
                      </span>
                    </div>
                    {attachedFiles.map((file, idx) => {
                      const isArchive = isArchiveAttachment(file);
                      const zip = zipArchives[file.name] || zipResultFromAttached(file);
                      const isPdf = file.type === 'pdf' || file.name.endsWith('.pdf');
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs shadow-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isArchive ? (
                              <Archive size={14} className="text-purple-400 shrink-0" />
                            ) : isPdf ? (
                              <FileText size={14} className="text-red-400 shrink-0" />
                            ) : (
                              <FileCode size={14} className="text-emerald-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-slate-200 font-mono text-[11px] font-medium" title={file.name}>
                                {file.name}
                              </div>
                              {file.size && (
                                <div className="text-[10px] text-slate-500 font-mono">
                                  {(file.size / 1024).toFixed(0)} KB
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            {isArchive && zip && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveZipResult(zip);
                                  setIsZipModalOpen(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-purple-300 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center"
                                title="Inspect extracted archive files"
                              >
                                <Eye size={12} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveFile(idx)}
                              disabled={isRunning}
                              className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer font-bold min-w-[28px] min-h-[28px] flex items-center justify-center"
                              title="Remove attachment"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Execution Mode Selector */}
            <div className="space-y-1.5 pt-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Execution Mode
              </label>
              <button
                type="button"
                onClick={() => setExecutionMode('agent')}
                disabled={isRunning}
                className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border ${
                  executionMode === 'agent'
                    ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20 border-sky-400'
                    : 'text-slate-300 bg-slate-950/80 border-slate-700 hover:border-sky-600'
                }`}
                title="Explicit: server-side web research. Not the default. Nexus’s job is the files you attach."
              >
                <Cpu size={14} />
                <span className="flex-1 text-left">⚡ Agent Mode</span>
                <span className={`text-[10px] font-mono ${executionMode === 'agent' ? 'text-slate-900' : 'text-sky-400'}`}>
                  explicit · web research
                </span>
              </button>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950/80 rounded-2xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setExecutionMode('autonomous')}
                  disabled={isRunning}
                  className={`py-2 px-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 text-center ${
                    executionMode === 'autonomous'
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Zap size={13} />
                  <span>Autonomous</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionMode('mini_deliberation')}
                  disabled={isRunning}
                  className={`py-2 px-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 text-center ${
                    executionMode === 'mini_deliberation'
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ShieldCheck size={13} />
                  <span>Mini Delib</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionMode('model_rotation')}
                  disabled={isRunning}
                  className={`py-2 px-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 text-center ${
                    executionMode === 'model_rotation'
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <RotateCcw size={13} />
                  <span>Rotation</span>
                </button>
              </div>
            </div>

            {/* Engine Preset and Cycles */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Engine Preset</label>
                <select
                  value={enginePreset}
                  onChange={(e) => handleSelectEnginePreset(e.target.value as NexusEnginePreset)}
                  disabled={isRunning}
                  className="w-full bg-slate-950 text-slate-200 text-xs p-2.5 rounded-xl border border-slate-800"
                >
                  <option value="frontier_trio">🌟 Frontier Trio (Architect / Executor / Verifier)</option>
                  <option value="deep_reasoning">🧠 Deep Reasoning (Analyst / Designer / Synthesist)</option>
                  <option value="fast_and_free">⚡ Free Tier (live-verified)</option>
                  <option value="active_council">🏛️ Active Council (Settings)</option>
                  <option value="custom">⚙️ Custom Roster</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  {executionMode === 'mini_deliberation' ? 'Delib Passes' : 'Cycles'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={executionMode === 'mini_deliberation' ? 1 : maxIterations}
                  onChange={(e) => setMaxIterations(parseInt(e.target.value) || 1)}
                  disabled={isRunning || executionMode === 'mini_deliberation'}
                  className="w-full bg-slate-950 text-slate-200 text-xs p-2.5 rounded-xl border border-slate-800 font-mono disabled:opacity-50"
                />
              </div>
            </div>

            {/* Active Panel Roster & Model Selection */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <span>Active Model Panel</span>
                <span className="text-[10px] text-emerald-400 font-mono">
                  {activeRosterPersonas.length} Seats + Chair
                </span>
              </div>

              <div className="space-y-1.5">
                {activeRosterPersonas.map((pers) => (
                  <div
                    key={pers.id}
                    className="p-2 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span>{pers.avatar || '🤖'}</span>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-200 truncate">{pers.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{pers.role}</div>
                      </div>
                    </div>

                    <select
                      value={pers.model}
                      onChange={(e) => handleUpdatePersonaModel(pers.id, e.target.value)}
                      disabled={isRunning}
                      className="bg-slate-900 text-slate-200 text-[11px] p-1.5 rounded-lg border border-slate-700 max-w-[150px] truncate"
                    >
                      <optgroup label="Curated Frontier">
                        {CURATED_NEXUS_MODELS.map((cm) => (
                          <option key={cm.id} value={cm.id}>
                            {cm.name}
                          </option>
                        ))}
                      </optgroup>
                      {catalog.length > 0 && (
                        <optgroup label="All Catalog Models">
                          {catalog.slice(0, 50).map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name || cat.id}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() => setEditingSeat(pers)}
                      disabled={isRunning}
                      title="Edit personality — name, role, avatar, prompt"
                      className="shrink-0 p-1.5 text-slate-500 hover:text-indigo-300 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                ))}

                {/* Chair Seat */}
                <div className="p-2 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span>{activeRosterSynthesizer.avatar || '⚖️'}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-indigo-200 truncate">
                        {activeRosterSynthesizer.name}
                      </div>
                      <div className="text-[10px] text-indigo-400/80 truncate">Consensus Chair</div>
                    </div>
                  </div>

                  <select
                    value={activeRosterSynthesizer.model}
                    onChange={(e) => handleUpdateSynthesizerModel(e.target.value)}
                    disabled={isRunning}
                    className="bg-slate-900 text-slate-200 text-[11px] p-1.5 rounded-lg border border-indigo-700/60 max-w-[150px] truncate"
                  >
                    <optgroup label="Curated Frontier">
                      {CURATED_NEXUS_MODELS.map((cm) => (
                        <option key={cm.id} value={cm.id}>
                          {cm.name}
                        </option>
                      ))}
                    </optgroup>
                    {catalog.length > 0 && (
                      <optgroup label="All Catalog Models">
                        {catalog.slice(0, 50).map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name || cat.id}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setEditingSeat(activeRosterSynthesizer)}
                    disabled={isRunning}
                    title="Edit chair personality — name, role, avatar, prompt"
                    className="shrink-0 p-1.5 text-indigo-400/70 hover:text-indigo-300 bg-slate-900 border border-indigo-700/60 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              </div>
            </div>

            {/* Tool Toggles */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Autonomous Tool Matrix
              </div>

              <label className="flex items-center justify-between p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Globe size={14} className="text-cyan-400" />
                  <span>{executionMode === 'agent' ? 'Live Research (with citations)' : 'Live Web Grounding'}</span>
                </div>
                <input
                  type="checkbox"
                  checked={enableWebGrounding}
                  onChange={(e) => setEnableWebGrounding(e.target.checked)}
                  disabled={isRunning}
                  className="rounded text-emerald-500 focus:ring-0"
                />
              </label>

              {executionMode === 'agent' && (
                <p className="text-[10px] text-slate-500 leading-relaxed px-1 -mt-1">
                  Agent Mode researches on the server — each research pass cites its sources, and the
                  final verdict is fact-checked against them. Off = the agent reasons from its own
                  knowledge only.
                </p>
              )}

              {executionMode !== 'agent' && (
                <label className="flex items-center justify-between p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <Code2 size={14} className="text-purple-400" />
                    <div>
                      <div>Sandboxed Code Verifier</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        Parse JSON / compile JS from fences and exhibits. Never executed.
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableCodeSandbox}
                    onChange={(e) => setEnableCodeSandbox(e.target.checked)}
                    disabled={isRunning}
                    className="rounded text-emerald-500 focus:ring-0"
                  />
                </label>
              )}

              <div className={`p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2 ${executionMode === 'agent' ? 'hidden' : ''}`}>
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <Layers size={14} className="text-emerald-400" />
                    <div>
                      <div>Deep Document Mode</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        Split oversized files into ~page-sized parts and review every part, then synthesize.
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={deepDocumentMode}
                    onChange={(e) => setDeepDocumentMode(e.target.checked)}
                    disabled={isRunning}
                    className="rounded text-emerald-500 focus:ring-0"
                  />
                </label>

                {deepDocumentMode && (
                  <div className="flex items-center justify-between gap-2 pl-1">
                    <span className="text-[10px] text-slate-400">Pages per part</span>
                    <select
                      value={pagesPerChunk}
                      onChange={(e) => setPagesPerChunk(parseInt(e.target.value) || 20)}
                      disabled={isRunning}
                      className="bg-slate-950 text-slate-200 text-xs p-1.5 rounded-lg border border-slate-800"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={40}>40</option>
                      <option value={60}>60</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <Moon size={14} className="text-indigo-300" />
                    <div>
                      <div>🌙 Night Shift</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        Deeper falsification passes + a “what changed overnight” Morning Brief.
                        Runs while this tab is open.
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={nightShiftEnabled}
                    onChange={(e) => setNightShiftEnabled(e.target.checked)}
                    disabled={isRunning}
                    className="rounded text-indigo-500 focus:ring-0"
                  />
                </label>

                {nightShiftEnabled && (
                  <div className="space-y-1.5 pl-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">Falsification passes</span>
                      <select
                        value={nightShiftCycles}
                        onChange={(e) => setNightShiftCycles(parseInt(e.target.value) || 5)}
                        disabled={isRunning}
                        className="bg-slate-950 text-slate-200 text-xs p-1.5 rounded-lg border border-slate-800"
                      >
                        {[3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>{n} cycles</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">Pace between passes</span>
                      <select
                        value={nightShiftPaceMinutes}
                        onChange={(e) => setNightShiftPaceMinutes(parseInt(e.target.value) || 0)}
                        disabled={isRunning}
                        className="bg-slate-950 text-slate-200 text-xs p-1.5 rounded-lg border border-slate-800"
                      >
                        <option value={0}>None (back-to-back)</option>
                        <option value={5}>5 min</option>
                        <option value={10}>10 min</option>
                        <option value={20}>20 min</option>
                        <option value={30}>30 min</option>
                        <option value={60}>1 hr</option>
                        <option value={120}>2 hr</option>
                      </select>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Each pass falsifies the previous consensus on a different front (facts → costs →
                      failure modes → assumptions → actionability), then the Chair writes the Morning
                      Brief changelog. One extra paid pass is added to the cost estimate.
                    </p>
                  </div>
                )}
              </div>

              <div className={`p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl ${executionMode === 'agent' ? 'hidden' : ''}`}>
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <Moon size={14} className="text-sky-300" />
                    <div>
                      <div>☁️ Run on server</div>
                      <div className="text-[10px] text-slate-500 font-normal">
                        The agent loop runs server-side (plan → research → falsify → Morning Brief).
                        Close the tab and it keeps working; the result hydrates on your return.
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={serverMode}
                    onChange={(e) => setServerMode(e.target.checked)}
                    disabled={isRunning}
                    className="rounded text-sky-500 focus:ring-0"
                  />
                </label>
              </div>
            </div>

            {/* Execution Buttons */}
            <div className="flex items-center gap-2 pt-3">
              {!isRunning ? (
                <button
                  type="button"
                  onClick={handlePreLaunchCheck}
                  disabled={!canLaunchNexus({ files: attachedFiles, followUp: followUpContext }).ok}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 text-slate-950 font-bold rounded-2xl text-xs shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
                >
                  <Play size={13} className="fill-current" />
                  <span>
                    {executionMode === 'agent'
                      ? currentIteration > 0
                        ? 'Resume Agent Mission'
                        : '⚡ Run Agent Mode'
                      : currentIteration > 0
                        ? 'Resume Cycle'
                        : deepDocumentMode
                          ? 'Run Deep Review'
                          : serverMode
                            ? nightShiftEnabled && executionMode !== 'mini_deliberation'
                              ? '🌙☁️ Night Shift on Server'
                              : '☁️ Run on Server'
                            : nightShiftEnabled && executionMode !== 'mini_deliberation'
                              ? '🌙 Run Night Shift'
                              : 'Execute Nexus Lab'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePause}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-2xl text-xs shadow-lg transition-all cursor-pointer"
                >
                  <Pause size={13} className="fill-current" />
                  <span>Pause Lab</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleReset}
                disabled={isRunning}
                className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl text-xs border border-slate-700 cursor-pointer"
                title="Reset Lab"
              >
                <RotateCcw size={14} />
              </button>
            </div>

            {/* Follow-up directive (available after a mission finishes) */}
            {(missionStatus === 'converged' || missionStatus === 'max_reached') && (
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <ArrowRight size={13} className="text-emerald-400" />
                  <span>Follow-up Directive</span>
                </div>
                <textarea
                  value={followUpDirective}
                  onChange={(e) => setFollowUpDirective(e.target.value)}
                  placeholder="Refine, extend, or challenge the prior mission…"
                  rows={2}
                  className="w-full bg-slate-950 text-slate-100 text-xs p-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-emerald-500 transition-all resize-none"
                />
                <button
                  type="button"
                  onClick={handleFollowUp}
                  disabled={!followUpDirective.trim()}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Continue as Follow-up (carries prior consensus)
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center & Right Column: Terminal & Consensus Ledger (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {/* Deep Document Mode chunk manifest */}
          {documentPlan && (
            <div className="bg-slate-900/90 border border-emerald-700/50 rounded-3xl p-4 shadow-xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <Layers size={14} />
                  Deep Document Plan — {documentPlan.chunks.length} part{documentPlan.chunks.length === 1 ? '' : 's'}
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  ~{pagesPerChunk} pages/part · {Math.max(1, documentPlan.chunks.length + 1)} review passes
                </span>
              </div>
              <div className="bg-slate-950 rounded-2xl p-3 font-mono text-[11px] text-emerald-300/90 max-h-40 overflow-y-auto space-y-1">
                {documentPlan.messages.length === 0 && (
                  <div className="text-slate-500 italic">No files exceeded the chunk threshold.</div>
                )}
                {documentPlan.messages.map((m, i) => (
                  <div key={i}>{m}</div>
                ))}
              </div>
            </div>
          )}

          {/* Real-Time Convergence Telemetry Gauge */}
          {latestMetric && (
            <ConsensusVisualizer metric={latestMetric} personas={personas} roundIndex={currentIteration} />
          )}

          {/* Live Execution Terminal (collapsed by default for a clean view) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-2">
            <button
              type="button"
              onClick={() => setShowTerminal((v) => !v)}
              className="w-full flex items-center justify-between text-xs cursor-pointer group"
              aria-expanded={showTerminal}
            >
              <div className="flex items-center gap-2 text-emerald-400 font-mono">
                <Terminal size={14} />
                <span>NEXUS-RUNTIME-TELEMETRY</span>
                {terminalLogs.length > 0 && (
                  <span className="text-slate-500 font-sans text-[10px]">
                    {terminalLogs.length} log{terminalLogs.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isRunning && <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
                <span className="text-[10px] text-slate-500 group-hover:text-slate-300">
                  {showTerminal ? 'hide' : 'show'}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-slate-500 transition-transform ${showTerminal ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {showTerminal && (
              <div className="bg-slate-950 rounded-2xl p-3.5 font-mono text-[11px] text-emerald-300/90 max-h-48 overflow-y-auto space-y-1 border-t border-slate-800 pt-2.5">
                {terminalLogs.length === 0 ? (
                  <div className="text-slate-600 italic">Ready for autonomous execution...</div>
                ) : (
                  terminalLogs.map((log, i) => <div key={i}>{log}</div>)
                )}
              </div>
            )}
          </div>

          {/* Live server agent mission (assess → plan → research → falsify → fact-check) */}
          {serverJob && !isAgentJobTerminal(serverJob.status) && (
            <div className="p-5 bg-slate-900/90 border border-sky-700/50 rounded-3xl shadow-xl space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-xs">
                <span className="font-bold text-sky-300 flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" />
                  Agent Mission — {serverJob.progress.phase}
                </span>
                <span className="font-mono text-[11px] text-slate-400">${serverJob.usageUSD.toFixed(4)} USD</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{serverJob.progress.detail}</p>
              {serverJob.plan && (
                <div className="space-y-1.5 text-[11px] text-slate-400">
                  <div>
                    <span className="text-slate-300 font-semibold">Plan: </span>
                    {serverJob.plan.summary}
                  </div>
                  {serverJob.plan.steps.length > 0 && (
                    <ul className="space-y-0.5 pl-4 list-disc">
                      {serverJob.plan.steps.map((s, i) => (
                        <li key={i} className="truncate" title={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {serverJob.research.map((r, i) => (
                <div key={i} className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1">
                  <div className="text-[10px] font-mono text-cyan-300 flex items-center gap-2 flex-wrap">
                    <Globe size={11} />
                    {r.query}
                    {r.sources.length > 0 && (
                      <span className="text-slate-500">({r.sources.length} source{r.sources.length === 1 ? '' : 's'})</span>
                    )}
                  </div>
                  {r.findings && (
                    <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">{r.findings}</p>
                  )}
                  {r.sources.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.sources.slice(0, 4).map((s, j) => (
                        <a
                          key={j}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] font-mono text-sky-400 hover:text-sky-300 bg-sky-950/60 border border-sky-800/60 px-1.5 py-0.5 rounded"
                          title={s.title || s.url}
                        >
                          {s.title || sourceHost(s.url)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 flex-wrap">
                {!!serverJob.readings?.length && <span>parts read: {serverJob.readings.length}</span>}
                <span>research: {serverJob.research.length}</span>
                <span>passes: {serverJob.passes.length}</span>
                <span>sources: {serverJob.citations}</span>
                {serverJob.spec?.model && <span>model: {serverJob.spec.model.split('/').pop()}</span>}
              </div>
              <p className="text-[10px] text-slate-500">
                You can close this tab — the mission keeps working on the server.
              </p>
            </div>
          )}

          {/* Night Shift Morning Brief — the "what changed overnight" changelog */}
          {morningBrief && rounds.length > 0 && (
            <div className="p-5 bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-900 border border-indigo-700/50 rounded-3xl shadow-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-300 border-b border-slate-800 pb-2">
                <Moon size={14} />
                Morning Brief — what changed overnight
                <button
                  type="button"
                  onClick={() => handleCopyText('brief', buildConsensusCopyText(rounds, morningBrief))}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-indigo-200 border border-slate-700 hover:border-indigo-500/60 transition-colors cursor-pointer"
                  title="Copy the consensus (verdict + brief) to clipboard"
                  aria-label="Copy consensus to clipboard"
                >
                  {copiedKey === 'brief' ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  {copiedKey === 'brief' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="text-xs text-slate-200 leading-relaxed">
                <MessageMarkdown content={morningBrief} />
              </div>
            </div>
          )}

          {/* Completed agent mission report: the plan, research, and citations
              stay visible alongside the hydrated verdict cards below. */}
          {serverJob && isAgentJobTerminal(serverJob.status) && rounds.length > 0 && (
            <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-3xl shadow-xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-xs">
                <span className="font-bold text-sky-300 flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  Agent Mission Report
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyText('report', buildConsensusCopyText(rounds, morningBrief))}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-sky-200 border border-slate-700 hover:border-sky-500/60 transition-colors cursor-pointer"
                    title="Copy the consensus (verdict + brief) to clipboard"
                    aria-label="Copy consensus to clipboard"
                  >
                    {copiedKey === 'report' ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {copiedKey === 'report' ? 'Copied' : 'Copy'}
                  </button>
                  <span className="font-mono text-[11px] text-slate-400">
                    {serverJob.status === 'done' ? 'complete' : serverJob.status} · ${serverJob.usageUSD.toFixed(4)} USD
                  </span>
                </span>
              </div>
              {serverJob.plan && (
                <div className="space-y-1.5 text-[11px] text-slate-400">
                  <div className="text-slate-300 font-semibold text-xs">The plan</div>
                  <p>{serverJob.plan.summary}</p>
                  {serverJob.plan.steps.length > 0 && (
                    <ul className="space-y-0.5 pl-4 list-disc">
                      {serverJob.plan.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {serverJob.research.length > 0 && (
                <div className="space-y-2">
                  <div className="text-slate-300 font-semibold text-xs">What was researched</div>
                  {serverJob.research.map((r, i) => (
                    <div key={i} className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1.5">
                      <div className="text-[10px] font-mono text-cyan-300 flex items-center gap-2 flex-wrap">
                        <Globe size={11} />
                        {r.query}
                      </div>
                      {r.findings && !r.findings.startsWith('[Research failed') && (
                        <p className="text-[10px] text-slate-400 leading-relaxed max-h-24 overflow-y-auto">{r.findings}</p>
                      )}
                      {r.sources.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {r.sources.map((s, j) => (
                            <a
                              key={j}
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] font-mono text-sky-400 hover:text-sky-300 bg-sky-950/60 border border-sky-800/60 px-1.5 py-0.5 rounded"
                              title={s.title || s.url}
                            >
                              {s.title || sourceHost(s.url)}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {serverJob.confidence && (
                <div className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800 pt-2">
                  <span className="text-slate-300 font-semibold">Confidence: </span>
                  {serverJob.confidence}
                </div>
              )}
            </div>
          )}

          {/* Iteration Findings Feed — clean by default: final verdict in full,
              earlier cycles as one-liners. Toggle reveals the full thread. */}
          {rounds.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Layers size={14} className="text-emerald-400" />
                  <span>Synthesized Convergence Verdicts</span>
                </div>
                {rounds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowFullDeliberation((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                    title="Toggle the full deliberation thread (all cycles, complete text)"
                  >
                    <ChevronDown size={12} className={`transition-transform ${showFullDeliberation ? 'rotate-180' : ''}`} />
                    {showFullDeliberation ? 'Clean view' : 'Full deliberation'}
                  </button>
                )}
              </div>

              {/* Earlier cycles: one-line summary (or full, when expanded) */}
              {rounds.slice(0, -1).map((r, idx) => {
                const content = r.deliberation?.stage3?.content || '';
                const score = r.deliberation?.stage3?.consensusMetric?.agreementScore;
                return (
                  <div key={r.id}>
                    {showFullDeliberation ? (
                      <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-3xl shadow-xl space-y-3 mb-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 text-xs">
                          <span className="font-bold text-emerald-400">Cycle {idx + 1} Consensus</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            {new Date(r.timestamp || r.createdAt || Date.now()).toLocaleTimeString()}
                          </span>
                        </div>
                        {content && <MessageMarkdown content={content} />}
                      </div>
                    ) : (
                      <div className="mb-2 flex items-baseline gap-2 px-4 py-2.5 bg-slate-900/60 border border-slate-800/80 rounded-2xl text-[11px] text-slate-400">
                        <span className="font-bold text-emerald-400/90 shrink-0">
                          Cycle {idx + 1}
                        </span>
                        {typeof score === 'number' && (
                          <span className="shrink-0 font-mono text-cyan-300/90">{score}% aligned</span>
                        )}
                        <span className="truncate" title={content.replace(/\s+/g, ' ')}>
                          {content ? content.replace(/^#+\s*/gm, '').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) : 'No synthesis'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Final cycle: always shown in full */}
              {(() => {
                const r = rounds[rounds.length - 1];
                const idx = rounds.length - 1;
                return (
                  <div className="p-5 bg-slate-900/90 border border-emerald-800/40 rounded-3xl shadow-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 text-xs">
                      <span className="font-bold text-emerald-300">
                        Cycle {idx + 1} Consensus {rounds.length > 1 && <span className="text-emerald-500/70 font-semibold">— Final Verdict</span>}
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        {new Date(r.timestamp || r.createdAt || Date.now()).toLocaleTimeString()}
                      </span>
                    </div>
                    {r.deliberation?.stage3?.content ? (
                      <MessageMarkdown content={r.deliberation.stage3.content} />
                    ) : (
                      <div className="text-slate-500 italic">No synthesis recorded for this cycle.</div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Pre-Execution Cost Approval Modal */}
      {showCostApprovalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-amber-500/60 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2.5 bg-amber-950/80 rounded-2xl border border-amber-800">
                <AlertTriangle size={22} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">Estimated Cost Approval Required</h3>
                <p className="text-[11px] text-slate-400">User threshold guard triggered</p>
              </div>
            </div>

            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Estimated Mission Cost:</span>
                <span className="font-mono font-bold text-amber-300">${estimatedMissionCost.toFixed(4)} USD</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Approval Limit:</span>
                <span className="font-mono text-slate-300">${costCeiling.requireApprovalAboveDollars.toFixed(2)} USD</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Planned Cycles:</span>
                <span className="font-mono text-slate-300">
                  {nightShiftEnabled && executionMode !== 'mini_deliberation' ? nightShiftCycles : maxIterations} Cycles
                  {nightShiftEnabled && executionMode !== 'mini_deliberation' ? ' + Morning Brief' : ''}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              This autonomous mission will orchestrate multi-model panels across{' '}
              {nightShiftEnabled && executionMode !== 'mini_deliberation' ? nightShiftCycles : maxIterations} cycles
              {nightShiftEnabled && executionMode !== 'mini_deliberation'
                ? ', each falsifying the previous consensus, plus a final Morning Brief synthesis'
                : ''}
              . Confirm execution to proceed.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCostApprovalModal(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startAutonomousExecution}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg cursor-pointer"
              >
                Approve & Execute
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Archive Inspection Modal */}
      <ZipFilesModal
        zipResult={activeZipResult}
        isOpen={isZipModalOpen}
        onClose={() => setIsZipModalOpen(false)}
      />

      {/* Per-seat personality editor (Active Model Panel) */}
      <CreatePersonalityModal
        isOpen={!!editingSeat}
        onClose={() => setEditingSeat(null)}
        onSave={handleSaveSeatPersona}
        availableModels={rosterModelOptions}
        editingPersona={editingSeat}
      />
      </div>
    </div>
  );
};

export { calculateEstimatedCost };
