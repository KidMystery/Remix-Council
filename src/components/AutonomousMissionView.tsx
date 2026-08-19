import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, CheckCircle, ShieldAlert, Cpu, UserCheck, Sparkles, ExternalLink, Activity, Layers, Target } from 'lucide-react';
import type { AutonomousMission, CouncilPersona, RawOpenRouterModel, CouncilRound } from '../types';
import { policyForPreset, assertPolicyModel } from '../lib/executionPolicy';
import { routeCouncilModels } from '../lib/smartModelSelector';
import { streamOpenRouter } from '../lib/openrouter';
import { saveMissionToFirestore } from '../lib/persistence';
import { MessageMarkdown } from './MessageMarkdown';

export interface AutonomousMissionViewProps {
  personas: CouncilPersona[];
  catalog: RawOpenRouterModel[];
  onCompleteRound: (sessionId: string, round: CouncilRound) => void;
  activeSessionId?: string | null;
  isStandaloneWindow?: boolean;
}

export const AutonomousMissionView: React.FC<AutonomousMissionViewProps> = ({
  personas,
  catalog,
  onCompleteRound,
  activeSessionId,
  isStandaloneWindow = false,
}) => {
  const [mission, setMission] = useState<AutonomousMission>({
    id: `mission_${Date.now()}`,
    goal: '',
    presetId: 'fast_and_free',
    policyBudget: 'free',
    rotatingChair: true,
    maxIterations: 3,
    currentIteration: 0,
    status: 'idle',
    rounds: [],
    chairHistory: [],
  });

  const [isRunning, setIsRunning] = useState(false);
  const pauseRequestedRef = useRef(false);

  // Firestore Sync
  useEffect(() => {
    if (mission.rounds.length > 0 || mission.goal.trim()) {
      saveMissionToFirestore(mission).catch((err) => {
        console.error('[AutonomousMission] Cloud save error:', err);
      });
    }
  }, [mission]);

  const runMissionStep = async () => {
    if (pauseRequestedRef.current || mission.currentIteration >= mission.maxIterations) {
      setIsRunning(false);
      setMission((prev) => ({
        ...prev,
        status: prev.currentIteration >= prev.maxIterations ? 'max_reached' : 'paused',
      }));
      return;
    }

    const policy = policyForPreset(mission.presetId);
    const activePersonas = routeCouncilModels(
      personas.filter((p) => p.enabled !== false),
      policy,
      catalog,
      mission.goal
    );

    const chairIdx = mission.rotatingChair
      ? mission.currentIteration % activePersonas.length
      : 0;
    const chair = activePersonas[chairIdx] || activePersonas[0];

    const currentIterationNum = mission.currentIteration + 1;
    const iterationQuery = `Autonomous Research Directive [Iteration ${currentIterationNum}/${mission.maxIterations}]:\nObjective: ${mission.goal}\nPresiding Chair: ${chair.name} (${chair.role})`;

    const newRound: CouncilRound = {
      id: `auto_round_${Date.now()}`,
      userQuery: iterationQuery,
      createdAt: Date.now(),
      mode: 'autonomous',
      deliberation: {
        stage1: {},
        stage2: {},
      },
    };

    // Stage 1 Proposals
    const s1Promises = activePersonas.map(async (p) => {
      try {
        const res = await streamOpenRouter({
          model: p.model,
          messages: [
            { role: 'system', content: p.systemPrompt },
            { role: 'user', content: iterationQuery },
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
      } catch (err: any) {
        newRound.deliberation.stage1[p.id] = {
          personaId: p.id,
          model: p.model,
          content: `[Error: ${err.message}]`,
          status: 'error',
          error: err.message,
        };
      }
    });

    await Promise.allSettled(s1Promises);

    // Stage 3 Synthesis by Chair
    const s1Text = Object.entries(newRound.deliberation.stage1)
      .map(([id, r]) => `Proposal (${id}):\n${r.content}`)
      .join('\n\n');

    try {
      const synthRes = await streamOpenRouter({
        model: chair.model,
        messages: [
          { role: 'system', content: chair.systemPrompt },
          {
            role: 'user',
            content: `You are the Presiding Council Chair for Iteration ${currentIterationNum}. Synthesize consensus, determine if objective is fully met, and specify architectural invariants:\n\n${s1Text}`,
          },
        ],
        budget: policy.budget,
        maxTokens: policy.maxOutputTokens,
      });

      newRound.deliberation.stage3 = {
        model: chair.model,
        chairPersonaId: chair.id,
        content: synthRes.content,
        status: 'completed',
      };
    } catch (err: any) {
      newRound.deliberation.stage3 = {
        model: chair.model,
        chairPersonaId: chair.id,
        content: `[Synthesis Error: ${err.message}]`,
        status: 'error',
        error: err.message,
      };
    }

    if (activeSessionId) {
      onCompleteRound(activeSessionId, newRound);
    }

    setMission((prev) => {
      const isComplete = currentIterationNum >= prev.maxIterations;
      return {
        ...prev,
        currentIteration: currentIterationNum,
        rounds: [...prev.rounds, newRound],
        chairHistory: [
          ...prev.chairHistory,
          { roundIndex: currentIterationNum, personaId: chair.id, personaName: chair.name },
        ],
        status: isComplete ? 'max_reached' : 'running',
      };
    });

    if (currentIterationNum < mission.maxIterations && !pauseRequestedRef.current) {
      setTimeout(() => {
        runMissionStep();
      }, 1500);
    } else {
      setIsRunning(false);
    }
  };

  const handleStartMission = async () => {
    if (!mission.goal.trim()) return;
    pauseRequestedRef.current = false;
    setIsRunning(true);
    setMission((prev) => ({ ...prev, status: 'running' }));
    await runMissionStep();
  };

  const handlePauseMission = () => {
    pauseRequestedRef.current = true;
    setIsRunning(false);
    setMission((prev) => ({ ...prev, status: 'paused' }));
  };

  const handleResetMission = () => {
    setIsRunning(false);
    pauseRequestedRef.current = false;
    setMission({
      id: `mission_${Date.now()}`,
      goal: '',
      presetId: 'fast_and_free',
      policyBudget: 'free',
      rotatingChair: true,
      maxIterations: 3,
      currentIteration: 0,
      status: 'idle',
      rounds: [],
      chairHistory: [],
    });
  };

  return (
    <div className={`max-w-6xl mx-auto p-3 sm:p-6 space-y-6 ${isStandaloneWindow ? 'min-h-screen bg-slate-950 text-slate-100' : ''}`}>
      {/* Top Operations Telemetry Hub */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-slate-900/90 border border-purple-500/40 rounded-2xl flex items-center gap-3 shadow-lg">
          <div className="p-2.5 bg-purple-950 rounded-xl border border-purple-800 text-purple-400">
            <Cpu size={20} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Status</div>
            <div className="text-sm font-bold capitalize text-purple-200">{mission.status}</div>
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl flex items-center gap-3 shadow-lg">
          <div className="p-2.5 bg-cyan-950 rounded-xl border border-cyan-800 text-cyan-400">
            <Activity size={20} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Progress</div>
            <div className="text-sm font-bold text-slate-100">{mission.currentIteration} / {mission.maxIterations} Rounds</div>
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl flex items-center gap-3 shadow-lg">
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-400">
            <Layers size={20} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Policy Mode</div>
            <div className="text-sm font-bold text-slate-200 capitalize">{mission.presetId.replace('_', ' ')}</div>
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl flex items-center gap-3 shadow-lg">
          <div className="p-2.5 bg-emerald-950 rounded-xl border border-emerald-800 text-emerald-400">
            <Target size={20} />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Active Chair</div>
            <div className="text-sm font-bold text-emerald-200 truncate max-w-[120px]">
              {mission.chairHistory[mission.chairHistory.length - 1]?.personaName || 'Rotating'}
            </div>
          </div>
        </div>
      </div>

      {/* Autonomous Directive Configurator */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 mb-4 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2 text-purple-400">
            <Sparkles size={20} />
            <h2 className="text-sm sm:text-base font-bold text-slate-100">Autonomous Council Operations Room</h2>
          </div>
          <span className="text-[11px] font-mono text-purple-300 bg-purple-950/80 px-2.5 py-1 rounded-lg border border-purple-800">
            Phase 6 Autonomous
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              High-Level Autonomous Objective
            </label>
            <textarea
              value={mission.goal}
              onChange={(e) => setMission((prev) => ({ ...prev, goal: e.target.value }))}
              placeholder="e.g. Design a complete, hardened tokenomics and smart contract security model with mathematical invariant proofs..."
              rows={3}
              disabled={isRunning}
              className="w-full bg-slate-950 text-slate-100 text-sm p-3.5 rounded-xl border border-slate-800 focus:outline-none focus:border-purple-500 transition-all resize-none shadow-inner"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Preset Budget Policy</label>
              <select
                value={mission.presetId}
                onChange={(e) =>
                  setMission((prev) => ({
                    ...prev,
                    presetId: e.target.value,
                    policyBudget: e.target.value === 'fast_and_free' ? 'free' : 'quality',
                  }))
                }
                disabled={isRunning}
                className="w-full bg-slate-950 text-slate-200 text-xs p-2.5 rounded-lg border border-slate-800"
              >
                <option value="fast_and_free">Fast & Free (Zero Cost)</option>
                <option value="deep_council">Deep Council (Frontier Reasoning)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Convergence Max Iterations</label>
              <input
                type="number"
                min={1}
                max={10}
                value={mission.maxIterations}
                onChange={(e) => setMission((prev) => ({ ...prev, maxIterations: parseInt(e.target.value) || 1 }))}
                disabled={isRunning}
                className="w-full bg-slate-950 text-slate-200 text-xs p-2.5 rounded-lg border border-slate-800"
              />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                id="rotatingChair"
                checked={mission.rotatingChair}
                onChange={(e) => setMission((prev) => ({ ...prev, rotatingChair: e.target.checked }))}
                disabled={isRunning}
                className="rounded border-slate-800 text-purple-600 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="rotatingChair" className="text-xs text-slate-300 cursor-pointer">
                Rotate Presiding Chair Per Iteration
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-3">
            {!isRunning ? (
              <button
                onClick={handleStartMission}
                disabled={!mission.goal.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-lg transition-all cursor-pointer"
              >
                <Play size={13} className="fill-current" />
                <span>{mission.currentIteration > 0 ? 'Resume Autonomous Mission' : 'Execute Autonomous Mission'}</span>
              </button>
            ) : (
              <button
                onClick={handlePauseMission}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs shadow-lg transition-all cursor-pointer"
              >
                <Pause size={13} className="fill-current" />
                <span>Pause Mission</span>
              </button>
            )}

            <button
              onClick={handleResetMission}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs border border-slate-700 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Autonomous Iteration Rounds Ledger */}
      {mission.rounds.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
            <span>Deliberation Convergence Ledger</span>
            <span className="text-xs font-mono font-normal text-purple-400 bg-purple-950/80 px-2 py-0.5 rounded-full border border-purple-800">
              {mission.rounds.length} Iterations
            </span>
          </h3>
          {mission.rounds.map((r, idx) => (
            <article key={r.id} className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 text-xs">
                <span className="font-bold text-purple-400 flex items-center gap-1.5">
                  <CheckCircle size={14} />
                  <span>Iteration {idx + 1} Consensus Verdict</span>
                </span>
                <span className="text-slate-400 font-mono text-[11px] bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                  Presiding Chair: {mission.chairHistory[idx]?.personaName || 'Default'}
                </span>
              </div>
              {r.deliberation?.stage3?.content && (
                <MessageMarkdown content={r.deliberation.stage3.content} />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
