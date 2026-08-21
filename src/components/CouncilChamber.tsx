import React, { useState, useEffect, useRef } from 'react';
import { Play, AlertTriangle } from 'lucide-react';
import type { Persona, CouncilRound, AttachedTextFile, ConsensusMetric, PersonaId, AutoSaveState } from '../types';
import { policyForPreset } from '../lib/executionPolicy';
import { streamPersonaWithFallback } from '../lib/fallbackManager';
import { resolveExecutionMode } from '../lib/modeClassifier';
import { compressSessionContext } from '../lib/contextCompressor';
import { preprocessLargeAttachment } from '../lib/chunkProcessor';
import { shouldEnableWebSearch } from '../lib/webGrounding';
import { detectTaskDomain, applySmartModelSelection } from '../lib/smartModelSelector';
import { countRoundCost, formatCost } from '../lib/archivist';
import { useCouncilReducer } from '../hooks/useCouncilReducer';
import { CouncilRoundView } from './CouncilRoundView';
import { Composer } from './Composer';
import { CouncilSummaryBar } from './CouncilSummaryBar';
import { CHAIRMAN_PROMPT } from '../data';

export interface CouncilSettings {
  enableChunking: boolean;
  showConsensusVisualizer: boolean;
  enableWeightTuning: boolean;
}

export interface CouncilChamberProps {
  personas: Persona[];
  synthesizer: Persona;
  activePresetId?: string;
  rounds: CouncilRound[];
  activeSessionId?: string | null;
  onUpdateRound: (sessionId: string, round: CouncilRound) => void;
  onCompleteRound: (sessionId: string, round: CouncilRound) => void;
  onDeleteRound?: (roundId: string) => void;
  flushNow: () => void;
  rawModelsCatalog?: any[];
  settings?: Partial<CouncilSettings>;
  executionMode?: 'auto' | 'quick_panel' | 'deep_council';
  webMode?: 'off' | 'auto' | 'always';
  autoSelectModels?: boolean;
  maxTokens?: number;
  quickPanelMaxTokens?: number;
  synthesisMaxTokens?: number;
  panelTimeoutSeconds?: number;
  stopAfterStage1?: boolean;
  maxRoundCostCeiling?: number;
  autoSaveState?: AutoSaveState;
  lastSavedAt?: number | null;
  isSaving?: boolean;
  isSyncing?: boolean;
  saveDestination?: 'cloud' | 'local' | null;
  onOpenSettings?: () => void;
  showToast?: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
}

/** Deep-clones a round so in-flight streaming never mutates props/session state. */
function cloneRound(round: CouncilRound): CouncilRound {
  return {
    ...round,
    deliberation: {
      stage1: { ...(round.deliberation?.stage1 || {}) },
      stage2: { ...(round.deliberation?.stage2 || {}) },
      ...(round.deliberation?.stage3 ? { stage3: round.deliberation.stage3 } : {}),
    },
    synthesis: round.synthesis ? { ...round.synthesis } : { content: '', status: 'idle' },
  };
}

export function buildFullQueryWithAttachments(round: CouncilRound): string {
  let q = round.userQuery || '';
  if (round.attachedTextFiles?.length) {
    const files = round.attachedTextFiles
      .map((f) => `--- Attached File: ${f.name} ---\n${f.content}`)
      .join('\n\n');
    q = q.includes('Review attached file context')
      ? files
      : `${q}\n\n${files}`;
  }
  return q;
}

export function getRoundIncompleteStage(
  round: CouncilRound,
  personas: Persona[]
): { isIncomplete: boolean; description: string } {
  const active = personas.filter((p) => p.enabled !== false);
  const stage1 = round.deliberation?.stage1 || {};
  const stage2 = round.deliberation?.stage2 || {};
  const stage3 = round.deliberation?.stage3 || round.synthesis;

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

/** Picks the cheapest policy-compliant model from the catalog for chunk summarization. */
function chooseChunkingModel(
  rawModelsCatalog: any[] | undefined,
  policy: ReturnType<typeof policyForPreset>,
  fallbackModel: string
): string {
  const catalog = rawModelsCatalog || [];
  if (catalog.length === 0) return fallbackModel;

  const parse = (v: any) => parseFloat(String(v || '0'));
  const isPolicyOk = (m: any) => {
    if (policy.budget === 'free') {
      const EPS = 0.000001;
      return (
        parse(m?.pricing?.request) <= EPS &&
        parse(m?.pricing?.prompt) <= EPS &&
        parse(m?.pricing?.completion) <= EPS
      );
    }
    return true;
  };

  const candidates = catalog
    .filter((m) => m?.id && isPolicyOk(m))
    .sort((a, b) => {
      const costA = parse(a?.pricing?.prompt) + parse(a?.pricing?.completion);
      const costB = parse(b?.pricing?.prompt) + parse(b?.pricing?.completion);
      return costA - costB;
    });

  return candidates[0]?.id || fallbackModel;
}

export const CouncilChamber: React.FC<CouncilChamberProps> = ({
  personas,
  synthesizer,
  activePresetId = 'deep_council',
  rounds,
  activeSessionId,
  onUpdateRound,
  onCompleteRound,
  onDeleteRound,
  flushNow,
  rawModelsCatalog,
  settings = {},
  executionMode = 'auto',
  webMode = 'auto',
  autoSelectModels = true,
  maxTokens = 4000,
  quickPanelMaxTokens = 350,
  synthesisMaxTokens = 500,
  panelTimeoutSeconds = 120,
  stopAfterStage1 = false,
  maxRoundCostCeiling = 0,
  autoSaveState,
  lastSavedAt,
  isSaving,
  isSyncing,
  saveDestination,
  onOpenSettings,
  showToast,
}) => {
  const [isDeliberating, setIsDeliberating] = useState(false);
  const [basicMode, setBasicMode] = useState(false);
  const [lastDomain, setLastDomain] = useState<string | undefined>(undefined);

  /** Human-readable error text (AbortError => clean "Stopped" message). */
  const friendlyError = (err: any): string =>
    err?.name === 'AbortError' ? 'Stopped by user' : (err?.message || String(err));

  /** Builds a per-call AbortController that follows the run signal + per-call timeout. */
  const makeCallController = (timeoutMs: number) => {
    const ctrl = new AbortController();
    const runSignal = abortRef.current?.signal;
    const onAbort = () => ctrl.abort();
    if (runSignal) runSignal.addEventListener('abort', onAbort);
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return {
      signal: ctrl.signal,
      cleanup: () => {
        clearTimeout(t);
        if (runSignal) runSignal.removeEventListener('abort', onAbort);
      },
    };
  };

  const isRunAborted = () => abortRef.current?.signal.aborted === true;

  // Local streaming UI state (fast reducer updates; persistence flows through the session manager).
  const { rounds: localRounds, dispatch, setRounds } = useCouncilReducer(rounds);

  // Re-seed local rounds when the active session changes.
  useEffect(() => {
    setRounds(rounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Handle external clears (e.g. "Clear History" from the sidebar) that don't
  // change the active session id — re-seed to empty when the session is empty
  // and no deliberation is running.
  useEffect(() => {
    if (rounds.length === 0 && localRounds.length > 0 && !deliberationLockRef.current) {
      setRounds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds.length]);

  const effectiveSettings: CouncilSettings = {
    enableChunking: settings.enableChunking ?? false,
    showConsensusVisualizer: settings.showConsensusVisualizer ?? false,
    enableWeightTuning: settings.enableWeightTuning ?? false,
  };

  // Concurrency Lock Reference
  const deliberationLockRef = useRef(false);

  // Abort controller for the currently-running deliberation (Stop button).
  const abortRef = useRef<AbortController | null>(null);

  const acquireDeliberationLock = (): boolean => {
    if (deliberationLockRef.current) return false;
    deliberationLockRef.current = true;
    setIsDeliberating(true);
    return true;
  };

  const releaseDeliberationLock = () => {
    deliberationLockRef.current = false;
    abortRef.current = null;
    setIsDeliberating(false);
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      showToast?.('Stopping deliberation…', 'warning');
    }
  };

  const policy = policyForPreset(activePresetId);

  // Round being executed (single-flight under the deliberation lock).
  const activeRoundRef = useRef<CouncilRound | null>(null);

  /**
   * Builds the full query for a round, optionally preprocessing oversized
   * attached files into section summaries (auto-chunking) without ever
   * mutating the stored session or the original file.
   */
  const prepareQuery = async (round: CouncilRound): Promise<string> => {
    let baseQuery = buildFullQueryWithAttachments(round);

    if (effectiveSettings.enableChunking && round.attachedTextFiles?.length) {
      const chunkModel = chooseChunkingModel(rawModelsCatalog, policy, synthesizer.model);

      const processed: AttachedTextFile[] = [];
      for (const file of round.attachedTextFiles) {
        if (file.content && file.content.length > 50_000) {
          try {
            showToast?.(`Preprocessing ${file.name} (chunk 1 of ${Math.ceil(file.content.length / 24_500)})...`);
            const summary = await preprocessLargeAttachment(file, {
              model: chunkModel,
              policy,
              apiKey: '',
              onProgress: (current, total) => {
                showToast?.(`Preprocessing ${file.name} (chunk ${current} of ${total})...`);
              },
            });
            processed.push({ ...file, content: summary });
          } catch (err: any) {
            console.warn(`[CouncilChamber] Chunk preprocessing failed for ${file.name}:`, err);
            processed.push(file);
          }
        } else {
          processed.push(file);
        }
      }

      const withProcessed: CouncilRound = { ...round, attachedTextFiles: processed };
      baseQuery = buildFullQueryWithAttachments(withProcessed);
    }

    return baseQuery;
  };

  /** Stage 3: authoritative executive synthesis from the stage outputs. */
  const runSynthesisPhase = async (
    stage1Outputs: Record<PersonaId, any>,
    stage2Outputs: Record<PersonaId, any>
  ) => {
    const roundToSynthesize = activeRoundRef.current;
    if (!roundToSynthesize || !activeSessionId) return;

    const activePersonas = personas.filter((p) => p.enabled !== false);
    const synthesisModel = synthesizer.model || activePersonas[0]?.model || 'anthropic/claude-3.7-sonnet';

    const s1Text = Object.entries(stage1Outputs || {})
      .map(([id, r]) => `Proposal (${id}):\n${(r as any)?.content || '[No proposal]'}`)
      .join('\n\n');

    const s2Text = Object.entries(stage2Outputs || {})
      .map(([id, r]) => `Peer Review (${id}):\n${(r as any)?.content || '[No critique]'}`)
      .join('\n\n');

    let synthPrompt = `Synthesize an authoritative, executive consensus from this deliberation:\n\nTopic:\n${roundToSynthesize.userQuery}\n\nStage 1 Proposals:\n${s1Text}\n\nStage 2 Critiques:\n${s2Text}\n\nDeliver a final synthesis with structured Verdict, Consensus Invariants, Critical Disagreements, and Immediate Next Action Steps.`;

    // Step 9: Synthesis weight tuning — annotate adjusted panelist influence.
    const weightedPersonas = activePersonas.filter(
      (p) => (p.synthesisWeight ?? 1.0) !== 1.0
    );
    if (weightedPersonas.length > 0) {
      synthPrompt +=
        '\n\nSynthesis Weighting Note: The following panelists carry adjusted influence in this synthesis:\n' +
        weightedPersonas
          .map((p) =>
            `- ${p.name}: ${(p.synthesisWeight ?? 1.0) > 1.0 ? 'elevated weight ' + (p.synthesisWeight ?? 1.0).toFixed(1) + 'x — ' + 'prioritize their conclusions and reasoning' : 'reduced weight ' + (p.synthesisWeight ?? 1.0).toFixed(1) + 'x — ' + 'treat their conclusions as supplementary'}`
          )
          .join('\n') +
        '\nAll other panelists carry standard weight (1.0x).';
    }

    dispatch({ type: 'START_SYNTHESIS', payload: { roundId: roundToSynthesize.id } });

    let fullSynthesis = '';
    let consensusMetric: ConsensusMetric | undefined;
    let finishReason: string | undefined;
    let usage: any;

    try {
      const chairPersona: Persona = {
        ...synthesizer,
        id: 'synthesizer',
        name: synthesizer.name || 'The Chair',
        role: synthesizer.role || 'Consensus Builder',
      };

      const call = makeCallController((panelTimeoutSeconds || 120) * 1000);
      let res: Awaited<ReturnType<typeof streamPersonaWithFallback>>;
      try {
        res = await streamPersonaWithFallback({
          persona: chairPersona,
          messages: [
            { role: 'system', content: CHAIRMAN_PROMPT },
            { role: 'user', content: synthPrompt },
          ],
          policy,
          rawModels: rawModelsCatalog,
          sessionId: activeSessionId ?? undefined,
          signal: call.signal,
          maxTokens: synthesisMaxTokens,
          onToken: (chunk) => {
            fullSynthesis += chunk;
            dispatch({ type: 'UPDATE_SYNTHESIS_TOKEN', payload: { roundId: roundToSynthesize.id, chunk } });
          },
        });
      } finally {
        call.cleanup();
      }

      fullSynthesis = res.content;
      finishReason = res.finishReason;
      usage = res.usage;

      // Step 8: extract the consensus metric JSON block from the Chair output.
      const jsonMatch = fullSynthesis.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (
            typeof parsed.agreementScore === 'number' &&
            Array.isArray(parsed.keyConsensusPoints)
          ) {
            consensusMetric = parsed as ConsensusMetric;
            fullSynthesis = fullSynthesis.replace(jsonMatch[0], '').trim();
          }
        } catch {
          // ignore parse failure
        }
      }

      roundToSynthesize.synthesis = {
        model: res.actualModel || synthesisModel,
        content: fullSynthesis,
        status: 'completed',
        consensusMetric,
        finishReason,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
      };
      roundToSynthesize.deliberation.stage3 = {
        model: res.actualModel || synthesisModel,
        content: fullSynthesis,
        status: 'completed',
        consensusMetric,
        finishReason,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
      };
      roundToSynthesize.cost = (roundToSynthesize.cost || 0);

      dispatch({
        type: 'FINISH_SYNTHESIS',
        payload: {
          roundId: roundToSynthesize.id,
          content: fullSynthesis,
          model: res.actualModel || synthesisModel,
          actualModel: res.actualModel,
          finishReason: res.finishReason,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          cost: 0,
        },
      });
    } catch (err: any) {
      const msg = friendlyError(err);
      roundToSynthesize.synthesis = {
        model: synthesisModel,
        content: `[Synthesis ${err?.name === 'AbortError' ? 'stopped' : 'error'}: ${msg}]`,
        status: 'error',
        error: msg,
      };
      dispatch({
        type: 'ERROR_SYNTHESIS',
        payload: { roundId: roundToSynthesize.id, error: msg },
      });
    }

    onCompleteRound(activeSessionId, { ...roundToSynthesize });
    flushNow();
  };

  /** Standalone synthesis entry (quick panel / re-synthesis) with deliberation lock. */
  const runQuickPanelSynthesis = async (roundToSynthesize: CouncilRound, activePersonas: Persona[]) => {
    if (!acquireDeliberationLock()) return;

    try {
      abortRef.current = new AbortController();
      activeRoundRef.current = cloneRound(roundToSynthesize);
      const stage1 = activeRoundRef.current.deliberation?.stage1 || {};
      const stage2 = roundToSynthesize.deliberation?.stage2 || {};
      await runSynthesisPhase(stage1, stage2);
    } finally {
      releaseDeliberationLock();
    }
  };

  /** Core deliberation pipeline: Stage 1 → (quick panel: synthesize) → Stage 2 → Stage 3. */
  const runRoundExecution = async (roundToRun: CouncilRound, preparedQuery?: string) => {
    if (!activeSessionId) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const currentRoundState: CouncilRound = cloneRound(roundToRun);
    activeRoundRef.current = currentRoundState;

    // Ensure the live render list has this round and persist it immediately so
    // an interrupted run can be resumed after a reload.
    dispatch({ type: 'UPSERT_ROUND', payload: currentRoundState });
    onUpdateRound(activeSessionId, { ...currentRoundState });

    let contextSummary = '';
    if (rounds.length >= 3) {
      try {
        contextSummary = await compressSessionContext(rounds);
      } catch {
        // Fallback gracefully without context summary
      }
    }

    let fullQuery = preparedQuery || (await prepareQuery(roundToRun));
    if (contextSummary) {
      fullQuery = `[Prior Council Consensus Memory]:\n${contextSummary}\n\n[Active Topic Query]:\n${fullQuery}`;
    }

    // Follow-up mode: explicitly carry the prior round's consensus forward.
    if (roundToRun.isFollowUp) {
      const prior =
        rounds[rounds.length - 1]?.synthesis?.content ||
        rounds[rounds.length - 1]?.deliberation?.stage3?.content;
      if (prior) {
        fullQuery = `[Follow-up to previous deliberation — prior consensus]:\n${prior}\n\n[Follow-up question]:\n${fullQuery}`;
      }
    }

    const activePersonas = personas.filter((p) => p.enabled !== false);
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const letterFor = (id: string) => {
      const idx = activePersonas.findIndex((p) => p.id === id);
      return letters[idx] || `P${idx + 1}`;
    };
    const isQuickPanel = Boolean(roundToRun.isQuickPanel) || activePersonas.length <= 1;
    const stageTokenLimit = isQuickPanel ? (quickPanelMaxTokens || 350) : (maxTokens || 4000);
    const webEnabled = shouldEnableWebSearch(currentRoundState.userQuery, webMode, policy.budget).enabled;

    // Task-domain detection + smart model recommendations (applied when enabled).
    const domain = detectTaskDomain(
      currentRoundState.userQuery,
      (currentRoundState.attachedTextFiles || []) as any
    );
    setLastDomain(domain);
    const modelOverrides: Record<string, string> = {};
    if (autoSelectModels) {
      try {
        const selection = applySmartModelSelection(domain, activePersonas, synthesizer, {
          rawModelsCatalog: rawModelsCatalog || [],
          autoSelectModels: true,
        });
        selection.updatedPersonas.forEach((p) => {
          modelOverrides[p.id] = p.model;
        });
      } catch {
        // fall back to each persona's configured model
      }
    }
    const modelFor = (id: string) =>
      modelOverrides[id] || activePersonas.find((p) => p.id === id)?.model || '';

    const stage1 = currentRoundState.deliberation.stage1 || {};
    const stage2 = currentRoundState.deliberation.stage2 || {};
    const existingSynthesis = currentRoundState.deliberation.stage3 || currentRoundState.synthesis;

    const missingStage1 = activePersonas.filter((p) => stage1[p.id]?.status !== 'completed');
    const needStage1 = missingStage1.length > 0;

    // ---- Stage 1: Parallel proposals (only missing personas) ----
    if (needStage1) {
      const initialStage1: Record<PersonaId, any> = {};
      activePersonas.forEach((p) => {
        const existing = stage1[p.id];
        initialStage1[p.id] =
          existing?.status === 'completed'
            ? existing
            : { personaId: p.id, content: existing?.content || '', status: 'streaming' };
      });
      dispatch({ type: 'START_STAGE1', payload: { roundId: currentRoundState.id, initialStage1 } });

      const s1Promises = missingStage1.map(async (persona) => {
        const call = makeCallController((panelTimeoutSeconds || 120) * 1000);
        const runPersona = { ...persona, model: modelFor(persona.id) || persona.model };
        let accumulated = '';
        try {
          const res = await streamPersonaWithFallback({
            persona: runPersona,
            messages: [
              { role: 'system', content: persona.systemPrompt },
              { role: 'user', content: fullQuery },
            ],
            policy,
            rawModels: rawModelsCatalog,
            sessionId: activeSessionId ?? undefined,
            signal: call.signal,
            maxTokens: stageTokenLimit,
            webSearch: webEnabled,
            onToken: (chunk) => {
              accumulated += chunk;
              dispatch({ type: 'UPDATE_STAGE1_TOKEN', payload: { roundId: currentRoundState.id, personaId: persona.id, chunk } });
            },
          });

          currentRoundState.deliberation.stage1[persona.id] = {
            personaId: persona.id,
            model: runPersona.model,
            actualModel: res.actualModel,
            content: res.content || accumulated,
            status: 'completed',
            finishReason: res.finishReason,
            promptTokens: res.usage?.promptTokens,
            completionTokens: res.usage?.completionTokens,
            totalTokens: res.usage?.totalTokens,
            cost: res.cost,
          };
          dispatch({
            type: 'FINISH_STAGE1_PERSONA',
            payload: {
              roundId: currentRoundState.id,
              personaId: persona.id,
              content: res.content || accumulated,
              model: runPersona.model,
              actualModel: res.actualModel,
              finishReason: res.finishReason,
              promptTokens: res.usage?.promptTokens,
              completionTokens: res.usage?.completionTokens,
              totalTokens: res.usage?.totalTokens,
              cost: res.cost,
            },
          });
        } catch (err: any) {
          const msg = friendlyError(err);
          currentRoundState.deliberation.stage1[persona.id] = {
            personaId: persona.id,
            model: persona.model,
            content: `[Deliberation ${err?.name === 'AbortError' ? 'stopped' : 'error'}: ${msg}]`,
            status: 'error',
            error: msg,
          };
          dispatch({
            type: 'ERROR_STAGE1_PERSONA',
            payload: { roundId: currentRoundState.id, personaId: persona.id, error: msg },
          });
        } finally {
          call.cleanup();
        }
      });

      await Promise.allSettled(s1Promises);
      onUpdateRound(activeSessionId, { ...currentRoundState });
    }

    if (isRunAborted()) return;

    // Cost ceiling enforcement: skip further stages once the round's estimated
    // spend exceeds the user's per-round cap.
    const overCeiling =
      maxRoundCostCeiling > 0 &&
      countRoundCost(currentRoundState).totalCost > maxRoundCostCeiling;
    const skipRemaining = stopAfterStage1 || overCeiling;

    // Quick panel: synthesize from Stage 1 outputs only.
    if (isQuickPanel) {
      if (existingSynthesis?.status !== 'completed') {
        await runSynthesisPhase(currentRoundState.deliberation.stage1, {});
      }
      return;
    }

    // Optional early exit: Stop After Stage 1 or cost ceiling reached.
    if (skipRemaining) {
      const reason = overCeiling
        ? `Stage 2 & Synthesis skipped (estimated round cost ${formatCost(countRoundCost(currentRoundState).totalCost)} exceeded the $${maxRoundCostCeiling.toFixed(2)} ceiling).`
        : 'Stage 2 & Synthesis skipped (Stop After Stage 1 is enabled).';
      currentRoundState.synthesis = { model: synthesizer.model, content: reason, status: 'completed' };
      currentRoundState.deliberation.stage3 = { model: synthesizer.model, content: reason, status: 'completed' };
      dispatch({
        type: 'FINISH_SYNTHESIS',
        payload: { roundId: currentRoundState.id, content: reason, model: synthesizer.model },
      });
      onCompleteRound(activeSessionId, { ...currentRoundState });
      flushNow();
      return;
    }

    // ---- Stage 2: Peer Review & Critique (only missing personas) ----
    const s1Outputs = currentRoundState.deliberation.stage1;
    const missingStage2 = activePersonas.filter((p) => stage2[p.id]?.status !== 'completed');
    if (missingStage2.length > 0) {
      const initialStage2: Record<PersonaId, any> = {};
      activePersonas.forEach((p) => {
        const existing = stage2[p.id];
        initialStage2[p.id] =
          existing?.status === 'completed'
            ? existing
            : { personaId: p.id, content: existing?.content || '', status: 'streaming' };
      });
      dispatch({ type: 'START_STAGE2', payload: { roundId: currentRoundState.id, initialStage2 } });

      const s2Promises = missingStage2.map(async (persona) => {
        const call = makeCallController((panelTimeoutSeconds || 120) * 1000);
        const runPersona = { ...persona, model: modelFor(persona.id) || persona.model };
        const myLetter = letterFor(persona.id);

        const peerProposals = activePersonas
          .filter((p) => p.id !== persona.id)
          .map((p) => {
            const resp = s1Outputs[p.id];
            return `### Panelist ${letterFor(p.id)} (${p.role}):\n${resp?.content || '[No proposal]'}`;
          })
          .join('\n\n');

        const stage2Prompt = `You are Panelist ${myLetter}. Critically evaluate your peers' proposals below.

Original User Query:
${fullQuery}

Peer Proposals:
${peerProposals}

Please provide your rigorous critique, cross-examination, points of consensus, and key disagreements.
If the question contains code, documents, or attached files, treat them as available and reference specific sections directly. Do not claim content is missing unless the source genuinely omits it.`;

        let accumulated = '';
        try {
          const res = await streamPersonaWithFallback({
            persona: runPersona,
            messages: [
              { role: 'system', content: persona.systemPrompt },
              { role: 'user', content: stage2Prompt },
            ],
            policy,
            rawModels: rawModelsCatalog,
            sessionId: activeSessionId ?? undefined,
            signal: call.signal,
            maxTokens: stageTokenLimit,
            onToken: (chunk) => {
              accumulated += chunk;
              dispatch({ type: 'UPDATE_STAGE2_TOKEN', payload: { roundId: currentRoundState.id, personaId: persona.id, chunk } });
            },
          });

          currentRoundState.deliberation.stage2[persona.id] = {
            personaId: persona.id,
            model: runPersona.model,
            actualModel: res.actualModel,
            content: res.content || accumulated,
            status: 'completed',
            finishReason: res.finishReason,
            promptTokens: res.usage?.promptTokens,
            completionTokens: res.usage?.completionTokens,
            totalTokens: res.usage?.totalTokens,
            cost: res.cost,
          };
          dispatch({
            type: 'FINISH_STAGE2_PERSONA',
            payload: {
              roundId: currentRoundState.id,
              personaId: persona.id,
              content: res.content || accumulated,
              model: runPersona.model,
              actualModel: res.actualModel,
              finishReason: res.finishReason,
              promptTokens: res.usage?.promptTokens,
              completionTokens: res.usage?.completionTokens,
              totalTokens: res.usage?.totalTokens,
              cost: res.cost,
            },
          });
        } catch (err: any) {
          const msg = friendlyError(err);
          currentRoundState.deliberation.stage2[persona.id] = {
            personaId: persona.id,
            model: persona.model,
            content: `[Peer Review ${err?.name === 'AbortError' ? 'stopped' : 'error'}: ${msg}]`,
            status: 'error',
            error: msg,
          };
          dispatch({
            type: 'ERROR_STAGE2_PERSONA',
            payload: { roundId: currentRoundState.id, personaId: persona.id, error: msg },
          });
        } finally {
          call.cleanup();
        }
      });

      await Promise.allSettled(s2Promises);
      onUpdateRound(activeSessionId, { ...currentRoundState });
    }

    if (isRunAborted()) return;

    // ---- Stage 3: Authoritative Executive Synthesis ----
    if (existingSynthesis?.status !== 'completed') {
      await runSynthesisPhase(currentRoundState.deliberation.stage1, currentRoundState.deliberation.stage2);
    }
  };

  const handleDeliberate = async (query: string, attachedFiles: AttachedTextFile[], isFollowUp: boolean) => {
    if (!acquireDeliberationLock()) return;

    try {
      const resolvedMode = resolveExecutionMode(executionMode, query, attachedFiles);
      const newRound: CouncilRound = {
        id: `round_${Date.now()}`,
        userQuery: query,
        timestamp: Date.now(),
        attachedTextFiles: attachedFiles,
        mode: resolvedMode === 'quick_panel' ? 'quick_panel' : 'full',
        resolvedMode,
        isQuickPanel: resolvedMode === 'quick_panel',
        isFollowUp,
        deliberation: {
          stage1: {},
          stage2: {},
        },
        synthesis: { content: '', status: 'idle' },
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
        timestamp: Date.now(),
        parentRoundId,
        branchName,
        mode: 'full',
        isQuickPanel: false,
        deliberation: { stage1: {}, stage2: {} },
        synthesis: { content: '', status: 'idle' },
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
        const fullQuery = await prepareQuery(round);
        await runRoundExecution({ ...round }, fullQuery);
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
        const fullQuery = await prepareQuery(round);
        const freshRound: CouncilRound = {
          ...round,
          timestamp: Date.now(),
          deliberation: { stage1: {}, stage2: {} },
          synthesis: { content: '', status: 'idle' },
        };
        await runRoundExecution(freshRound, fullQuery);
      }
    } finally {
      releaseDeliberationLock();
    }
  };

  const handleRegeneratePersona = async (personaId: string, roundId?: string) => {
    if (!acquireDeliberationLock()) return;

    try {
      if (!activeSessionId) return;
      const targetId = roundId || activeRoundRef.current?.id;
      const round = rounds.find((r) => r.id === targetId);
      if (!round) return;

      const persona = personas.find((p) => p.id === personaId);
      if (!persona) return;

      const currentRoundState: CouncilRound = cloneRound(round);
      abortRef.current = new AbortController();
      activeRoundRef.current = currentRoundState;
      const fullQuery = await prepareQuery(round);
      const webEnabled = shouldEnableWebSearch(currentRoundState.userQuery, webMode, policy.budget).enabled;

      dispatch({
        type: 'START_STAGE1',
        payload: { roundId: currentRoundState.id, initialStage1: { ...currentRoundState.deliberation.stage1 } },
      });

      const call = makeCallController((panelTimeoutSeconds || 120) * 1000);
      try {
        const res = await streamPersonaWithFallback({
          persona,
          messages: [
            { role: 'system', content: persona.systemPrompt },
            { role: 'user', content: fullQuery },
          ],
          policy,
          rawModels: rawModelsCatalog,
          sessionId: activeSessionId ?? undefined,
          signal: call.signal,
          maxTokens: maxTokens || 4000,
          webSearch: webEnabled,
          onToken: (chunk) => {
            dispatch({ type: 'UPDATE_STAGE1_TOKEN', payload: { roundId: currentRoundState.id, personaId: persona.id, chunk } });
          },
        });

        currentRoundState.deliberation.stage1[persona.id] = {
          personaId: persona.id,
          model: persona.model,
          actualModel: res.actualModel,
          content: res.content,
          status: 'completed',
          finishReason: res.finishReason,
          promptTokens: res.usage?.promptTokens,
          completionTokens: res.usage?.completionTokens,
          totalTokens: res.usage?.totalTokens,
          cost: res.cost,
        };
        dispatch({
          type: 'FINISH_STAGE1_PERSONA',
          payload: {
            roundId: currentRoundState.id,
            personaId: persona.id,
            content: res.content,
            model: persona.model,
            actualModel: res.actualModel,
            finishReason: res.finishReason,
            promptTokens: res.usage?.promptTokens,
            completionTokens: res.usage?.completionTokens,
            totalTokens: res.usage?.totalTokens,
            cost: res.cost,
          },
        });
      } catch (err: any) {
        const msg = friendlyError(err);
        currentRoundState.deliberation.stage1[persona.id] = {
          personaId: persona.id,
          model: persona.model,
          content: `[Deliberation ${err?.name === 'AbortError' ? 'stopped' : 'error'}: ${msg}]`,
          status: 'error',
          error: msg,
        };
        dispatch({
          type: 'ERROR_STAGE1_PERSONA',
          payload: { roundId: currentRoundState.id, personaId: persona.id, error: msg },
        });
      } finally {
        call.cleanup();
      }

      onUpdateRound(activeSessionId, { ...currentRoundState });
      await runSynthesisPhase(currentRoundState.deliberation.stage1, currentRoundState.deliberation.stage2);
    } finally {
      releaseDeliberationLock();
    }
  };

  const activePersonas = personas.filter((p) => p.enabled !== false);
  const firstIncomplete = rounds.find((r) => getRoundIncompleteStage(r, activePersonas).isIncomplete);

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-5">
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

      {/* Council Formation & Metric Summary Bar */}
      <CouncilSummaryBar
        presetId={activePresetId}
        answerMode={executionMode}
        taskDomain={lastDomain}
        personas={personas}
        synthesizer={synthesizer}
        rawModels={rawModelsCatalog}
        updatedAt={Date.now()}
        autoSaveState={autoSaveState}
        lastSavedAt={lastSavedAt}
        isSaving={isSaving}
        isSyncing={isSyncing}
        saveDestination={saveDestination}
        onSaveNow={flushNow}
        onOpenSettings={onOpenSettings}
      />

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
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${!basicMode ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400'}`}
          >
            Full Debate
          </button>
          <button
            onClick={() => setBasicMode(true)}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${basicMode ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400'}`}
          >
            Consensus
          </button>
        </div>
      </div>

      {/* Rounds Stack */}
      <div className="space-y-4">
        {(localRounds.length > 0 ? localRounds : rounds).map((round) => (
          <CouncilRoundView
            key={round.id}
            round={round}
            personas={personas}
            synthesizer={synthesizer}
            basicMode={basicMode}
            incompleteStage={getRoundIncompleteStage(round, activePersonas)}
            onResumeRound={resumeIncompleteRound}
            onReRunRound={reRunRoundDeliberation}
            onReSynthesize={runQuickPanelSynthesis}
            onRegeneratePersona={handleRegeneratePersona}
            onForkBranch={(branchName) => handleForkBranch(round.id, branchName)}
            onDeleteRound={onDeleteRound ? (roundId) => {
              dispatch({ type: 'DELETE_ROUND', payload: { roundId } });
              onDeleteRound(roundId);
            } : undefined}
            isDeliberating={isDeliberating}
            showConsensusVisualizer={effectiveSettings.showConsensusVisualizer}
          />
        ))}
      </div>

      {/* Input Composer */}
      <Composer onSend={handleDeliberate} isDeliberating={isDeliberating} onStop={handleStop} />
    </div>
  );
};
