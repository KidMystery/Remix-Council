import React, { useState, useEffect, useRef } from 'react';
import { Play, RotateCcw, AlertTriangle, ShieldCheck, GitBranch, Sparkles } from 'lucide-react';
import type { CouncilPersona, CouncilRound, AttachedFile } from '../types';
import { policyForPreset, assertPolicyModel } from '../lib/executionPolicy';
import { streamOpenRouter } from '../lib/openrouter';
import { fallbackManager } from '../lib/fallbackManager';
import { handleAuthRedirectResult } from '../lib/persistence';
import { routeCouncilModels } from '../lib/smartModelSelector';
import { compressSessionContext } from '../lib/contextCompressor';
import { CouncilRoundView } from './CouncilRoundView';
import { Composer } from './Composer';

export interface CouncilChamberProps {
  personas: CouncilPersona[];
  activePresetId?: string;
  rounds: CouncilRound[];
  activeSessionId?: string | null;
  onUpdateRound: (sessionId: string, round: CouncilRound) => void;
  onCompleteRound: (sessionId: string, round: CouncilRound) => void;
}

export function buildFullQueryWithAttachments(round: CouncilRound, contextSummary?: string): string {
  let q = round.userQuery || '';
  if (contextSummary) {
    q = `[Prior Council Consensus Memory]:\n${contextSummary}\n\n[Active Topic Query]:\n${q}`;
  }
  if (round.attachedTextFiles && round.attachedTextFiles.length > 0) {
    const fileText = round.attachedTextFiles
      .map((f) => `--- Attached File: ${f.name} ---\n${f.content}`)
      .join('\n\n');
    q = q.includes('Review attached file context')
      ? fileText
      : `${q}\n\n${fileText}`;
  }
  return q;
}

export function getRoundIncompleteStage(
  round: CouncilRound,
  personas: CouncilPersona[]
): { isIncomplete: boolean; description: string } {
  const active = personas.filter((p) => p.enabled !== false);
  const stage1 = round.deliberation?.stage1 || {};
  const stage2 = round.deliberation?.stage2 || {};
  const stage3 = round.deliberation?.stage3;

  const incompleteS1 = active.some(
    (p) => !stage1[p.id] || stage1[p.id].status !== 'completed'
  );
  if (incompleteS1) {
    return { isIncomplete: true, description: 'Stage 1 (Proposals)' };
  }

  if (!round.isQuickPanel && active.length > 1) {
    const incompleteS2 = active.some(
      (p) => !stage2[p.id] || stage2[p.id].status !== 'completed'
    );
    if (incompleteS2) {
      return { isIncomplete: true, description: 'Stage 2 (Peer Review)' };
    }
  }

  if (!stage3 || stage3.status !== 'completed') {
    return { isIncomplete: true, description: 'Stage 3 (Synthesis)' };
  }

  return { isIncomplete: false, description: 'Complete' };
}

export const CouncilChamber: React.FC<CouncilChamberProps> = ({
  personas,
  activePresetId = 'deep_council',
  rounds,
  activeSessionId,
  onUpdateRound,
  onCompleteRound,
}) => {
  const [isDeliberating, setIsDeliberating] = useState(false);
  const [basicMode, setBasicMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Concurrency Lock Reference
  const deliberationLockRef = useRef(false);

  const acquireDeliberationLock = (): boolean => {
    if (deliberationLockRef.current) return false;
    deliberationLockRef.current = true;
    setIsDeliberating(true);
    return true;
  };

  const releaseDeliberationLock = () => {
    deliberationLockRef.current = false;
    setIsDeliberating(false);
  };

  // Auth redirect verification on mount
  useEffect(() => {
    handleAuthRedirectResult().catch((err) => {
      setAuthError(err.message || 'Firebase login redirect failed');
    });
  }, []);

  const policy = policyForPreset(activePresetId);

  // Deliberation engine with context compression
  const runRoundExecution = async (roundToRun: CouncilRound) => {
    if (!activeSessionId) return;

    let contextSummary = '';
    if (rounds.length >= 3) {
      try {
        contextSummary = await compressSessionContext(rounds);
      } catch {
        // Fallback gracefully without context summary
      }
    }

    const fullQuery = buildFullQueryWithAttachments(roundToRun, contextSummary);
    const activePersonas = routeCouncilModels(personas.filter((p) => p.enabled !== false), policy, [], fullQuery);
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    let currentRoundState = { ...roundToRun };

    // Stage 1: Parallel proposals
    const s1Promises = activePersonas.map(async (persona) => {
      assertPolicyModel(persona.model, policy);

      let accumulated = '';
      try {
        const res = await fallbackManager.executeWithFallback(
          persona.model,
          policy,
          [],
          async (targetModel) => {
            return await streamOpenRouter({
              model: targetModel,
              messages: [
                { role: 'system', content: persona.systemPrompt },
                { role: 'user', content: fullQuery },
              ],
              budget: policy.budget,
              maxTokens: policy.maxOutputTokens,
              onToken: (chunk) => {
                accumulated += chunk;
              },
            });
          },
          activeSessionId
        );

        currentRoundState.deliberation.stage1[persona.id] = {
          personaId: persona.id,
          model: persona.model,
          content: res.content || accumulated,
          status: 'completed',
        };
      } catch (err: any) {
        currentRoundState.deliberation.stage1[persona.id] = {
          personaId: persona.id,
          model: persona.model,
          content: `[Deliberation Error: ${err.message}]`,
          status: 'error',
          error: err.message,
        };
      }
    });

    await Promise.allSettled(s1Promises);
    onUpdateRound(activeSessionId, { ...currentRoundState });

    // Quick Panel skips Stage 2 and proceeds straight to Stage 3 synthesis
    if (roundToRun.isQuickPanel || activePersonas.length <= 1) {
      await runQuickPanelSynthesis(currentRoundState, activePersonas);
      return;
    }

    // Stage 2: Peer Review & Critique
    const s1Outputs = currentRoundState.deliberation.stage1;
    const s2Promises = activePersonas.map(async (persona, idx) => {
      assertPolicyModel(persona.model, policy);

      const myLetter = letters[idx] || `P${idx + 1}`;
      let letterIdx = 0;
      const peerProposals = activePersonas
        .map((p) => {
          if (p.id === persona.id) return null;
          const resp = s1Outputs[p.id];
          const letter = letters[letterIdx++] || `P${letterIdx}`;
          return `### Panelist ${letter} (${p.role}):\n${resp?.content || '[No proposal]'}`;
        })
        .filter(Boolean)
        .join('\n\n');

      const stage2Prompt = `You are Panelist ${myLetter}. Critically evaluate your peers' proposals.

Original User Query:
${fullQuery}

Peer Proposals:
${peerProposals}

Please provide your rigorous critique, cross-examination, points of consensus, and key disagreements.
If the user question contains code, documents, or attachments, treat them as available and refer to the relevant sections directly.`;

      let accumulated = '';
      try {
        const res = await fallbackManager.executeWithFallback(
          persona.model,
          policy,
          [],
          async (targetModel) => {
            return await streamOpenRouter({
              model: targetModel,
              messages: [
                { role: 'system', content: persona.systemPrompt },
                { role: 'user', content: stage2Prompt },
              ],
              budget: policy.budget,
              maxTokens: policy.maxOutputTokens,
              onToken: (chunk) => {
                accumulated += chunk;
              },
            });
          },
          activeSessionId
        );

        currentRoundState.deliberation.stage2[persona.id] = {
          reviewerId: persona.id,
          model: persona.model,
          content: res.content || accumulated,
          status: 'completed',
        };
      } catch (err: any) {
        currentRoundState.deliberation.stage2[persona.id] = {
          reviewerId: persona.id,
          model: persona.model,
          content: `[Peer Review Error: ${err.message}]`,
          status: 'error',
          error: err.message,
        };
      }
    });

    await Promise.allSettled(s2Promises);
    onUpdateRound(activeSessionId, { ...currentRoundState });

    // Stage 3: Authoritative Executive Synthesis
    await runQuickPanelSynthesis(currentRoundState, activePersonas);
  };

  const runQuickPanelSynthesis = async (roundToSynthesize: CouncilRound, activePersonas: CouncilPersona[]) => {
    if (!activeSessionId) return;

    const synthesisModel = activePersonas[0]?.model || 'anthropic/claude-3.7-sonnet';
    assertPolicyModel(synthesisModel, policy);

    const s1Text = Object.entries(roundToSynthesize.deliberation.stage1)
      .map(([id, r]) => `Proposal (${id}):\n${r.content}`)
      .join('\n\n');

    const s2Text = Object.entries(roundToSynthesize.deliberation.stage2)
      .map(([id, r]) => `Peer Review (${id}):\n${r.content}`)
      .join('\n\n');

    const synthPrompt = `Synthesize an authoritative, executive consensus from this deliberation:

Topic:
${roundToSynthesize.userQuery}

Stage 1 Proposals:
${s1Text}

Stage 2 Critiques:
${s2Text}

Deliver a final synthesis with structured Verdict, Consensus Invariants, Critical Disagreements, and Immediate Next Action Steps.`;

    try {
      const res = await streamOpenRouter({
        model: synthesisModel,
        messages: [
          { role: 'system', content: 'You are the Council Chair presiding over executive consensus.' },
          { role: 'user', content: synthPrompt },
        ],
        budget: policy.budget,
        maxTokens: policy.maxOutputTokens,
      });

      roundToSynthesize.deliberation.stage3 = {
        model: synthesisModel,
        content: res.content,
        status: 'completed',
      };
    } catch (err: any) {
      roundToSynthesize.deliberation.stage3 = {
        model: synthesisModel,
        content: `[Synthesis Error: ${err.message}]`,
        status: 'error',
        error: err.message,
      };
    }

    // Cloud push of completed round
    onCompleteRound(activeSessionId, roundToSynthesize);
  };

  const handleDeliberate = async (query: string, attachedFiles: AttachedFile[], isFollowUp: boolean) => {
    if (!acquireDeliberationLock()) return;

    try {
      const newRound: CouncilRound = {
        id: `round_${Date.now()}`,
        userQuery: query,
        attachedTextFiles: attachedFiles,
        createdAt: Date.now(),
        mode: 'full',
        deliberation: {
          stage1: {},
          stage2: {},
        },
      };

      await runRoundExecution(newRound);
    } finally {
      releaseDeliberationLock();
    }
  };

  const handleForkBranch = async (parentRoundId: string, branchName: string) => {
    if (!acquireDeliberationLock()) return;

    try {
      const parent = rounds.find((r) => r.id === parentRoundId);
      if (!parent) return;

      const branchedRound: CouncilRound = {
        id: `branch_${Date.now()}`,
        userQuery: `[Sub-Council Branch: ${branchName}] Re-evaluating: ${parent.userQuery}`,
        parentRoundId,
        branchName,
        createdAt: Date.now(),
        mode: 'full',
        deliberation: { stage1: {}, stage2: {} },
      };

      await runRoundExecution(branchedRound);
    } finally {
      releaseDeliberationLock();
    }
  };

  const resumeIncompleteRound = async (roundId: string) => {
    if (!acquireDeliberationLock()) return;

    try {
      const round = rounds.find((r) => r.id === roundId);
      if (round) {
        await runRoundExecution({ ...round });
      }
    } finally {
      releaseDeliberationLock();
    }
  };

  const reRunRoundDeliberation = async (roundId: string) => {
    if (!acquireDeliberationLock()) return;

    try {
      const round = rounds.find((r) => r.id === roundId);
      if (round) {
        const freshRound: CouncilRound = {
          ...round,
          deliberation: { stage1: {}, stage2: {} },
        };
        await runRoundExecution(freshRound);
      }
    } finally {
      releaseDeliberationLock();
    }
  };

  const activePersonas = personas.filter((p) => p.enabled !== false);
  const firstIncomplete = rounds.find((r) => getRoundIncompleteStage(r, activePersonas).isIncomplete);

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-5">
      {/* Cloud Auth Notification */}
      {authError && (
        <div className="p-3 bg-red-950/90 border border-red-500 rounded-xl text-red-200 text-xs flex items-center justify-between shadow-lg">
          <span>{authError}</span>
          <button onClick={() => setAuthError(null)} className="text-red-400 font-bold px-2">×</button>
        </div>
      )}

      {/* Sticky Interrupted Deliberation Banner */}
      {firstIncomplete && (() => {
        const info = getRoundIncompleteStage(firstIncomplete, activePersonas);
        const roundIdx = rounds.findIndex((r) => r.id === firstIncomplete.id) + 1;
        return (
          <div className="sticky top-14 z-30 p-3 rounded-xl bg-amber-950/95 border border-amber-500/60 flex flex-wrap items-center justify-between gap-3 text-amber-200 text-xs shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-semibold text-amber-100">Interrupted Deliberation:</span>
              <span className="text-amber-300 font-mono">Round {roundIdx} • {info.description}</span>
            </div>
            <button
              onClick={() => resumeIncompleteRound(firstIncomplete.id)}
              disabled={isDeliberating}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play size={12} className={isDeliberating ? 'animate-spin' : 'fill-current'} />
              <span>Resume</span>
            </button>
          </div>
        );
      })()}

      {/* Mode View Switcher */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2">
          <span>Deliberation Rounds</span>
          {rounds.length > 0 && (
            <span className="text-xs font-mono font-normal text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
              {rounds.length}
            </span>
          )}
        </h2>
        <div className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-xs">
          <button
            onClick={() => setBasicMode(false)}
            className={`px-3 py-1 rounded-md transition-colors ${!basicMode ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400'}`}
          >
            Full Debate
          </button>
          <button
            onClick={() => setBasicMode(true)}
            className={`px-3 py-1 rounded-md transition-colors ${basicMode ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400'}`}
          >
            Consensus
          </button>
        </div>
      </div>

      {/* Rounds Stack */}
      <div className="space-y-4">
        {rounds.map((round) => (
          <CouncilRoundView
            key={round.id}
            round={round}
            personas={personas}
            basicMode={basicMode}
            incompleteStage={getRoundIncompleteStage(round, activePersonas)}
            onResumeRound={resumeIncompleteRound}
            onReRunRound={reRunRoundDeliberation}
            onForkBranch={(branchName) => handleForkBranch(round.id, branchName)}
            isDeliberating={isDeliberating}
          />
        ))}
      </div>

      {/* Input Composer */}
      <Composer onSend={handleDeliberate} isDeliberating={isDeliberating} />
    </div>
  );
};
