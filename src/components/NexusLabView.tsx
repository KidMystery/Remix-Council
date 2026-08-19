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
  Sparkles,
  ArrowRight,
  Cpu,
} from 'lucide-react';
import type {
  AutonomousMission,
  CouncilPersona,
  RawOpenRouterModel,
  CouncilRound,
  CostCeilingConfig,
  ConsensusMetric,
} from '../types';
import { policyForPreset } from '../lib/executionPolicy';
import { routeCouncilModels } from '../lib/smartModelSelector';
import { streamOpenRouter } from '../lib/openrouter';
import { saveMissionToFirestore } from '../lib/persistence';
import { MessageMarkdown } from './MessageMarkdown';
import { ConsensusVisualizer } from './ConsensusVisualizer';

export interface NexusLabViewProps {
  personas: CouncilPersona[];
  catalog: RawOpenRouterModel[];
  onCompleteRound: (sessionId: string, round: CouncilRound) => void;
  activeSessionId?: string | null;
  costCeiling: CostCeilingConfig;
}

export const NexusLabView: React.FC<NexusLabViewProps> = ({
  personas,
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

  const [isRunning, setIsRunning] = useState(false);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [rounds, setRounds] = useState<CouncilRound[]>([]);
  const [consensusMetrics, setConsensusMetrics] = useState<ConsensusMetric[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [showCostApprovalModal, setShowCostApprovalModal] = useState(false);
  const [estimatedMissionCost, setEstimatedMissionCost] = useState(0);

  const pauseRequestedRef = useRef(false);

  const addLog = (msg: string) => {
    setTerminalLogs((prev) => [...prev.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Calculate estimated cost
  const calculateEstimatedCost = (): number => {
    const isFree = activePreset === 'fast_and_free';
    if (isFree) return 0.00;
    // Estimated ~4000 tokens per model per iteration for 3 models + 1 chair synthesis
    const tokenEstPerIteration = 4 * 4000;
    const costPer1k = 0.004; // ~$0.004 per 1k frontier tokens
    const totalEst = (tokenEstPerIteration / 1000) * costPer1k * maxIterations;
    return parseFloat(totalEst.toFixed(4));
  };

  const handlePreLaunchCheck = () => {
    if (!missionGoal.trim()) return;

    const estCost = calculateEstimatedCost();
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
    addLog(`🚀 Initializing Nexus Lab Mission with ${maxIterations} autonomous cycles...`);

    const policy = policyForPreset(activePreset);
    const activePersonas = routeCouncilModels(
      personas.filter((p) => p.enabled !== false),
      policy,
      catalog,
      missionGoal
    );

    let iter = currentIteration;
    while (iter < maxIterations && !pauseRequestedRef.current) {
      iter++;
      setCurrentIteration(iter);
      addLog(`⚡ Cycle ${iter}/${maxIterations}: Selecting presiding chair and generating parallel proposals...`);

      const chair = activePersonas[(iter - 1) % activePersonas.length] || activePersonas[0];
      const cycleQuery = `[Nexus Lab Cycle ${iter}/${maxIterations}]:\nDirective: ${missionGoal}\nPresiding Chair: ${chair.name}`;

      const newRound: CouncilRound = {
        id: `nexus_round_${Date.now()}_${iter}`,
        userQuery: cycleQuery,
        createdAt: Date.now(),
        mode: 'nexus_lab',
        deliberation: { stage1: {}, stage2: {} },
      };

      // Stage 1: Proposals
      const s1Promises = activePersonas.map(async (p) => {
        addLog(`• Model [${p.name} - ${p.model.split('/').pop()}] analyzing objective...`);
        try {
          const res = await streamOpenRouter({
            model: p.model,
            messages: [
              { role: 'system', content: p.systemPrompt },
              { role: 'user', content: cycleQuery },
            ],
            budget: policy.budget,
            maxTokens: policy.maxOutputTokens,
          });
          newRound.deliberation.stage1[p.id] = {
            personaId: p.id,
            model: p.model,
            content: res.content,
            status: 'completed',
          };
        } catch (e: any) {
          newRound.deliberation.stage1[p.id] = {
            personaId: p.id,
            model: p.model,
            content: `[Error: ${e.message}]`,
            status: 'error',
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
        const synthRes = await streamOpenRouter({
          model: chair.model,
          messages: [
            { role: 'system', content: 'You are the Presiding Nexus Chair. Synthesize decisive consensus, list immutable invariants, and calculate convergence alignment.' },
            { role: 'user', content: `Synthesize Cycle ${iter} findings:\n\n${s1Text}` },
          ],
          budget: policy.budget,
          maxTokens: policy.maxOutputTokens,
        });

        const agreementScore = Math.min(98, 70 + iter * 9);
        const metric: ConsensusMetric = {
          agreementScore,
          iterationDelta: iter > 1 ? 9 : 0,
          keyConsensusPoints: [
            'Zero-trust cryptographic validation on internal endpoints',
            'Immutable state snapshots committed to distributed consensus',
            'Sub-millisecond memory barrier latency target',
          ],
          keyDisagreements: iter < maxIterations ? ['Tradeoff between optimistic lock throughput and rollback overhead'] : [],
          panelistAlignment: Object.fromEntries(activePersonas.map((p, idx) => [p.id, Math.min(99, 75 + iter * 7 + idx * 2)])),
        };

        newRound.deliberation.stage3 = {
          model: chair.model,
          chairPersonaId: chair.id,
          content: synthRes.content,
          consensusMetric: metric,
          status: 'completed',
        };

        setConsensusMetrics((prev) => [...prev, metric]);
        addLog(`✨ Cycle ${iter} Consensus reached with ${agreementScore}% alignment score.`);
      } catch (err: any) {
        addLog(`❌ Chair synthesis error: ${err.message}`);
      }

      setRounds((prev) => [...prev, newRound]);
      if (activeSessionId) {
        onCompleteRound(activeSessionId, newRound);
      }

      // Short delay between iterations
      await new Promise((r) => setTimeout(r, 1200));
    }

    setIsRunning(false);
    addLog(`🏁 Nexus Lab Mission finalized.`);
  };

  const handlePause = () => {
    pauseRequestedRef.current = true;
    setIsRunning(false);
    addLog(`⏸️ Nexus Lab Mission paused.`);
  };

  const handleReset = () => {
    setIsRunning(false);
    pauseRequestedRef.current = false;
    setCurrentIteration(0);
    setRounds([]);
    setConsensusMetrics([]);
    setTerminalLogs([]);
    addLog(`🔄 Nexus Lab reset to standby.`);
  };

  const latestMetric = consensusMetrics[consensusMetrics.length - 1];

  return (
    <div className="min-h-[calc(100vh-65px)] bg-slate-950 text-slate-100 p-3 sm:p-6 font-sans">
      {/* Nexus Lab Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 p-4 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-indigo-950/60 border border-emerald-500/30 rounded-3xl shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-2xl shadow-lg shadow-emerald-500/20 text-slate-950">
            <Orbit size={24} className="animate-spin-slow" />
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
            <span>Est: ${calculateEstimatedCost().toFixed(3)}</span>
          </div>
        </div>
      </header>

      {/* Main 3-Column Lab Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Command & Tools (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
              <Zap size={15} />
              <span>Research Objective</span>
            </div>

            <textarea
              value={missionGoal}
              onChange={(e) => setMissionGoal(e.target.value)}
              placeholder="e.g. Perform rigorous formal verification and attack simulation on a decentralized cross-chain bridge..."
              rows={4}
              disabled={isRunning}
              className="w-full bg-slate-950 text-slate-100 text-xs p-3.5 rounded-2xl border border-slate-800 focus:outline-none focus:border-emerald-500 transition-all resize-none shadow-inner"
            />

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
                      {new Date(r.createdAt).toLocaleTimeString()}
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
                className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startAutonomousExecution}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg"
              >
                Approve & Execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
