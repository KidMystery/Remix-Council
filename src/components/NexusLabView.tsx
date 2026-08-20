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
import { streamPersonaWithFallback } from '../lib/fallbackManager';
import { extractCodeFromArchive } from '../lib/zipReader';
import { extractTextFromPDF } from '../lib/pdfUtils';
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

const MISSIONS_STORAGE_KEY = 'nexus-missions-v1';
const MAX_STORED_CONTENT_CHARS = 5000;

interface PersistedMission {
  id: string;
  goal: string;
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
  const [maxIterations, setMaxIterations] = useState(3);
  const [activePreset, setActivePreset] = useState<'fast_and_free' | 'deep_council'>('fast_and_free');
  const [enableWebGrounding, setEnableWebGrounding] = useState(true);
  const [enableCodeSandbox, setEnableCodeSandbox] = useState(true);

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
  const [showCostApprovalModal, setShowCostApprovalModal] = useState(false);
  const [estimatedMissionCost, setEstimatedMissionCost] = useState(0);
  const [showDossier, setShowDossier] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const pauseRequestedRef = useRef(false);

  // Restore the last persisted mission on mount.
  useEffect(() => {
    const persisted = loadPersistedMission();
    if (persisted) {
      setMissionGoal(persisted.goal);
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
    const isFree = activePreset === 'fast_and_free';
    const activePersonas = personas.filter((p) => p.enabled !== false);
    return calculateEstimatedCost(activePersonas, catalog, maxIterations, isFree);
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
    addLog(`🚀 Initializing Nexus Lab Mission with ${maxIterations} autonomous cycles...`);

    const policy: ExecutionPolicy = policyForPreset(activePreset);
    const activePersonas = personas.filter((p) => p.enabled !== false);

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

    let iter = currentIteration;
    while (iter < maxIterations && !pauseRequestedRef.current) {
      iter++;
      setCurrentIteration(iter);
      addLog(`⚡ Cycle ${iter}/${maxIterations}: Selecting presiding chair and generating parallel proposals...`);

      const chair = activePersonas[(iter - 1) % activePersonas.length] || activePersonas[0];
      const cycleQuery = `[Nexus Lab Cycle ${iter}/${maxIterations}]:\nDirective: ${missionGoal}${attachmentContext}\nPresiding Chair: ${chair.name}`;

      const newRound: CouncilRound = {
        id: `nexus_round_${Date.now()}_${iter}`,
        userQuery: cycleQuery,
        timestamp: Date.now(),
        mode: 'nexus_lab',
        attachedTextFiles: [...attachedFiles],
        deliberation: { stage1: {}, stage2: {} },
        synthesis: { content: '', status: 'idle' },
      };

      // Stage 1: Proposals (via policy-compliant fallback streaming)
      const s1Promises = activePersonas.map(async (p) => {
        addLog(`• Model [${p.name} - ${p.model.split('/').pop()}] analyzing objective...`);
        try {
          const res = await streamPersonaWithFallback({
            persona: p,
            messages: [
              { role: 'system', content: p.systemPrompt },
              { role: 'user', content: cycleQuery },
            ],
            policy,
            rawModels: catalog,
            sessionId: activeSessionId ?? undefined,
          });
          newRound.deliberation.stage1[p.id] = {
            personaId: p.id,
            model: p.model,
            actualModel: res.actualModel,
            content: res.content,
            status: 'completed',
            finishReason: res.finishReason,
          };
        } catch (e: any) {
          newRound.deliberation.stage1[p.id] = {
            personaId: p.id,
            model: p.model,
            content: `[Error: ${e.message}]`,
            status: 'error',
            error: e.message,
          };
        }
      });

      await Promise.allSettled(s1Promises);
      addLog(`✓ Cycle ${iter} proposals generated. Chair [${chair.name}] synthesizing consensus...`);

      // Stage 3 Synthesis & Convergence
      const s1Text = Object.entries(newRound.deliberation.stage1)
        .map(([id, r]) => `Persona (${id}):\n${r.content}`)
        .join('\n\n');

      try {
        const chairPersona: Persona = {
          ...(chair || synthesizer),
          id: chair?.id || 'synthesizer',
          name: chair?.name || synthesizer.name || 'Presiding Nexus Chair',
          role: chair?.role || synthesizer.role || 'Chair',
        };

        const synthRes = await streamPersonaWithFallback({
          persona: chairPersona,
          messages: [
            { role: 'system', content: 'You are the Presiding Nexus Chair. Synthesize decisive consensus, list immutable invariants, and calculate convergence alignment. After your synthesis append exactly one fenced JSON block with keys: agreementScore (integer 0-100), keyConsensusPoints (array), keyDisagreements (array), panelistAlignment (object of persona id -> integer 0-100).' },
            { role: 'user', content: `Synthesize Cycle ${iter} findings:\n\n${s1Text}` },
          ],
          policy,
          rawModels: catalog,
          sessionId: activeSessionId ?? undefined,
        });

        // Real consensus parser from the Chair output.
        let synthesis = synthRes.content;
        const jsonMatch = synthesis.match(/```json\s*([\s\S]*?)```/);
        let consensusMetric: ConsensusMetric = {
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
          iterationDelta: iter > 1 && consensusMetrics.length > 0 ? consensusMetric.agreementScore - (consensusMetrics[consensusMetrics.length - 1]?.agreementScore || consensusMetric.agreementScore) : undefined,
        };

        newRound.deliberation.stage3 = {
          model: synthRes.actualModel || chair.model,
          chairPersonaId: chair?.id,
          content: synthesis,
          consensusMetric,
          status: 'completed',
          finishReason: synthRes.finishReason,
        };
        newRound.synthesis = {
          model: synthRes.actualModel || chair.model,
          chairPersonaId: chair?.id,
          content: synthesis,
          consensusMetric,
          status: 'completed',
          finishReason: synthRes.finishReason,
        };

        accumulatedMetrics = [...accumulatedMetrics, consensusMetric];
        setConsensusMetrics(accumulatedMetrics);
        addLog(`✨ Cycle ${iter} Consensus reached with ${consensusMetric.agreementScore}% alignment score.`);
      } catch (err: any) {
        addLog(`❌ Chair synthesis error: ${err.message}`);
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
        presetId: activePreset,
        maxIterations,
        currentIteration: iter,
        status: 'running',
        rounds: accumulatedRounds,
        consensusMetrics: accumulatedMetrics,
        estimatedCost: getEstimatedCost(),
        attachedFiles,
        updatedAt: Date.now(),
      });

      // Short delay between iterations
      await new Promise((r) => setTimeout(r, 1200));
    }

    const finalMetrics = accumulatedMetrics;
    const lastScore = finalMetrics.length > 0 ? finalMetrics[finalMetrics.length - 1].agreementScore : 50;
    const finalStatus: PersistedMission['status'] = lastScore >= 85 ? 'converged' : 'max_reached';

    setIsRunning(false);
    setMissionStatus(finalStatus);
    addLog(`🏁 Nexus Lab Mission finalized (${lastScore >= 85 ? 'CONVERGED' : 'MAX ITERATIONS REACHED'}).`);

    persistMission({
      id: `nexus_${Date.now()}`,
      goal: missionGoal,
      presetId: activePreset,
      maxIterations,
      currentIteration: iter,
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
    setShowDossier(false);
    persistMission(null);
    addLog(`🔄 Nexus Lab reset to standby.`);
  };

  const canExport = missionStatus === 'converged' || missionStatus === 'max_reached';

  const buildDossierMarkdown = (): string => {
    const lines: string[] = [];
    lines.push(`# Council Mission Dossier`);
    lines.push('');
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
        <div className="flex items-center gap-2">
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

            {/* Iterations and Preset */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Preset Engine</label>
                <select
                  value={activePreset}
                  onChange={(e) => setActivePreset(e.target.value as any)}
                  disabled={isRunning}
                  className="w-full bg-slate-950 text-slate-200 text-xs p-2.5 rounded-xl border border-slate-800"
                >
                  <option value="fast_and_free">Fast & Free</option>
                  <option value="deep_council">Deep Frontier</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Cycles</label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(parseInt(e.target.value) || 1)}
                  disabled={isRunning}
                  className="w-full bg-slate-950 text-slate-200 text-xs p-2.5 rounded-xl border border-slate-800 font-mono"
                />
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
            </div>

            {/* Execution Buttons */}
            <div className="flex items-center gap-2 pt-3">
              {!isRunning ? (
                <button
                  type="button"
                  onClick={handlePreLaunchCheck}
                  disabled={!missionGoal.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 text-slate-950 font-bold rounded-2xl text-xs shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
                >
                  <Play size={13} className="fill-current" />
                  <span>{currentIteration > 0 ? 'Resume Cycle' : 'Execute Nexus Lab'}</span>
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
          </div>
        </div>

        {/* Center & Right Column: Terminal & Consensus Ledger (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {/* Real-Time Convergence Telemetry Gauge */}
          {latestMetric && (
            <ConsensusVisualizer metric={latestMetric} personas={personas} roundIndex={currentIteration} />
          )}

          {/* Live Execution Terminal */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-emerald-400 font-mono">
                <Terminal size={14} />
                <span>NEXUS-RUNTIME-TELEMETRY</span>
              </div>
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>

            <div className="bg-slate-950 rounded-2xl p-3.5 font-mono text-[11px] text-emerald-300/90 max-h-48 overflow-y-auto space-y-1">
              {terminalLogs.length === 0 ? (
                <div className="text-slate-600 italic">Ready for autonomous execution...</div>
              ) : (
                terminalLogs.map((log, i) => <div key={i}>{log}</div>)
              )}
            </div>
          </div>

          {/* Iteration Findings Feed */}
          {rounds.length > 0 && (
            <div className="space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Layers size={14} className="text-emerald-400" />
                <span>Synthesized Convergence Verdicts</span>
              </div>

              {rounds.map((r, idx) => (
                <div key={r.id} className="p-5 bg-slate-900/90 border border-slate-800 rounded-3xl shadow-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 text-xs">
                    <span className="font-bold text-emerald-400">Cycle {idx + 1} Consensus</span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      {new Date(r.timestamp || r.createdAt || Date.now()).toLocaleTimeString()}
                    </span>
                  </div>
                  {r.deliberation?.stage3?.content && (
                    <MessageMarkdown content={r.deliberation.stage3.content} />
                  )}
                </div>
              ))}
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
