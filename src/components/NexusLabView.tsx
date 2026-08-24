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
import { extractCodeFromArchive } from '../lib/zipReader';
import { extractTextFromPDF } from '../lib/pdfUtils';
import { summarizeTitle } from '../lib/titleUtils';
import { chunkDocuments, type DocumentChunkPlan } from '../lib/documentChunker';
import { ZipFilesModal } from './ZipFilesModal';
import { MessageMarkdown } from './MessageMarkdown';
import { ConsensusVisualizer } from './ConsensusVisualizer';

export interface NexusLabViewProps {
  personas: Persona[];
  synthesizer: Persona;
  catalog: RawOpenRouterModel[];
  onCompleteRound: (sessionId: string, round: CouncilRound) => void;
  activeSessionId?: string | null;
  costCeiling: CostCeilingConfig;
}

export type NexusExecutionMode = 'autonomous' | 'mini_deliberation' | 'model_rotation';
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
      role: 'Fast Specialist',
      avatar: '⚡',
      color: '#10b981',
      prompt: 'You are the Fast Specialist in Nexus Lab. Provide rapid, concise, structured domain analysis.',
    },
    {
      id: 'nexus_free_b',
      role: 'Open Weights Evaluator',
      avatar: '🦙',
      color: '#f97316',
      prompt: 'You are the Open Weights Evaluator in Nexus Lab. Provide clear open-weights domain analysis and actionable recommendations.',
    },
    {
      id: 'nexus_free_c',
      role: 'Context Analyst',
      avatar: '🔎',
      color: '#0ea5e9',
      prompt: 'You are the Context Analyst in Nexus Lab. Verify long-range context, flag inconsistencies, and keep the mission grounded.',
    },
  ];

  const panelistCount = picks.length >= 4 ? 3 : Math.max(1, picks.length - 1);
  const personas = roles.slice(0, panelistCount).map((r, i) => ({
    id: r.id,
    name: picks[i].name,
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
          id: 'claude_frontier',
          name: 'Claude Sonnet 4.5',
          role: 'Lead Architect',
          avatar: '🧠',
          color: '#3b82f6',
          model: 'anthropic/claude-sonnet-4.5',
          systemPrompt:
            'You are Claude Sonnet 4.5, Lead Architect in Nexus Lab. Provide profound structural insights, robust logic, and clear architectural trade-offs.',
          enabled: true,
        },
        {
          id: 'gpt4o_frontier',
          name: 'GPT-4o',
          role: 'Strategy & Execution',
          avatar: '⚡',
          color: '#10b981',
          model: 'openai/gpt-4o',
          systemPrompt:
            'You are GPT-4o, Strategy & Execution Specialist in Nexus Lab. Focus on operational execution, edge-case mitigation, and pragmatic paths.',
          enabled: true,
        },
        {
          id: 'gemini_frontier',
          name: 'Gemini 2.5 Flash',
          role: 'Verification & Speed',
          avatar: '✨',
          color: '#f59e0b',
          model: 'google/gemini-2.5-flash',
          systemPrompt:
            'You are Gemini 2.5 Flash, Verification Specialist in Nexus Lab. Stress-test assumptions, verify facts, and test for hidden vulnerabilities.',
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
          id: 'r1_reasoner',
          name: 'DeepSeek R1',
          role: 'Deep Reasoning Engine',
          avatar: '🔬',
          color: '#8b5cf6',
          model: 'deepseek/deepseek-r1',
          systemPrompt:
            'You are DeepSeek R1, Deep Reasoning Engine. Perform exhaustive first-principles reasoning and mathematical verification.',
          enabled: true,
        },
        {
          id: 'claude_reasoner',
          name: 'Claude Sonnet 4.5 (Thinking)',
          role: 'System Designer',
          avatar: '💡',
          color: '#ec4899',
          model: 'anthropic/claude-sonnet-4.5',
          systemPrompt:
            'You are Claude Sonnet 4.5 with extended thinking. Analyze core problem topology and build complete solution frameworks.',
          enabled: true,
        },
        {
          id: 'gemini_pro_reasoner',
          name: 'Gemini 2.5 Pro',
          role: 'Contextual Synthesist',
          avatar: '🌐',
          color: '#06b6d4',
          model: 'google/gemini-2.5-pro',
          systemPrompt:
            'You are Gemini 2.5 Pro. Analyze deep contextual nuances, edge cases, and long-range system trajectories.',
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

const MISSIONS_STORAGE_KEY = 'nexus-missions-v1';
const ARCHIVE_STORAGE_KEY = 'nexus-missions-archive-v1';
const MAX_STORED_CONTENT_CHARS = 5000;

interface PersistedMission {
  id: string;
  goal: string;
  title?: string;
  presetId: string;
  maxIterations: number;
  currentIteration: number;
  status: 'idle' | 'running' | 'paused' | 'converged' | 'max_reached' | 'awaiting_approval' | 'error';
  rounds: CouncilRound[];
  consensusMetrics: ConsensusMetric[];
  estimatedCost: number;
  attachedFiles?: AttachedTextFile[];
  updatedAt: number;
}

function loadArchive(): PersistedMission[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushArchive(mission: PersistedMission): void {
  try {
    const list = loadArchive();
    list.unshift(mission);
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(list.slice(0, 20)));
  } catch (err) {
    console.warn('[NexusLab] Failed to archive mission:', err);
  }
}

function sanitizeMissionForStorage(mission: PersistedMission): PersistedMission {
  return {
    ...mission,
    attachedFiles: (mission.attachedFiles || []).map((f) => ({
      ...f,
      content:
        f.content && f.content.length > MAX_STORED_CONTENT_CHARS
          ? f.content.slice(0, MAX_STORED_CONTENT_CHARS)
          : f.content || '',
    })),
    rounds: mission.rounds.map((r) => ({
      ...r,
      attachedTextFiles: (r.attachedTextFiles || []).map((f) => ({
        ...f,
        content:
          f.content && f.content.length > MAX_STORED_CONTENT_CHARS
            ? f.content.slice(0, MAX_STORED_CONTENT_CHARS)
            : f.content || '',
      })),
    })),
  };
}

function loadPersistedMission(): PersistedMission | null {
  try {
    const raw = localStorage.getItem(MISSIONS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rounds)) {
      return parsed as PersistedMission;
    }
    return null;
  } catch (err) {
    console.warn('[NexusLab] Failed to load persisted mission:', err);
    return null;
  }
}

function persistMission(mission: PersistedMission | null): void {
  try {
    if (!mission) {
      localStorage.removeItem(MISSIONS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(sanitizeMissionForStorage(mission)));
  } catch (err) {
    console.warn('[NexusLab] Failed to persist mission:', err);
  }
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
  onCompleteRound,
  activeSessionId,
  costCeiling,
}) => {
  const [missionGoal, setMissionGoal] = useState('');
  const [missionTitle, setMissionTitle] = useState('Nexus Mission');
  const [followUpDirective, setFollowUpDirective] = useState('');
  const [followUpContext, setFollowUpContext] = useState<string | null>(null);
  const [maxIterations, setMaxIterations] = useState(3);
  const [executionMode, setExecutionMode] = useState<NexusExecutionMode>('autonomous');
  const [enginePreset, setEnginePreset] = useState<NexusEnginePreset>('frontier_trio');
  const [activePreset, setActivePreset] = useState<'fast_and_free' | 'deep_council'>('deep_council');
  
  const [activeRosterPersonas, setActiveRosterPersonas] = useState<Persona[]>(() =>
    getPresetRoster('frontier_trio', personas, synthesizer, catalog).personas
  );
  const [activeRosterSynthesizer, setActiveRosterSynthesizer] = useState<Persona>(() =>
    getPresetRoster('frontier_trio', personas, synthesizer, catalog).synthesizer
  );
  const [isRosterModalOpen, setIsRosterModalOpen] = useState(false);

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
  const [enableWebGrounding, setEnableWebGrounding] = useState(true);
  const [enableCodeSandbox, setEnableCodeSandbox] = useState(true);
  const [deepDocumentMode, setDeepDocumentMode] = useState(false);
  const [pagesPerChunk, setPagesPerChunk] = useState(20);
  const [documentPlan, setDocumentPlan] = useState<DocumentChunkPlan | null>(null);

  const [attachedFiles, setAttachedFiles] = useState<AttachedTextFile[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [activeZipResult, setActiveZipResult] = useState<ZipArchiveResult | null>(null);
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
  useEffect(() => {
    if (isRunning && !wasRunningRef.current) setShowTerminal(true);
    if (!isRunning && wasRunningRef.current) setShowTerminal(false);
    wasRunningRef.current = isRunning;
  }, [isRunning]);
  const [estimatedMissionCost, setEstimatedMissionCost] = useState(0);
  const [showDossier, setShowDossier] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const pauseRequestedRef = useRef(false);

  // Restore the last persisted mission on mount.
  useEffect(() => {
    const persisted = loadPersistedMission();
    if (persisted) {
      setMissionGoal(persisted.goal);
      setMissionTitle(persisted.title || summarizeTitle(persisted.goal));
      setMaxIterations(persisted.maxIterations);
      setActivePreset(persisted.presetId === 'deep_council' ? 'deep_council' : 'fast_and_free');
      setCurrentIteration(persisted.currentIteration);
      setRounds(persisted.rounds);
      setConsensusMetrics(persisted.consensusMetrics);
      setMissionStatus(persisted.status);
      setEstimatedMissionCost(persisted.estimatedCost);
      if (persisted.attachedFiles && Array.isArray(persisted.attachedFiles)) {
        setAttachedFiles(persisted.attachedFiles);
      }
    }
  }, []);

  const addLog = (msg: string) => {
    setTerminalLogs((prev) => [...prev.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const processFiles = async (filesList: FileList | File[]) => {
    if (!filesList || filesList.length === 0) return;

    setIsProcessingFiles(true);
    const newAttachments: AttachedTextFile[] = [];
    const filesArray = Array.from(filesList);

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const name = file.name;
      const lower = name.toLowerCase();

      try {
        if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.tar') || lower.endsWith('.gz')) {
          addLog(`📦 Extracting archive: ${name}...`);
          const result = await extractCodeFromArchive(file);
          setActiveZipResult(result);
          newAttachments.push({
            name,
            content: result.formattedContext,
            size: file.size,
            type: result.archiveType,
          });
          addLog(`✓ Archive ${name} processed: ${result.extractedCodeFilesCount} code files loaded.`);
        } else if (lower.endsWith('.pdf')) {
          addLog(`📄 Extracting text from PDF: ${name}...`);
          const text = await extractTextFromPDF(file);
          newAttachments.push({
            name,
            content: text,
            size: file.size,
            type: 'pdf',
          });
          addLog(`✓ PDF ${name} text extracted.`);
        } else {
          const text = await file.text();
          newAttachments.push({
            name,
            content: text,
            size: file.size,
            type: file.type || 'text/plain',
          });
          addLog(`✓ Attached file: ${name}`);
        }
      } catch (err: any) {
        addLog(`❌ Error loading file ${name}: ${err.message}`);
      }
    }

    setAttachedFiles((prev) => [...prev, ...newAttachments]);
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
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
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
    const passes = executionMode === 'mini_deliberation' ? 1 : maxIterations;
    return calculateEstimatedCost(activePersonas, catalog, passes, isFree);
  };

  const handlePreLaunchCheck = () => {
    if (!missionGoal.trim() && attachedFiles.length === 0) return;

    const estCost = getEstimatedCost();
    setEstimatedMissionCost(estCost);

    if (estCost > costCeiling.requireApprovalAboveDollars && costCeiling.requireApprovalAboveDollars > 0) {
      setShowCostApprovalModal(true);
    } else {
      startAutonomousExecution();
    }
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

    // Format attached files for insertion into cycles
    const attachmentContext =
      attachedFiles.length > 0
        ? `\n\n[Attached Reference & Codebase Files]:\n` +
          attachedFiles
            .map((f) => `--- File: ${f.name} ---\n${f.content}`)
            .join('\n\n')
        : '';

    // Carry prior-mission consensus forward when this is a follow-up run.
    const carriedContext = followUpContext
      ? `\n\n[Prior Mission Consensus Memory]:\n${followUpContext}`
      : '';

    // ---- Execution plan ----
    const textSources = attachedFiles
      .filter((f) => (f.content || '').trim().length > 0)
      .map((f) => ({ name: f.name, content: f.content }));
    const chunkThreshold = pagesPerChunk * 3000;
    const needsChunking =
      deepDocumentMode && textSources.some((s) => s.content.length > chunkThreshold);

    interface CyclePlan {
      label: string;
      iter: number;
      query: string;
      isFinalSynthesis?: boolean;
      rotationFocus?: string;
    }
    let plan: CyclePlan[] = [];
    let docPlan: DocumentChunkPlan | null = null;
    let docChunks: ReturnType<typeof chunkDocuments>['chunks'] = [];
    let documentLedger = '';

    if (needsChunking) {
      docPlan = chunkDocuments(textSources, { pagesPerChunk });
      docChunks = docPlan.chunks;
      setDocumentPlan(docPlan);
      addLog(`📚 Deep Document Mode: splitting ${textSources.length} file(s) into ${docChunks.length} review parts of ~${pagesPerChunk} pages.`);
      docPlan.messages.forEach((m) => addLog(`   ↳ ${m}`));

      plan = docChunks.map((c, i) => ({
        label: `📄 Part ${i + 1}/${docChunks.length} · ${c.sourceName} (~${c.estimatedPages} pages)`,
        iter: i + 1,
        query: `[Deep Document Mode — Part ${i + 1} of ${docChunks.length}]\nDirective: ${missionGoal}${carriedContext}\n\n[Document: ${c.sourceName} — Section ${i + 1}/${docChunks.length}, ~${c.estimatedPages} pages]\n${c.content}\n\nReview this section against the directive. Report key facts, findings, risks, decisions, and open questions. Reference specific passages.`,
      }));

      // Final cross-document synthesis pass (ledger built during the loop).
      plan.push({
        label: '🧠 Final cross-document synthesis',
        iter: plan.length + 1,
        query: '',
        isFinalSynthesis: true,
      });
    } else if (executionMode === 'mini_deliberation') {
      addLog(`⚡ Initializing Nexus Mini Deliberation (Single Consensus Pass)...`);
      plan = [
        {
          label: `⚖️ Mini Deliberation Consensus Pass`,
          iter: 1,
          query: `[Nexus Mini Deliberation Pass]:\nDirective: ${missionGoal}${attachmentContext}${carriedContext}\n\nProvide your authoritative analysis and distinct technical recommendations for consensus synthesis.`,
        },
      ];
    } else if (executionMode === 'model_rotation') {
      addLog(`🔄 Initializing Nexus Model Rotation across ${maxIterations} specialized cycles...`);
      const rotationThemes = [
        'Cycle 1: Strategic Foundations & Core Architecture',
        'Cycle 2: Operational Implementation, Code & Vulnerability Audit',
        'Cycle 3: Adversarial Stress-Test & Invariant Synthesis',
        'Cycle 4: Optimization, Performance & Scalability',
        'Cycle 5: Comprehensive Cross-Model Alignment & Verification',
        'Cycle 6: Final Hardened Blueprint & Actionable Execution',
      ];
      plan = Array.from({ length: maxIterations }, (_, i) => ({
        label: `🔄 ${rotationThemes[i % rotationThemes.length]}`,
        iter: i + 1,
        query: `[Nexus Model Rotation — ${rotationThemes[i % rotationThemes.length]}]:\nDirective: ${missionGoal}${attachmentContext}${carriedContext}\n\nLead Panelist Seat: ${activePersonas[i % activePersonas.length]?.name || 'Specialist'}.\nFocus deeply on the specific domain of this rotation cycle.`,
        rotationFocus: rotationThemes[i % rotationThemes.length],
      }));
    } else {
      addLog(`🚀 Initializing Nexus Lab Mission with ${maxIterations} autonomous cycles...`);
      plan = Array.from({ length: maxIterations }, (_, i) => ({
        label: `⚡ Cycle ${i + 1}/${maxIterations}`,
        iter: i + 1,
        query: `[Nexus Lab Cycle ${i + 1}/${maxIterations}]:\nDirective: ${missionGoal}${attachmentContext}${carriedContext}`,
      }));
    }

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

      setCurrentIteration(qi + 1);
      addLog(`${p.label}: generating proposals across active panel...`);

      const newRound: CouncilRound = {
        id: `nexus_round_${Date.now()}_${qi + 1}`,
        userQuery: cycleQuery,
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
            sessionId: activeSessionId ?? undefined,
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
        const reconsiderBlock =
          qi > 0 && previousSynthesis
            ? `\n\n[Self-Correction Pass — do NOT simply repeat the previous cycle]:\nPrevious consensus (${previousMetric?.agreementScore ?? 'unknown'}% agreement):\n${previousSynthesis.slice(0, 3500)}\n\nInstructions:\n1) Adversarially falsify the previous consensus: hunt for factual errors, unsupported claims, missing failure modes, and overconfident generalizations.\n2) Re-derive any critical claim you cannot defend from the panel's findings; if you have web tooling, prefer live verification over memory.\n3) Only change the consensus where you have substantive justification.\n4) State explicitly: what you changed versus the previous cycle and why, and list the top remaining risks/pitfalls.`
            : '';

        const synthRes = await streamPersonaWithFallback({
          persona: chairPersona,
          messages: [
            { role: 'system', content: 'You are the Presiding Nexus Chair. Synthesize decisive consensus, list immutable invariants, and calculate convergence alignment. After your synthesis append exactly one fenced JSON block with keys: agreementScore (integer 0-100), keyConsensusPoints (array), keyDisagreements (array), panelistAlignment (object of persona id -> integer 0-100).' },
            { role: 'user', content: `Synthesize ${p.label} findings:\n\n${s1Text}${reconsiderBlock}` },
          ],
          policy,
          rawModels: catalog,
          sessionId: activeSessionId ?? undefined,
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
      if (activeSessionId) {
        onCompleteRound(activeSessionId, newRound);
      }

      // Persist mission progress (truncated for storage).
      persistMission({
        id: `nexus_${Date.now()}`,
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
        updatedAt: Date.now(),
      });

      // Short delay between iterations
      await new Promise((r) => setTimeout(r, 800));
    }

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
      id: `nexus_${Date.now()}`,
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
      updatedAt: Date.now(),
    });
  };

  const handlePause = () => {
    pauseRequestedRef.current = true;
    setIsRunning(false);
    setMissionStatus('paused');
    addLog(`⏸️ Nexus Lab Mission paused.`);
  };

  const handleReset = () => {
    setIsRunning(false);
    pauseRequestedRef.current = false;
    setCurrentIteration(0);
    setRounds([]);
    setConsensusMetrics([]);
    setTerminalLogs([]);
    setAttachedFiles([]);
    setMissionStatus('idle');
    setMissionTitle('Nexus Mission');
    setFollowUpContext(null);
    setFollowUpDirective('');
    setDocumentPlan(null);
    setShowDossier(false);
    persistMission(null);
    addLog(`🔄 Nexus Lab reset to standby.`);
  };

  const handleFollowUp = () => {
    const directive = followUpDirective.trim();
    if (!directive) return;

    // Snapshot + archive the finished mission before starting the follow-up.
    const lastRound = rounds[rounds.length - 1];
    const finalSynthesis = stripJsonBlocks(lastRound?.synthesis?.content || lastRound?.deliberation?.stage3?.content || '');
    const priorConsensus = `Goal: ${missionGoal}\nFinal Consensus:\n${finalSynthesis.slice(0, 4000) || 'No synthesis recorded.'}`;

    const finishedMission: PersistedMission = {
      id: `nexus_${Date.now()}`,
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
      updatedAt: Date.now(),
    };
    pushArchive(finishedMission);

    // Carry the prior consensus forward into the new mission's context.
    setFollowUpContext(priorConsensus);
    setMissionGoal(directive);
    setFollowUpDirective('');
    setCurrentIteration(0);
    setRounds([]);
    setConsensusMetrics([]);
    setDocumentPlan(null);
    setMissionStatus('idle');
    setTerminalLogs([]);
    persistMission(null);
    addLog(`🔁 Follow-up directive set. Prior mission consensus carried forward.`);
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

  return (
    <div className="min-h-[calc(100vh-65px)] bg-slate-950 text-slate-100 p-3 sm:p-6 font-sans">
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
              Autonomous multi-agent research mesh with dynamic tool execution & convergence invariants
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
                placeholder="e.g. Perform rigorous formal verification and attack simulation on a decentralized cross-chain bridge..."
                rows={4}
                disabled={isRunning}
                className="w-full bg-slate-950 text-slate-100 text-xs sm:text-sm p-3.5 rounded-2xl border border-slate-800 focus:outline-none focus:border-emerald-500 transition-all resize-none shadow-inner leading-relaxed"
              />

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
                          ? 'Extracting context...'
                          : 'Attach Reference Files, PDFs, or Codebase ZIPs'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Drag &amp; drop or click to upload (.zip, .pdf, .ts, .py, .md, .json)
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
                      const isArchive = file.type === 'zip' || file.type === 'rar' || file.name.endsWith('.zip') || file.name.endsWith('.rar');
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
                            {isArchive && activeZipResult && (
                              <button
                                type="button"
                                onClick={() => setIsZipModalOpen(true)}
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
                  <option value="frontier_trio">🌟 Frontier Trio (Sonnet/GPT-4o/Gemini)</option>
                  <option value="deep_reasoning">🧠 Deep Reasoning (R1/Sonnet/Pro)</option>
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
                  <span>Live Web Grounding</span>
                </div>
                <input
                  type="checkbox"
                  checked={enableWebGrounding}
                  onChange={(e) => setEnableWebGrounding(e.target.checked)}
                  disabled={isRunning}
                  className="rounded text-emerald-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Code2 size={14} className="text-purple-400" />
                  <span>Sandboxed Code Verifier</span>
                </div>
                <input
                  type="checkbox"
                  checked={enableCodeSandbox}
                  onChange={(e) => setEnableCodeSandbox(e.target.checked)}
                  disabled={isRunning}
                  className="rounded text-emerald-500 focus:ring-0"
                />
              </label>

              <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
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
            </div>

            {/* Execution Buttons */}
            <div className="flex items-center gap-2 pt-3">
              {!isRunning ? (
                <button
                  type="button"
                  onClick={handlePreLaunchCheck}
                  disabled={!missionGoal.trim() && attachedFiles.length === 0}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 text-slate-950 font-bold rounded-2xl text-xs shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
                >
                  <Play size={13} className="fill-current" />
                  <span>{currentIteration > 0 ? 'Resume Cycle' : deepDocumentMode ? 'Run Deep Review' : 'Execute Nexus Lab'}</span>
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
                <span className="font-mono text-slate-300">{maxIterations} Cycles</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              This autonomous mission will orchestrate multi-model panels across {maxIterations} cycles. Confirm execution to proceed.
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
    </div>
  );
};

export { calculateEstimatedCost };
