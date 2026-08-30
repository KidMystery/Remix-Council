import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Send,
  Paperclip,
  FileImage,
  FileText,
  X,
  BookOpen,
  Download,
  Upload,
  RefreshCw,
  Square,
  Loader2,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Globe,
  Brain,
  Sparkles,
  Mic,
  Users,
  Wallet,
  Cloud,
  Sliders,
  ChevronDown,
  Pencil,
  Eraser,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  Activity,
} from 'lucide-react';
import { recordError, recordWarn, recordInfo } from '../lib/eventLog';
import {
  OracleThread,
  OracleBible,
  OracleMessage,
  OracleImage,
  OracleTextFile,
  newOracleThread,
  loadOracleThreads,
  saveOracleThreads,
  loadOracleTombstones,
  saveOracleTombstones,
  loadGlobalBible,
  saveGlobalBible,
  hydrateOracleFromIdb,
  exportOracleThreads,
  importOracleThreads,
  ORACLE_DEFAULT_MODEL,
  DEFAULT_MINI_DELIBERATION_MODELS,
  DEFAULT_ROTATION_ROSTER,
  ORACLE_THREADS_UPDATED_EVENT,
  pruneStaleOracleErrors,
} from '../lib/oracleStore';
import {
  buildOracleModelOptions,
  loadCustomOracleModels,
  saveCustomOracleModels,
  loadOracleDirectList,
  saveOracleDirectList,
  resolveRotationModel,
  filterVisionSafeRoster,
  pickLiveVisionFallback,
  ORACLE_ERROR_RETRY_MODEL,
} from '../lib/oracleModelPool';
import {
  detectBriefingCandidates,
  filterBriefingCandidates,
  loadBriefingStore,
  recordBriefingConvened,
  dismissBriefingTopic,
  capitalizeLabel,
  ORACLE_BRIEFINGS_UPDATED_EVENT,
} from '../lib/briefingDetector';
import type { OracleCustomModel } from '../lib/oracleModelPool';
import type { BriefingCandidate } from '../lib/briefingDetector';
import { launchAgentJob, getAgentJob, cancelAgentJob, isAgentJobTerminal } from '../lib/agentClient';
import type { AgentJobFull } from '../lib/agentClient';
import { modelHasVision } from '../lib/modelScoring';
import { streamOpenRouterCompletion } from '../lib/openrouter';
import { streamWithTokenGovernor } from '../lib/tokenGovernor';
import { pickVoice, resolveVoiceModel } from '../lib/oracleVoices';
import { MAX_CHAT_ATTACHMENT_CHARS, screenChatAttachments } from '../lib/chatAttachments';
import { summarizeTitle, isDefaultTitle, DEFAULT_ORACLE_TITLE, oracleThreadLabel, threadSummaryLine } from '../lib/titleUtils';
import { useSpeech } from '../hooks/useSpeech';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { sanitizeDictationInput } from '../lib/speechUtils';
import { useOpenRouterCredits } from '../hooks/useOpenRouterCredits';
import {
  saveOracleToDrive,
  loadOracleFromDrive,
  mergeOracleThreads,
  DriveUnreadError,
  DriveAuthRequiredError,
  DRIVE_AUTH_RESTORED_EVENT,
} from '../lib/drivePersistence';
import { addTombstone, AGENT_LOST_ON_REDEPLOY, DRIVE_UNREAD_MESSAGE, mergeTombstones } from '../lib/syncContract';
import { copyToClipboard } from '../lib/clipboard';
import { buildCaseBrief, parseChamberCommand, type ChamberHandoff } from '../lib/chamberHandoff';
import { applyOracleRewrite, hydrateBible, renderBiblePrompt } from '../lib/bibleClaims';
import { MessageMarkdown } from './MessageMarkdown';
import type { RawOpenRouterModel } from '../types';

const ORACLE_SYSTEM_PROMPT = `You are The Oracle — a persistent, autonomous advisor with long-term memory.
You are given a "Living Memory" (this thread's Bible) and a Global Bible that summarize everything established so far. Use them to stay consistent and current.
Answer the user directly, decisively, and with clear structure when the topic warrants it. When web search is enabled and the question needs current facts, ground your answer in live sources.
Never mention the Bibles or your internal reflection unless the user asks.`;

const REFLECT_PROMPT = `You are The Oracle's fast internal planner. Given the Living Memory and the user's latest message, produce a short plan (2-4 bullet points) for your answer and note any Bible facts that will need updating. Keep it under 60 words.`;

const BIBLE_SYSTEM_PROMPT = `You maintain a thread's working notes (unsealed). Lines under LAW are sealed and must be copied forward verbatim — never reword, drop, or contradict them. Add only new working notes. Return ONLY the notes as short bullets — no preamble, no code fences.`;

const GLOBAL_BIBLE_SYSTEM_PROMPT = `You maintain unsealed working notes for a shared Global Bible. Lines under LAW are sealed: copy them forward verbatim. Never rewrite or omit LAW. Add only new durable notes (preferences, facts). Return ONLY short bullets — no preamble, no code fences.`;

function stripFences(text: string): string {
  return (text || '').replace(/^```[a-zA-Z]*\s*\n?/gm, '').replace(/```$/gm, '').trim();
}

function buildThreadBiblePrompt(bible: string, userText: string, answerText: string, filesBlock: string): string {
  return `Current Thread Bible:\n${bible || '(empty)'}\n\nLatest exchange:\nUser: ${userText}${filesBlock}\n\nAssistant: ${answerText}\n\nProduce the updated Thread Bible.`;
}

function buildGlobalBiblePrompt(global: string, threadBible: string, userText: string, answerText: string): string {
  return `Current Global Bible:\n${global || '(empty)'}\n\nLatest thread digest:\nThread Bible:\n${threadBible || '(empty)'}\n\nLatest exchange:\nUser: ${userText}\nAssistant: ${answerText}\n\nProduce the updated Global Bible.`;
}

export interface OracleViewProps {
  isSignedIn?: boolean;
  catalog?: RawOpenRouterModel[];
  availableModels?: { id: string; name: string }[];
  onOpenSettings?: (tab?: 'personas' | 'presets' | 'advanced' | 'oracle_bible' | 'theme' | 'notifications' | 'account' | 'diagnostics') => void;
  onHandoffToChamber?: (handoff: ChamberHandoff) => void;
}

export const OracleView: React.FC<OracleViewProps> = ({
  isSignedIn = false,
  catalog = [],
  availableModels = [],
  onOpenSettings,
  onHandoffToChamber,
}) => {
  const [threads, setThreads] = useState<OracleThread[]>(() => loadOracleThreads());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const loaded = loadOracleThreads();
    return loaded[0]?.id || null;
  });
  const [globalBible, setGlobalBible] = useState<OracleBible>(() => loadGlobalBible());
  const [isBusy, setIsBusy] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState<{ id: string; text: string; headerNote?: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [driveSyncState, setDriveSyncState] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle');
  const [lastDriveSync, setLastDriveSync] = useState<number | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const deletedRef = useRef(loadOracleTombstones());
  const [customModels, setCustomModels] = useState<OracleCustomModel[]>(() => loadCustomOracleModels());
  const [briefingStoreVersion, setBriefingStoreVersion] = useState(0);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  // Server-run briefing (the agent loop lives in server.ts; survives tab close).
  const [serverBriefingJob, setServerBriefingJob] = useState<AgentJobFull | null>(null);
  const serverBriefingIdRef = useRef<string | null>(null);
  const [threadDraftTitle, setThreadDraftTitle] = useState('');
  const [confirmClearThreadId, setConfirmClearThreadId] = useState<string | null>(null);

  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const globalBibleRef = useRef(globalBible);
  globalBibleRef.current = globalBible;
  const liveAnswerRef = useRef(liveAnswer);
  liveAnswerRef.current = liveAnswer;
  const abortRef = useRef<AbortController | null>(null);

  // Reload threads when they are edited outside the Oracle view (Settings → Oracle tab).
  useEffect(() => {
    const handleUpdated = () => {
      const loaded = loadOracleThreads();
      threadsRef.current = loaded;
      setThreads(loaded);
      setActiveId((prev) => (loaded.some((t) => t.id === prev) ? prev : loaded[0]?.id || null));
      // The custom model pool / direct palette may have changed too.
      setCustomModels(loadCustomOracleModels());
    };
    const handleBriefingsUpdated = () => setBriefingStoreVersion((v) => v + 1);
    window.addEventListener(ORACLE_THREADS_UPDATED_EVENT, handleUpdated);
    window.addEventListener(ORACLE_BRIEFINGS_UPDATED_EVENT, handleBriefingsUpdated);
    void hydrateOracleFromIdb().then(() => {
      const loaded = loadOracleThreads();
      threadsRef.current = loaded;
      setThreads(loaded);
      setActiveId((prev) => (loaded.some((t) => t.id === prev) ? prev : loaded[0]?.id || null));
      const gb = loadGlobalBible();
      globalBibleRef.current = gb;
      setGlobalBible(gb);
      deletedRef.current = loadOracleTombstones();
    });
    return () => {
      window.removeEventListener(ORACLE_THREADS_UPDATED_EVENT, handleUpdated);
      window.removeEventListener(ORACLE_BRIEFINGS_UPDATED_EVENT, handleBriefingsUpdated);
    };
  }, []);

  const { speak, stop, speakingId, loadingId, voice: activeVoice, setVoice, availableVoices } = useSpeech();
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const { credits, refresh: refreshCredits } = useOpenRouterCredits();

  const activeThread = threads.find((t) => t.id === activeId) || null;

  // Ensure a thread exists on first mount.
  useEffect(() => {
    if (threads.length === 0) {
      const t = newOracleThread();
      setThreads([t]);
      setActiveId(t.id);
    }
  }, [threads.length]);

  // Curated roster + the owner's custom models, each classified against the
  // live catalog (source of truth). Used by the vision guard and rotation.
  const combinedModelOptions = useMemo(
    () => buildOracleModelOptions(catalog, customModels),
    [catalog, customModels]
  );

  // Unasked Verdict: locally detect topics the owner keeps circling across
  // threads (zero tokens) and offer a council briefing on the top candidate.
  const briefingCandidate: BriefingCandidate | null = useMemo(() => {
    try {
      const store = loadBriefingStore();
      if (!store.settings.enabled) return null;
      const candidates = filterBriefingCandidates(
        detectBriefingCandidates(threads, {
          minMentions: store.settings.minMentions,
          lookbackDays: store.settings.lookbackDays,
        }),
        store
      );
      return candidates[0] || null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, briefingStoreVersion]);

  const [driveEpoch, setDriveEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setDriveEpoch((n) => n + 1);
    window.addEventListener(DRIVE_AUTH_RESTORED_EVENT, bump);
    return () => window.removeEventListener(DRIVE_AUTH_RESTORED_EVENT, bump);
  }, []);

  // Drive sync
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      setDriveSyncState('syncing');
      try {
        const remote = await loadOracleFromDrive();
        if (!cancelled && remote) {
          const { merged, deleted } = mergeOracleThreads(
            threadsRef.current,
            remote.threads,
            deletedRef.current,
            remote.deleted
          );
          deletedRef.current = deleted;
          saveOracleTombstones(deleted);
          threadsRef.current = merged;
          setThreads(merged);
          try {
            saveOracleThreads(merged);
          } catch (err: any) {
            setPersistError(err?.message || 'Could not save locally.');
          }
          setActiveId((prev) => (merged.some((t: any) => t.id === prev) ? prev : merged[0]?.id || null));
          if (remote.globalBible) {
            const gb = hydrateBible(remote.globalBible);
            globalBibleRef.current = gb;
            setGlobalBible(gb);
            saveGlobalBible(gb);
          }
          setLastDriveSync(Date.now());
        }
        setDriveSyncState('saved');
      } catch (err) {
        console.warn('[Oracle] Drive load failed:', err);
        setDriveSyncState('error');
        if (err instanceof DriveUnreadError) {
          setPersistError(DRIVE_UNREAD_MESSAGE);
        } else if (err instanceof DriveAuthRequiredError) {
          setPersistError(err.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, driveEpoch]);

  // Debounced save to Drive
  const driveSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isSignedIn) return;
    if (driveSaveTimer.current) clearTimeout(driveSaveTimer.current);
    driveSaveTimer.current = setTimeout(() => {
      setDriveSyncState('syncing');
      saveOracleToDrive(threadsRef.current, globalBibleRef.current, deletedRef.current)
        .then((doc) => {
          deletedRef.current = mergeTombstones(deletedRef.current, doc.deleted);
          saveOracleTombstones(deletedRef.current);
          threadsRef.current = doc.threads;
          setThreads(doc.threads);
          setDriveSyncState('saved');
          setLastDriveSync(Date.now());
        })
        .catch((err) => {
          console.warn('[Oracle] Drive save failed:', err);
          setDriveSyncState('error');
          if (err instanceof DriveUnreadError) {
            setPersistError(DRIVE_UNREAD_MESSAGE);
          } else if (err instanceof DriveAuthRequiredError) {
            setPersistError(err.message);
          }
        });
    }, 4000);
    return () => {
      if (driveSaveTimer.current) clearTimeout(driveSaveTimer.current);
    };
  }, [threads, globalBible, isSignedIn]);

  const persistAll = useCallback((next: OracleThread[]) => {
    threadsRef.current = next;
    setThreads(next);
    try {
      saveOracleThreads(next);
      setPersistError(null);
    } catch (err: any) {
      setPersistError(
        err?.message || 'Could not save this turn locally (storage full). Last good copy is still on this device.'
      );
    }
  }, []);

  const commitThread = useCallback((updated: OracleThread) => {
    persistAll(threadsRef.current.map((t) => (t.id === updated.id ? updated : t)));
  }, [persistAll]);

  const handleNewThread = () => {
    const t = newOracleThread(activeThread?.model);
    if (activeThread) {
      // Rosters and toggles copy over. Mode always starts Direct so a
      // failing Auto-Rotate thread does not follow you into a fresh chat.
      t.mode = 'direct';
      t.miniDeliberationModels = [
        ...(activeThread.miniDeliberationModels && activeThread.miniDeliberationModels.length > 0
          ? activeThread.miniDeliberationModels
          : DEFAULT_MINI_DELIBERATION_MODELS),
      ];
      t.rotationModels = [
        ...(activeThread.rotationModels && activeThread.rotationModels.length > 0
          ? activeThread.rotationModels
          : DEFAULT_ROTATION_ROSTER),
      ];
      t.reflectEnabled = activeThread.reflectEnabled;
      t.webEnabled = activeThread.webEnabled;
      t.rotateVoices = activeThread.rotateVoices;
      t.rotateVoiceModels = activeThread.rotateVoiceModels;
    }
    const next = [t, ...threadsRef.current];
    persistAll(next);
    setActiveId(t.id);
  };

  const handleDeleteThread = (id: string) => {
    const next = threadsRef.current.filter((t) => t.id !== id);
    deletedRef.current = addTombstone(deletedRef.current, id);
    saveOracleTombstones(deletedRef.current);
    persistAll(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
  };

  const patchThread = (id: string, patch: Partial<OracleThread>) => {
    const thread = threadsRef.current.find((t) => t.id === id);
    if (!thread) return;
    commitThread({ ...thread, ...patch, updatedAt: Date.now() });
  };

  const handleConveneBriefing = () => {
    const candidate = briefingCandidate;
    if (!candidate || isBusy) return;
    const t = newOracleThread(activeThread?.model || ORACLE_DEFAULT_MODEL);
    t.title = `Council Briefing — ${capitalizeLabel(candidate.label)}`;
    t.mode = 'mini_deliberation';
    t.miniDeliberationModels = [
      ...(activeThread?.miniDeliberationModels && activeThread.miniDeliberationModels.length > 0
        ? activeThread.miniDeliberationModels
        : DEFAULT_MINI_DELIBERATION_MODELS),
    ];
    t.webEnabled = activeThread?.webEnabled ?? true;
    t.reflectEnabled = activeThread?.reflectEnabled ?? true;
    t.rotateVoices = false;
    persistAll([t, ...threadsRef.current]);
    setActiveId(t.id);
    recordBriefingConvened(candidate.key);
    const text = `Please convene a full mini-council on this recurring question: ${candidate.label}\n\nMy latest framing:\n${candidate.sample}`;
    void handleSend(text, [], [], undefined, false, t.id);
  };

  const handleDismissBriefing = () => {
    if (briefingCandidate) dismissBriefingTopic(briefingCandidate.key);
  };

  /**
   * Server-run briefing: the agent loop plans, researches (live citations),
   * and deliberates inside server.ts, then folds the verdict back into a
   * briefing thread. Survives tab close.
   */
  const handleConveneBriefingOnServer = async () => {
    const candidate = briefingCandidate;
    if (!candidate || isBusy || serverBriefingIdRef.current) return;
    const model = activeThread?.model || ORACLE_DEFAULT_MODEL;
    try {
      const { id } = await launchAgentJob({
        goal: `Convene a council briefing on this recurring question: ${candidate.label}. My latest framing: ${candidate.sample}`,
        mode: 'oracle',
        model,
        budget: 'cheap',
        maxResearchQueries: 3,
        maxDeliberationPasses: 1,
        maxJobCostUSD: 1.0,
      });
      serverBriefingIdRef.current = id;
      setServerBriefingJob({
        id,
        goal: candidate.label,
        mode: 'oracle',
        status: 'planning',
        progress: { phase: 'planning', detail: 'Server briefing launched — you can close this tab.' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        usageUSD: 0,
        citations: 0,
        plan: null,
        research: [],
        passes: [],
        verdict: '',
        citationsList: [],
      });
      recordBriefingConvened(candidate.key);
      const tick = async () => {
        const jobId = serverBriefingIdRef.current;
        if (!jobId) return;
        try {
          const job = await getAgentJob(jobId);
          if (!job) {
            serverBriefingIdRef.current = null;
            setServerBriefingJob(null);
            setPersistError(AGENT_LOST_ON_REDEPLOY);
            return;
          }
          setServerBriefingJob(job);
          if (!isAgentJobTerminal(job.status)) {
            window.setTimeout(tick, 4000);
            return;
          }
          serverBriefingIdRef.current = null;
          // Fold the verdict into a new briefing thread.
          const t = newOracleThread(model);
          t.title = `Council Briefing — ${capitalizeLabel(candidate.label)}`;
          t.mode = 'mini_deliberation';
          t.webEnabled = activeThread?.webEnabled ?? true;
          t.reflectEnabled = activeThread?.reflectEnabled ?? true;
          t.rotateVoices = false;
          const sourcesBlock =
            (job.citationsList || []).length > 0
              ? `\n\n**Sources**\n${job.citationsList
                  .slice(0, 8)
                  .map((s) => `- [${s.title || s.url}](${s.url})`)
                  .join('\n')}`
              : '';
          const content =
            job.status === 'done'
              ? `${job.verdict}${sourcesBlock}`
              : `⚠️ The server briefing ${job.status === 'stopped_budget' ? 'hit its cost cap before finishing' : job.status === 'failed' ? 'failed' : 'was interrupted'}. What it had so far:\n\n${job.passes[job.passes.length - 1]?.consensus || job.error || '(nothing)'}`;
          t.messages = [
            {
              id: `brief_${Date.now()}`,
              role: 'user',
              content: `Please convene a full mini-council on this recurring question: ${candidate.label}\n\nMy latest framing:\n${candidate.sample}`,
              timestamp: Date.now(),
            },
            {
              id: `brief_${Date.now()}_a`,
              role: 'assistant',
              content,
              model,
              timestamp: Date.now() + 1,
            },
          ];
          t.updatedAt = Date.now();
          persistAll([t, ...threadsRef.current]);
          setActiveId(t.id);
          setServerBriefingJob(null);
        } catch (err) {
          console.warn('[Oracle] Server briefing poll failed:', err);
          window.setTimeout(tick, 6000);
        }
      };
      window.setTimeout(tick, 1500);
    } catch (err: any) {
      console.warn('[Oracle] Server briefing launch failed:', err);
      setServerBriefingJob(null);
    }
  };

  const handleCancelServerBriefing = () => {
    const id = serverBriefingIdRef.current;
    if (!id) return;
    void cancelAgentJob(id).catch(() => {});
    serverBriefingIdRef.current = null;
    setServerBriefingJob(null);
  };

  const handleClearActiveThreadMessages = (threadId: string) => {
    patchThread(threadId, { messages: [] });
    setConfirmClearThreadId(null);
  };

  const commitThreadRename = (threadId: string) => {
    const clean = threadDraftTitle.trim();
    if (clean) {
      patchThread(threadId, { title: clean });
    }
    setEditingThreadId(null);
    setThreadDraftTitle('');
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleDismissMessage = (msgId: string) => {
    if (!activeId) return;
    const thread = threadsRef.current.find((t) => t.id === activeId);
    if (!thread) return;
    const cleaned = thread.messages.filter((m) => m.id !== msgId);
    commitThread({ ...thread, messages: cleaned, updatedAt: Date.now() });
  };

  const handleRetryMessage = async (failedMsgId: string, fallbackModel?: string) => {
    if (!activeId || isBusy) return;
    const thread = threadsRef.current.find((t) => t.id === activeId);
    if (!thread) return;
    const msgIdx = thread.messages.findIndex((m) => m.id === failedMsgId);
    if (msgIdx === -1) return;

    // Find the latest user message preceding this error
    const precedingUserMsg = [...thread.messages.slice(0, msgIdx)].reverse().find((m) => m.role === 'user');
    if (!precedingUserMsg) return;

    // Remove the error message from the thread
    const cleaned = thread.messages.filter((m) => m.id !== failedMsgId);
    const unstickToAuto = fallbackModel === ORACLE_ERROR_RETRY_MODEL;
    const updatedThread: OracleThread = {
      ...thread,
      model: unstickToAuto ? fallbackModel : thread.model,
      mode: unstickToAuto ? 'direct' : thread.mode,
      turnCount:
        !unstickToAuto && thread.mode === 'rotation'
          ? (thread.turnCount || 0) + 1
          : thread.turnCount,
      messages: cleaned,
      updatedAt: Date.now(),
    };
    commitThread(updatedThread);

    // Auto retry is an escape hatch: Direct + openrouter/auto.
    // Regular retry in rotation advances the roster so we don't re-hit the dead id.
    await handleSend(
      precedingUserMsg.content,
      precedingUserMsg.images || [],
      precedingUserMsg.files || [],
      unstickToAuto ? fallbackModel : undefined,
      true
    );
  };

  const handoffToChamber = (questionOverride?: string) => {
    if (!onHandoffToChamber) return;
    const thread = threadsRef.current.find((t) => t.id === activeId) || threadsRef.current[0];
    if (!thread) return;
    const handoff = buildCaseBrief({
      threadId: thread.id,
      threadTitle: thread.title,
      question: questionOverride,
      messages: thread.messages,
      threadBible: renderBiblePrompt(thread.bible),
      globalBible: renderBiblePrompt(globalBibleRef.current),
    });
    onHandoffToChamber(handoff);
  };

  const handleSend = async (
    text: string,
    images: OracleImage[],
    files: OracleTextFile[],
    modelOverride?: string,
    isRetry = false,
    threadIdOverride?: string
  ) => {
    const cmd = parseChamberCommand(text);
    if (cmd.isCommand && onHandoffToChamber) {
      handoffToChamber(cmd.question);
      return;
    }
    if (!text.trim() && images.length === 0 && files.length === 0) return;
    const targetThreadId = threadIdOverride || activeId;
    if (!targetThreadId || isBusy) return;
    const thread = threadsRef.current.find((t) => t.id === targetThreadId);
    if (!thread) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const now = Date.now();
    const effectiveModel = modelOverride || thread.model;

    let latest: OracleThread;
    if (isRetry) {
      latest = {
        ...thread,
        model: effectiveModel,
        updatedAt: now,
      };
    } else {
      const userMsg: OracleMessage = {
        id: `m_${now}_u`,
        role: 'user',
        content: text.trim(),
        images: images.length ? images : undefined,
        files: files.length ? files : undefined,
        timestamp: now,
      };
      latest = {
        ...thread,
        model: effectiveModel,
        title: isDefaultTitle(thread.title) ? summarizeTitle(text, DEFAULT_ORACLE_TITLE) : thread.title,
        messages: [...thread.messages, userMsg],
        updatedAt: now,
      };
    }
    commitThread(latest);
    setIsBusy(true);

    const history = latest.messages.filter((m) => !m.error).slice(-12);

    const filesBlock = files.length
      ? '\n\n[Attached Files]:\n' + files.map((f) => `--- ${f.name} ---\n${f.content}`).join('\n\n')
      : '';
    const contextBlock = `[Your Living Memory (Thread Bible)]:\n${renderBiblePrompt(latest.bible) || '(empty)'}\n\n[Global Bible]:\n${renderBiblePrompt(globalBibleRef.current) || '(empty)'}`;

    const mode = latest.mode || 'direct';
    let attemptedModel = effectiveModel;

    try {
      // 1. Reflect (internal plan + Bible facts to update).
      let reflection = '';
      if (latest.reflectEnabled) {
        try {
          const ref = await streamOpenRouterCompletion({
            model: effectiveModel,
            messages: [
              { role: 'system', content: REFLECT_PROMPT },
              { role: 'user', content: `${contextBlock}\n\n[User message]:\n${text}` },
            ],
            maxTokens: 400,
            signal: controller.signal,
          });
          reflection = ref.content || '';
        } catch (err) {
          console.warn('[Oracle] Reflection step failed (continuing):', err);
        }
      }

      // 2. Answer generation (Direct, Mini Deliberation, or Model Rotation)
      const enrichedText =
        `${contextBlock}` +
        (reflection ? `\n\n[Internal Reflection / Plan]:\n${reflection}` : '') +
        `\n\n[User message]:\n${text}${filesBlock}`;

      const userContent: any =
        images.length > 0
          ? [
              { type: 'text', text: enrichedText },
              ...images.map((im) => ({ type: 'image_url', image_url: { url: im.url } })),
            ]
          : enrichedText;

      // Vision guard: when images are attached, only models that can actually see
      // them should run. Text-only models (including custom entries) get dropped
      // or swapped to a vision-capable fallback, and the swap is surfaced in the
      // answer header note.
      const isModelVisionOk = (modelId: string): boolean => {
        const opt = combinedModelOptions.find((o) => o.id === modelId);
        if (opt) return opt.vision;
        const entry = Array.isArray(catalog)
          ? catalog.find((m) => m?.id?.toLowerCase() === modelId.toLowerCase())
          : undefined;
        return entry ? modelHasVision(entry) : true; // unknown → lenient (offline)
      };
      let visionNote: string | undefined;
      let visionSafePanelModels: string[] | undefined;
      if (images.length > 0 && mode === 'mini_deliberation') {
        const roster =
          latest.miniDeliberationModels && latest.miniDeliberationModels.length > 0
            ? latest.miniDeliberationModels
            : DEFAULT_MINI_DELIBERATION_MODELS;
        const visionFallback = pickLiveVisionFallback(catalog);
        const { safe, dropped, usedFallback } = filterVisionSafeRoster(
          roster,
          isModelVisionOk,
          visionFallback
        );
        if (usedFallback) {
          visionSafePanelModels = safe;
          visionNote = `No vision-capable models in the panel — all routed to ${visionFallback.split('/').pop()}. `;
        } else if (dropped.length > 0) {
          visionSafePanelModels = safe;
          visionNote = `Panel limited to vision-capable models: ${safe.map((m) => m.split('/').pop()).join(', ')}. `;
        }
      }

      const answerId = `m_${now}_a`;

      let answerText = '';
      let answerModelUsed = effectiveModel;
      let govNote: string | undefined;
      let rotateNote: string | undefined;
      let usedVoice: { id: string; name: string; avatar: string } | undefined;

      if (mode === 'mini_deliberation') {
        // --- MINI DELIBERATION MODE ---
        const deliberationModels =
          visionSafePanelModels ||
          (latest.miniDeliberationModels && latest.miniDeliberationModels.length > 0
            ? latest.miniDeliberationModels
            : DEFAULT_MINI_DELIBERATION_MODELS);

        setLiveAnswer({
          id: answerId,
          text: '',
          headerNote: `${visionNote || ''}Mini Deliberation (${deliberationModels.map((m) => m.split('/').pop()).join(', ')})...`.trim(),
        });

        // Parallel proposal gathering with resilient error suppression
        const proposals = await Promise.allSettled(
          deliberationModels.map(async (mId) => {
            const res = await streamOpenRouterCompletion({
              model: mId,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are an expert advisor in a rapid council deliberation. Provide a concise, decisive perspective with core insights and actionable recommendations.',
                },
                ...history.map((m) => ({ role: m.role, content: m.content })),
                { role: 'user', content: userContent },
              ],
              maxTokens: 1000,
              signal: controller.signal,
            });
            return { model: mId, content: res.content || '' };
          })
        );

        const fulfilled = proposals.filter(
          (p): p is PromiseFulfilledResult<{ model: string; content: string }> =>
            p.status === 'fulfilled' && Boolean(p.value.content?.trim())
        );

        let validProposals = '';
        if (fulfilled.length > 0) {
          validProposals = fulfilled
            .map((p) => `### Model (${p.value.model.split('/').pop()}):\n${p.value.content}`)
            .join('\n\n');
        }

        setLiveAnswer({
          id: answerId,
          text: '',
          headerNote:
            fulfilled.length > 0
              ? `Synthesizing consensus across ${fulfilled.length} models...`
              : `Synthesizing authoritative council response...`,
        });

        const synthesisPrompt = validProposals
          ? `[User Request]:\n${text}${filesBlock}\n\n[Model Panel Perspectives]:\n${validProposals}\n\nSynthesize the authoritative answer:`
          : `[User Request]:\n${text}${filesBlock}\n\nProvide the authoritative council answer:`;

        // Synthesis pass
        const synthRes = await streamWithTokenGovernor({
          model: effectiveModel,
          messages: [
            {
              role: 'system',
              content: `${ORACLE_SYSTEM_PROMPT}\n\nYou are presiding over a Mini Deliberation. Below are the perspectives gathered from multiple frontier models. Synthesize them into one decisive, comprehensive, well-structured answer. Acknowledge key consensus points and distinct insights.`,
            },
            {
              role: 'user',
              content: synthesisPrompt,
            },
          ],
          baseMaxTokens: 2000,
          webSearch: latest.webEnabled,
          query: text,
          signal: controller.signal,
          governorKey: latest.id,
          onToken: (chunk) =>
            setLiveAnswer((prev) => (prev ? { ...prev, text: prev.text + chunk } : prev)),
        });

        answerText = synthRes.content || '';
        answerModelUsed = fulfilled.length > 0 ? `Mini Deliberation (${fulfilled.length} models)` : effectiveModel;
        govNote = fulfilled.length > 0
          ? `Synthesized consensus from ${fulfilled.map((m) => m.value.model.split('/').pop()).join(', ')}`
          : undefined;
      } else {
        // --- DIRECT OR ROTATION MODE ---
        let selectedModel = effectiveModel;
        if (mode === 'rotation' && !modelOverride) {
          // Skip ids the live catalog no longer has. All-dead roster → Auto.
          const isLive = (id: string) =>
            !Array.isArray(catalog) || catalog.length === 0
              ? true
              : catalog.some((m) => m?.id?.toLowerCase() === id.toLowerCase());
          selectedModel = resolveRotationModel(
            latest.turnCount || 0,
            latest.rotationModels,
            DEFAULT_ROTATION_ROSTER,
            isLive
          );
        }
        attemptedModel = selectedModel;

        const voice = latest.rotateVoices ? pickVoice(latest.turnCount || 0) : null;
        if (voice) {
          usedVoice = { id: voice.id, name: voice.name, avatar: voice.avatar };
        }

        const systemPrompt = voice
          ? `${ORACLE_SYSTEM_PROMPT}\n\n[Voice for this turn: ${voice.name}]\n${voice.prompt}`
          : ORACLE_SYSTEM_PROMPT;

        const threadModelIsFree = (selectedModel || '').endsWith(':free');
        // Validate the voice's model against the live catalog: a delisted
        // voice model must fall back to the thread model WITH a visible note,
        // not fire a provider 404 into the chat (Auto-Rotate error storm fix).
        const isLive = (id: string) =>
          !Array.isArray(catalog) || catalog.length === 0
            ? true
            : catalog.some((m) => m?.id?.toLowerCase() === id.toLowerCase());
        const voiceResolution = resolveVoiceModel(voice, {
          threadModel: selectedModel,
          modelPerVoice: Boolean(latest.rotateVoiceModels),
          threadModelIsFree,
          isLive,
        });
        if (voiceResolution.note) rotateNote = voiceResolution.note;
        let answerModel = voiceResolution.model;

        // Vision guard for direct/rotation: swap a text-only model when images are attached.
        if (images.length > 0 && !isModelVisionOk(answerModel)) {
          const visionFallback = pickLiveVisionFallback(catalog);
          visionNote = `${answerModel.split('/').pop()} can't read images — routed to ${visionFallback.split('/').pop()} instead. `;
          answerModel = visionFallback;
        }

        setLiveAnswer({ id: answerId, text: '', headerNote: [visionNote, rotateNote].filter(Boolean).join(' ') || undefined });

        const res = await streamWithTokenGovernor({
          model: answerModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userContent },
          ],
          baseMaxTokens: 1600,
          webSearch: latest.webEnabled,
          query: text,
          signal: controller.signal,
          governorKey: latest.id,
          onToken: (chunk) =>
            setLiveAnswer((prev) => (prev ? { ...prev, text: prev.text + chunk } : prev)),
        });

        if (res.expansions > 0) govNote = `auto-expanded tokens ×${res.expansions}`;
        answerText = res.content || '';
        answerModelUsed = res.actualModel || answerModel;
      }

      setLiveAnswer(null);

      const assistantMsg: OracleMessage = {
        id: answerId,
        role: 'assistant',
        content: answerText,
        timestamp: Date.now(),
        model: answerModelUsed,
        voice: usedVoice,
        note: [visionNote, rotateNote, govNote].filter(Boolean).join(' ') || undefined,
      };

      latest = {
        ...latest,
        // A successful turn resolves every error before it — prune the storm
        // litter instead of leaving dead [Error: …] bubbles hanging in the chat.
        messages: pruneStaleOracleErrors([...latest.messages, assistantMsg]),
        turnCount: (latest.turnCount || 0) + 1,
        updatedAt: Date.now(),
      };
      commitThread(latest);

      // 3. Update the thread Bible in the background
      try {
        const bibleRes = await streamOpenRouterCompletion({
          model: effectiveModel,
          messages: [
            { role: 'system', content: BIBLE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildThreadBiblePrompt(latest.bible?.content || '', text, answerText, filesBlock),
            },
          ],
          maxTokens: 800,
          signal: controller.signal,
        });
        const newBible = stripFences(bibleRes.content || '');
        if (newBible) {
          latest = {
            ...latest,
            bible: applyOracleRewrite(latest.bible, newBible),
            updatedAt: Date.now(),
          };
          commitThread(latest);
        }
      } catch (err) {
        console.warn('[Oracle] Thread Bible background update failed:', err);
      }

      // 4. Update the Global Bible in the background
      try {
        const gbRes = await streamOpenRouterCompletion({
          model: effectiveModel,
          messages: [
            { role: 'system', content: GLOBAL_BIBLE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildGlobalBiblePrompt(
                globalBibleRef.current.content,
                latest.bible?.content || '',
                text,
                answerText
              ),
            },
          ],
          maxTokens: 800,
          signal: controller.signal,
        });
        const newGlobal = stripFences(gbRes.content || '');
        if (newGlobal) {
          const nextGb = applyOracleRewrite(globalBibleRef.current, newGlobal);
          globalBibleRef.current = nextGb;
          setGlobalBible(nextGb);
          try {
            saveGlobalBible(nextGb);
          } catch (err: any) {
            setPersistError(err?.message || 'Could not save the Bible (storage full).');
          }
        }
      } catch (err) {
        console.warn('[Oracle] Global Bible background update failed:', err);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        const partial = liveAnswerRef.current?.text || '';
        if (partial.trim()) {
          const partialMsg: OracleMessage = {
            id: `m_${now}_partial`,
            role: 'assistant',
            content: partial + '\n\n_[stopped by user]_',
            timestamp: Date.now(),
          };
          commitThread({ ...latest, messages: [...latest.messages, partialMsg], updatedAt: Date.now() });
        }
      } else {
        const rawErr = err?.message || String(err);
        recordError('oracle', 'Oracle Generation Error', err, {
          model: attemptedModel,
          threadId: latest.id,
          mode: latest.mode,
          webEnabled: latest.webEnabled,
          reflectEnabled: latest.reflectEnabled,
        }, attemptedModel);
        const errMsg: OracleMessage = {
          id: `m_${now}_err`,
          role: 'assistant',
          content: rawErr.startsWith('[Error:') ? rawErr : `[Error: ${rawErr}]`,
          timestamp: Date.now(),
          error: true,
          model: attemptedModel,
        };
        // Advance the rotation pointer on failure so the next attempt picks a
        // DIFFERENT voice/model instead of re-picking the same dead one —
        // this is the "errors forever and never fixes" half of the storm.
        commitThread({
          ...latest,
          messages: [...latest.messages, errMsg],
          turnCount: (latest.turnCount || 0) + 1,
          updatedAt: Date.now(),
        });
      }
      setLiveAnswer(null);
    } finally {
      abortRef.current = null;
      setIsBusy(false);
    }
  };

  const handleExport = () => {
    const json = exportOracleThreads(threadsRef.current, globalBibleRef.current, {
      customModels: loadCustomOracleModels(),
      directList: loadOracleDirectList(),
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oracle-threads-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = importOracleThreads(String(reader.result || ''));
      if (result.success && result.threads) {
        const { merged } = mergeOracleThreads(threadsRef.current, result.threads);
        persistAll(merged);
        setActiveId(merged[0]?.id || null);
        if (result.globalBible) {
          const gb = hydrateBible(result.globalBible);
          globalBibleRef.current = gb;
          setGlobalBible(gb);
          saveGlobalBible(gb);
        }
        // Restore the custom model pool and Direct palette from the export.
        if (result.extras?.customModels && result.extras.customModels.length > 0) {
          const existing = new Set(loadCustomOracleModels().map((m) => m.id));
          const mergedCustom = [
            ...loadCustomOracleModels(),
            ...result.extras.customModels.filter((m) => m && m.id && !existing.has(m.id)),
          ];
          saveCustomOracleModels(mergedCustom);
          setCustomModels(loadCustomOracleModels());
        }
        if (result.extras?.directList && result.extras.directList.length > 0) {
          saveOracleDirectList(result.extras.directList);
        }
      } else {
        console.warn('[Oracle] Import failed:', result.message);
      }
    };
    reader.readAsText(file);
  };

  const handleCopy = (id: string, text: string) => {
    copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const currentMode = activeThread?.mode || 'direct';

  return (
    <div className="min-h-[calc(100vh-65px)] bg-slate-950 text-slate-100 p-3 sm:p-4 font-sans">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 p-4 bg-gradient-to-r from-indigo-950/60 via-slate-900 to-fuchsia-950/60 border border-indigo-500/30 rounded-3xl">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-tr from-indigo-500 to-fuchsia-500 rounded-2xl shadow-lg text-slate-950">
              <BookOpen size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 via-fuchsia-200 to-cyan-200">
                  The Oracle — Living Assistant
                </h1>
                <button
                  type="button"
                  onClick={() => onOpenSettings?.('oracle_bible')}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-300 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 px-2.5 py-1 rounded-full cursor-pointer transition-colors shadow-sm"
                  title="View & manage Living Memory (Bible) in Settings"
                >
                  <BookOpen size={11} className="text-indigo-400" />
                  <span>Living Memory Bible</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Persistent multimodal companion with continuous background memory synthesis & multi-model deliberation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={refreshCredits}
              className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
              title={
                credits.limit !== null
                  ? `OpenRouter credits — used $${credits.usage.toFixed(2)} of $${credits.limit.toFixed(2)}. Click to refresh.`
                  : 'OpenRouter credits (click to refresh)'
              }
            >
              <Wallet size={13} className="text-emerald-400" />
              {credits.limit !== null ? (
                <span>
                  <span className="text-emerald-400">${credits.remaining?.toFixed(2)}</span>
                  <span className="text-slate-500"> / ${credits.limit.toFixed(2)}</span>
                </span>
              ) : credits.loading ? (
                <span className="text-slate-500">…</span>
              ) : (
                <span className="text-slate-500">credits —</span>
              )}
            </button>
            {onHandoffToChamber && (
              <button
                type="button"
                onClick={() => handoffToChamber()}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 cursor-pointer shadow-sm disabled:opacity-50"
                title="Send a one-page Case brief to the Chamber. Does not copy the thread. Does not write the Bible."
              >
                <Users size={13} />
                <span>Send to Chamber</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleNewThread}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shadow-md"
            >
              <Plus size={13} />
              <span>New Thread</span>
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
              title="Export threads + Bibles"
            >
              <Download size={13} />
            </button>
            <label
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
              title="Import threads + Bibles"
            >
              <Upload size={13} />
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
              />
            </label>
            {isSignedIn && (
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-xl border ${
                  driveSyncState === 'error'
                    ? 'bg-red-950/70 text-red-300 border-red-700/60'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
                title={
                  lastDriveSync
                    ? `Drive sync — last saved ${new Date(lastDriveSync).toLocaleTimeString()}`
                    : 'Drive sync'
                }
              >
                <Cloud
                  size={13}
                  className={driveSyncState === 'syncing' ? 'animate-pulse text-cyan-400' : 'text-emerald-400'}
                />
                {driveSyncState === 'syncing' ? 'Syncing' : driveSyncState === 'error' ? 'Sync error' : 'Drive'}
              </span>
            )}
          </div>
        </header>

        {persistError && (
          <div className="flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-amber-950">
            <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-sm leading-relaxed">
              <div className="font-semibold">Could not save this turn</div>
              <p className="text-amber-900/90 mt-0.5">{persistError}</p>
            </div>
            <button
              type="button"
              onClick={() => setPersistError(null)}
              className="text-amber-800 hover:text-amber-950 p-1 cursor-pointer"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Unasked Verdict — a topic the owner keeps circling across threads */}
        {briefingCandidate && (
          <div className="flex items-center gap-3 flex-wrap p-3.5 bg-gradient-to-r from-amber-950/70 via-slate-900 to-slate-900 border border-amber-600/40 rounded-2xl shadow-lg">
            <span className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/40 shrink-0">
              <Sparkles size={16} className="text-amber-300" />
            </span>
            <div className="flex-1 min-w-[240px] text-xs text-slate-300 leading-relaxed">
              <span className="font-semibold text-amber-200">You've circled this one a few times.</span>{' '}
              Asked about{' '}
              <span className="font-mono text-amber-300">“{briefingCandidate.label}”</span> in{' '}
              {briefingCandidate.threads} thread{briefingCandidate.threads === 1 ? '' : 's'} across{' '}
              {briefingCandidate.mentions} question{briefingCandidate.mentions === 1 ? '' : 's'}. Want a
              council briefing on it?
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleConveneBriefing}
                disabled={isBusy || Boolean(serverBriefingJob)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold cursor-pointer shadow-md transition-colors"
                title="Convene a mini-council to settle this recurring question"
              >
                <Sparkles size={13} />
                Convene mini-council
              </button>
              <button
                type="button"
                onClick={handleConveneBriefingOnServer}
                disabled={isBusy || Boolean(serverBriefingJob)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-sky-300 hover:text-sky-200 border border-sky-700/60 hover:border-sky-500 cursor-pointer disabled:opacity-50"
                title="Run the briefing on the server: it plans, researches with live citations, and deliberates — close the tab and it keeps working"
              >
                ☁ on server
              </button>
              <button
                type="button"
                onClick={handleDismissBriefing}
                disabled={isBusy}
                className="inline-flex items-center px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 cursor-pointer disabled:opacity-50"
                title="Snooze this suggestion (a new mention will bring it back)"
              >
                Later
              </button>
            </div>
          </div>
        )}

        {/* Live server-briefing progress */}
        {serverBriefingJob && (
          <div className="flex items-center gap-3 flex-wrap p-3 bg-sky-950/50 border border-sky-700/50 rounded-2xl text-xs">
            <Loader2 size={14} className="text-sky-300 animate-spin shrink-0" />
            <div className="flex-1 min-w-[200px] text-slate-300">
              <span className="font-semibold text-sky-200">Server briefing</span> —{' '}
              {serverBriefingJob.progress.detail}
              {serverBriefingJob.usageUSD > 0 && (
                <span className="font-mono text-[10px] text-slate-400"> · ${serverBriefingJob.usageUSD.toFixed(4)} USD</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleCancelServerBriefing}
              className="text-[11px] text-slate-400 hover:text-red-300 border border-slate-700 hover:border-red-500/60 px-2 py-1 rounded-lg cursor-pointer"
              title="Cancel the server briefing"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Controls and Thread Strip */}
        <div className="flex flex-col space-y-3">
          {/* Thread list & Execution Modes */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 bg-slate-900/80 border border-slate-800 rounded-2xl">
            {/* Threads tabs */}
            <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
              {threads.map((t) => {
                const tPrompt = t.messages?.find((m) => m?.role === 'user' && (m.content || '').trim())?.content;
                const tLabel = oracleThreadLabel(t.title, tPrompt);
                const tSummary = threadSummaryLine({ initialPrompt: tPrompt });
                return (
                <div
                  key={t.id}
                  className={`group/thread flex items-center gap-1 p-0.5 rounded-xl border transition-all ${
                    t.id === activeId
                      ? 'bg-indigo-950/60 border-indigo-500/60 text-white shadow-xs'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {editingThreadId === t.id ? (
                    <input
                      autoFocus
                      value={threadDraftTitle}
                      onChange={(e) => setThreadDraftTitle(e.target.value)}
                      onBlur={() => commitThreadRename(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitThreadRename(t.id);
                        } else if (e.key === 'Escape') {
                          setEditingThreadId(null);
                          setThreadDraftTitle('');
                        }
                      }}
                      className="bg-slate-900 text-white text-xs px-2 py-1 rounded-lg border border-indigo-400 focus:outline-none w-[130px]"
                      aria-label="Rename thread"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveId(t.id)}
                      className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer max-w-[150px] truncate ${
                        t.id === activeId ? 'text-white font-semibold' : 'text-slate-300 hover:text-white'
                      }`}
                      title={tSummary && tSummary !== tLabel ? `${tLabel}\n\n${tSummary}` : tLabel}
                    >
                      {tLabel}
                    </button>
                  )}

                  {editingThreadId !== t.id && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingThreadId(t.id);
                        setThreadDraftTitle(t.title);
                      }}
                      className="opacity-0 group-hover/thread:opacity-100 text-slate-500 hover:text-cyan-400 p-1 cursor-pointer transition-opacity"
                      title="Rename thread"
                      aria-label={`Rename thread ${t.title}`}
                    >
                      <Pencil size={11} />
                    </button>
                  )}

                  {threads.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteThread(t.id)}
                      className="text-slate-500 hover:text-red-400 p-1 cursor-pointer"
                      title="Delete thread"
                      aria-label={`Delete thread ${t.title}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                );
              })}

              <button
                type="button"
                onClick={handleNewThread}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 cursor-pointer transition-colors"
                title="Start a new Oracle thread"
              >
                <Plus size={12} />
                <span className="font-medium">New Thread</span>
              </button>

              {/* Dynamic Clear Messages for Active Thread */}
              {activeThread && activeThread.messages && activeThread.messages.length > 0 && (
                <div className="flex items-center">
                  {confirmClearThreadId === activeThread.id ? (
                    <div className="flex items-center gap-1 bg-red-950/80 border border-red-600/60 rounded-xl px-2 py-0.5 animate-fadeIn">
                      <span className="text-[11px] text-red-300 font-medium">Clear messages?</span>
                      <button
                        type="button"
                        onClick={() => handleClearActiveThreadMessages(activeThread.id)}
                        className="text-[11px] bg-red-600 hover:bg-red-500 text-white font-bold px-1.5 py-0.5 rounded cursor-pointer"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearThreadId(null)}
                        className="text-[11px] text-slate-400 hover:text-white px-1 py-0.5 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearThreadId(activeThread.id)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-xl bg-slate-950 hover:bg-red-950/40 text-slate-400 hover:text-red-400 border border-slate-800 hover:border-red-500/30 transition-colors cursor-pointer"
                      title="Clear messages in active thread"
                    >
                      <Eraser size={11} />
                      <span className="text-[11px]">Clear Messages</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Mode & Deliberation Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Execution Mode Selector */}
              <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { mode: 'direct' })}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                    currentMode === 'direct'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Direct single-model answer"
                >
                  Direct
                </button>
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { mode: 'mini_deliberation' })}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                    currentMode === 'mini_deliberation'
                      ? 'bg-fuchsia-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Mini Deliberation: Parallel multi-model debate + synthesized consensus"
                >
                  <Sparkles size={11} />
                  Mini Deliberation
                </button>
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { mode: 'rotation' })}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                    currentMode === 'rotation'
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Auto-Rotate: cycles through your chosen frontier models turn-by-turn (automated)"
                >
                  <RefreshCw size={11} />
                  Auto-Rotate
                </button>
              </div>

              {/* Model & Modes now live in Settings → Oracle (kept off the main page) */}
              <button
                type="button"
                onClick={() => onOpenSettings?.('oracle_bible')}
                className="inline-flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-800 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                title="Model, mode & roster configuration — Settings → Oracle"
                aria-label="Model and modes settings"
              >
                <Sliders size={12} className="text-fuchsia-400" />
                <span>
                  {currentMode === 'direct'
                    ? 'Model & Modes'
                    : currentMode === 'mini_deliberation'
                      ? 'Deliberation Panel'
                      : 'Auto-Rotate Roster'}
                </span>
              </button>

              {/* Toggles */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { reflectEnabled: !activeThread?.reflectEnabled })}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border cursor-pointer ${
                    activeThread?.reflectEnabled
                      ? 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60'
                      : 'bg-slate-950 text-slate-500 border-slate-800'
                  }`}
                  title="Internal planner reflection"
                >
                  <Brain size={12} />
                  Reflect
                </button>
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { webEnabled: !activeThread?.webEnabled })}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border cursor-pointer ${
                    activeThread?.webEnabled
                      ? 'bg-cyan-950/70 text-cyan-300 border-cyan-700/60'
                      : 'bg-slate-950 text-slate-500 border-slate-800'
                  }`}
                  title="Live web grounding"
                >
                  <Globe size={12} />
                  Web
                </button>
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { rotateVoices: !activeThread?.rotateVoices })}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border cursor-pointer ${
                    activeThread?.rotateVoices !== false
                      ? 'bg-fuchsia-950/70 text-fuchsia-300 border-fuchsia-700/60'
                      : 'bg-slate-950 text-slate-500 border-slate-800'
                  }`}
                  title="Rotate analytical voice personalities"
                >
                  <Users size={12} />
                  Voices
                </button>

                {/* Google AI Studio Neural Voice Selector */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-slate-950 hover:bg-slate-800 text-cyan-300 border-cyan-500/40 hover:border-cyan-400/70 cursor-pointer transition-colors"
                    title="Select Google AI Studio Neural Voice for Speak Aloud"
                  >
                    <Volume2 size={12} className="text-cyan-400" />
                    <span className="font-semibold text-[11px]">TTS: {activeVoice}</span>
                    <ChevronDown size={11} className="text-slate-400" />
                  </button>

                  {showVoiceDropdown && (
                    <div className="absolute right-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 text-xs space-y-1 animate-fadeIn">
                      <div className="px-2 py-1 text-[10px] uppercase font-mono tracking-wider text-slate-400 border-b border-slate-800 flex items-center justify-between">
                        <span>Google Neural TTS</span>
                        <span className="text-[9px] text-cyan-400 font-sans">Gemini Flash TTS</span>
                      </div>
                      {availableVoices.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setVoice(v.id);
                            setShowVoiceDropdown(false);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors flex items-start justify-between cursor-pointer ${
                            activeVoice === v.id
                              ? 'bg-cyan-950/80 text-cyan-200 border border-cyan-700/50'
                              : 'hover:bg-slate-800/80 text-slate-300'
                          }`}
                        >
                          <div>
                            <div className="font-semibold flex items-center gap-1.5">
                              <span>{v.name}</span>
                              <span className="text-[9px] font-mono text-cyan-400/90 bg-cyan-950/60 px-1 py-0.2 rounded border border-cyan-800/40">{v.tone}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{v.description}</p>
                          </div>
                          {activeVoice === v.id && <Check size={13} className="text-cyan-400 mt-0.5 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Full-width Main Conversation Area */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-4 sm:p-5 space-y-4 min-h-[460px] max-h-[68vh] overflow-y-auto shadow-xl">
            {(!activeThread || activeThread.messages.length === 0) && !liveAnswer && (
              <div className="text-center text-slate-500 text-sm py-20 font-mono space-y-2">
                <p>Ask The Oracle anything.</p>
                <p className="text-xs text-slate-600">
                  {currentMode === 'mini_deliberation'
                    ? '✨ Mini Deliberation mode active: top frontier models will debate in parallel and synthesize an aligned consensus.'
                    : currentMode === 'rotation'
                      ? '🔄 Auto-Rotate active: cycles through top frontier models each turn.'
                      : '⚡ Direct mode active: swift responses with self-updating Living Memory.'}
                </p>
              </div>
            )}

            {activeThread?.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                copiedId={copiedId}
                speakingId={speakingId}
                loadingId={loadingId}
                activeVoice={activeVoice}
                onCopy={handleCopy}
                onSpeak={(text, id) => (speakingId === id ? stop() : speak(text, id))}
                onRetry={handleRetryMessage}
                onDismiss={handleDismissMessage}
                onOpenDiagnostics={onOpenSettings ? () => onOpenSettings('diagnostics') : undefined}
              />
            ))}

            {liveAnswer && (
              <div className="flex justify-start">
                <div className="max-w-[88%] p-4 bg-indigo-950/60 border border-indigo-700/50 rounded-2xl text-xs shadow-lg space-y-2">
                  <div className="flex items-center gap-2 text-indigo-300 font-semibold">
                    <Sparkles size={13} className="animate-pulse text-fuchsia-400" />
                    <span>The Oracle</span>
                    <span className="font-mono text-[10px] text-indigo-400/80 animate-pulse">
                      {liveAnswer.headerNote || 'streaming response…'}
                    </span>
                  </div>
                  <MessageMarkdown content={liveAnswer.text || '…'} />
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <OracleComposer
            onSend={handleSend}
            isBusy={isBusy}
            onStop={handleStop}
            onHandoffToChamber={onHandoffToChamber ? () => handoffToChamber() : undefined}
          />
        </div>
      </div>
    </div>
  );
};

function MessageBubble({
  message,
  copiedId,
  speakingId,
  loadingId,
  activeVoice,
  onCopy,
  onSpeak,
  onRetry,
  onDismiss,
  onOpenDiagnostics,
}: {
  message: OracleMessage;
  copiedId: string | null;
  speakingId: string | null;
  loadingId?: string | null;
  activeVoice?: string;
  onCopy: (id: string, text: string) => void;
  onSpeak: (text: string, id: string) => void;
  onRetry?: (id: string, fallbackModel?: string) => void;
  onDismiss?: (id: string) => void;
  onOpenDiagnostics?: () => void;
}) {
  const isUser = message.role === 'user';
  const speakId = `speak-${message.id}`;
  const copyId = `copy-${message.id}`;

  if (message.error) {
    const rawContent = message.content.replace(/^\[Error:\s*/i, '').replace(/\]$/, '');
    return (
      <div className="flex justify-start">
        <div className="max-w-[88%] p-4 rounded-2xl text-xs bg-red-950/40 border border-red-800/60 text-red-200 space-y-3 shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-red-900/50 pb-2">
            <div className="flex items-center gap-2 text-red-300 font-semibold">
              <AlertCircle size={14} className="text-red-400" />
              <span>Generation Error</span>
              {message.model && (
                <span className="font-mono text-[10px] bg-red-900/50 text-red-300 px-2 py-0.5 rounded border border-red-800/60">
                  {message.model.split('/').pop()}
                </span>
              )}
            </div>
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(message.id)}
                className="text-red-400/70 hover:text-red-200 p-1 rounded transition-colors cursor-pointer"
                title="Dismiss error"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <p className="text-xs text-red-200/90 font-mono leading-relaxed bg-red-950/80 p-2.5 rounded-xl border border-red-900/60">
            {rawContent}
          </p>

          <div className="flex items-center gap-2 flex-wrap pt-1">
            {onRetry && (
              <>
                <button
                  type="button"
                  onClick={() => onRetry(message.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800/70 text-red-100 font-medium transition-colors border border-red-700/60 cursor-pointer"
                >
                  <RotateCcw size={12} />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRetry(message.id, ORACLE_ERROR_RETRY_MODEL)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900/90 text-indigo-200 font-medium transition-colors border border-indigo-700/60 cursor-pointer"
                  title="OpenRouter Auto seats a live model and the reply chip shows which one answered"
                >
                  <Sparkles size={12} className="text-cyan-400" />
                  <span>Retry via OpenRouter Auto</span>
                </button>
              </>
            )}
            {onOpenDiagnostics && (
              <button
                type="button"
                onClick={onOpenDiagnostics}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-cyan-300 hover:text-cyan-200 transition-colors border border-slate-700/70 cursor-pointer"
                title="Inspect in Event Log & Diagnostics"
              >
                <Activity size={12} className="text-cyan-400" />
                <span>Event Log</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onCopy(copyId, rawContent)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors border border-slate-800 cursor-pointer ml-auto"
              title="Copy error details"
            >
              {copiedId === copyId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copiedId === copyId ? 'Copied' : 'Copy Log'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] p-4 rounded-2xl text-xs border ${
          isUser
            ? 'bg-cyan-950/50 border-cyan-700/40 text-slate-100'
            : 'bg-indigo-950/60 border-indigo-700/50 text-slate-100'
        }`}
      >
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`font-semibold ${isUser ? 'text-cyan-300' : 'text-indigo-300'}`}>
            {isUser ? 'You' : 'The Oracle'}
          </span>
          {!isUser && message.voice && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-fuchsia-300 bg-fuchsia-950/50 border border-fuchsia-800/50 px-1.5 py-0.5 rounded-full">
              <span>{message.voice.avatar}</span>
              <span>{message.voice.name}</span>
            </span>
          )}
          {message.model && !isUser && (
            <span className="font-mono text-[10px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded-md border border-slate-800">
              {message.model.split('/').pop()}
            </span>
          )}
          {message.note && !isUser && (
            <span className="font-mono text-[9px] text-amber-300/80">{message.note}</span>
          )}
          {!isUser && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={() => onSpeak(message.content, speakId)}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  speakingId === speakId
                    ? 'text-cyan-300 bg-cyan-950 border border-cyan-500/50 shadow-sm animate-pulse'
                    : loadingId === speakId
                    ? 'text-amber-300 bg-amber-950/50 border border-amber-500/40'
                    : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60'
                }`}
                title={
                  speakingId === speakId
                    ? 'Stop reading aloud'
                    : loadingId === speakId
                    ? 'Generating Google AI neural voice...'
                    : `Read aloud (Google Neural Voice: ${activeVoice || 'Kore'})`
                }
              >
                {loadingId === speakId ? (
                  <Loader2 size={13} className="text-amber-400 animate-spin" />
                ) : speakingId === speakId ? (
                  <VolumeX size={13} className="text-cyan-400" />
                ) : (
                  <Volume2 size={13} />
                )}
              </button>
              <button
                type="button"
                onClick={() => onCopy(copyId, message.content)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-slate-800/60 cursor-pointer transition-colors"
                title="Copy"
              >
                {copiedId === copyId ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>
            </div>
          )}
        </div>

        {message.images && message.images.length > 0 && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {message.images.map((im, i) => (
              <img
                key={i}
                src={im.url}
                alt={im.name}
                className="max-h-40 rounded-lg border border-slate-700 object-contain"
              />
            ))}
          </div>
        )}

        <MessageMarkdown content={message.content} />

        {message.files && message.files.length > 0 && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {message.files.map((f, i) => (
              <span
                key={i}
                className="text-[10px] font-mono text-slate-400 bg-slate-900/70 border border-slate-700 px-1.5 py-0.5 rounded"
              >
                {f.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OracleComposer({
  onSend,
  isBusy,
  onStop,
  onHandoffToChamber,
}: {
  onSend: (text: string, images: OracleImage[], files: OracleTextFile[]) => void;
  isBusy: boolean;
  onStop: () => void;
  onHandoffToChamber?: () => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<OracleImage[]>([]);
  const [files, setFiles] = useState<OracleTextFile[]>([]);
  const [attachWarning, setAttachWarning] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dictation (speech-to-text).
  const preTextRef = useRef('');
  const { supported: sttSupported, isListening, error: sttError, toggle: toggleDictation } = useSpeechRecognition(
    ({ transcript }) => {
      const base = preTextRef.current;
      setText(sanitizeDictationInput(base, transcript));
    }
  );
  const handleMic = () => {
    if (isListening) {
      toggleDictation();
    } else {
      preTextRef.current = text;
      toggleDictation();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [text]);

  const handleImages = async (list: FileList | null) => {
    if (!list) return;
    const out: OracleImage[] = [];
    for (const file of Array.from(list)) {
      if (!file.type.startsWith('image/')) continue;
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      out.push({ name: file.name, url });
    }
    setImages((prev) => [...prev, ...out]);
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list) return;
    const read: OracleTextFile[] = [];
    for (const file of Array.from(list)) {
      if (file.type.startsWith('image/')) continue;
      try {
        const content = await file.text();
        read.push({ name: file.name, content });
      } catch (err) {
        console.warn('[Oracle] Could not read file', file.name, err);
      }
    }
    // Chat attachments ride inline in one message — refuse oversize files
    // visibly instead of silently slicing them to fit.
    const { accepted, rejected } = screenChatAttachments(read);
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    if (rejected.length > 0) {
      setAttachWarning(
        `${rejected.map((r) => `${r.name} (${r.chars.toLocaleString()} chars)`).join(', ')} — too large for a chat attachment (cap ${MAX_CHAT_ATTACHMENT_CHARS.toLocaleString()}). Nothing was sliced. Attach it in Nexus Lab instead: big exhibits are read part-by-part, every page.`
      );
      window.setTimeout(() => setAttachWarning(null), 12_000);
    }
  };

  const submit = () => {
    if (isBusy) return;
    if (!text.trim() && images.length === 0 && files.length === 0) return;
    onSend(text, images, files);
    setText('');
    setImages([]);
    setFiles([]);
  };

  return (
    <div className="bg-slate-900/95 border border-slate-700/80 rounded-2xl p-2.5 space-y-2">
      {(images.length > 0 || files.length > 0) && (
        <div className="flex gap-1.5 flex-wrap">
          {images.map((im, i) => (
            <span
              key={`img-${i}`}
              className="flex items-center gap-1 text-[10px] font-mono text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded"
            >
              <FileImage size={11} className="text-fuchsia-400" />
              {im.name}
              <button
                type="button"
                onClick={() => setImages((p) => p.filter((_, x) => x !== i))}
                className="text-slate-500 hover:text-red-400 cursor-pointer"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {files.map((f, i) => (
            <span
              key={`file-${i}`}
              className="flex items-center gap-1 text-[10px] font-mono text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded"
            >
              <FileText size={11} className="text-cyan-400" />
              {f.name}
              <button
                type="button"
                onClick={() => setFiles((p) => p.filter((_, x) => x !== i))}
                className="text-slate-500 hover:text-red-400 cursor-pointer"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {attachWarning && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/60 px-2 py-1.5 rounded">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{attachWarning}</span>
          <button
            type="button"
            onClick={() => setAttachWarning(null)}
            className="text-amber-500 hover:text-amber-300 cursor-pointer ml-auto mt-0.5"
            aria-label="Dismiss attachment warning"
          >
            <X size={11} />
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder="Ask The Oracle… (Ctrl+Enter to send)"
        className="w-full bg-slate-950/70 text-slate-100 placeholder-slate-500 text-xs p-3 rounded-xl border border-slate-800 focus:outline-none focus:border-indigo-500 resize-none"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleImages(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isBusy}
            className="inline-flex items-center gap-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer disabled:opacity-50"
          >
            <FileImage size={13} className="text-fuchsia-400" />
            Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="inline-flex items-center gap-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer disabled:opacity-50"
          >
            <Paperclip size={13} className="text-cyan-400" />
            File
          </button>
          {sttSupported && (
            <button
              type="button"
              onClick={handleMic}
              disabled={isBusy}
              title={
                sttError
                  ? sttError
                  : isListening
                    ? 'Stop dictation'
                    : 'Dictate (speech-to-text)'
              }
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer disabled:opacity-50 transition-colors ${
                isListening
                  ? 'bg-red-950/80 text-red-200 border-red-600 shadow-sm animate-pulse'
                  : 'text-slate-300 bg-slate-800 hover:bg-slate-700 border-slate-700'
              }`}
            >
              <Mic size={13} className={isListening ? 'text-red-400' : 'text-emerald-400'} />
              <span>{isListening ? 'Listening…' : 'Dictate'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onHandoffToChamber && (
            <button
              type="button"
              onClick={onHandoffToChamber}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 cursor-pointer disabled:opacity-50"
              title="Type /chamber or tap here. Sends a Case brief, not the transcript."
            >
              <Users size={13} />
              Chamber
            </button>
          )}
          {isBusy && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl cursor-pointer shadow-md"
            >
              <Square size={13} />
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={isBusy || (!text.trim() && images.length === 0 && files.length === 0)}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:opacity-50 text-white rounded-xl cursor-pointer shadow-md"
          >
            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            <span>{isBusy ? 'Thinking…' : 'Send'}</span>
          </button>
        </div>
      </div>

      {sttError && (
        <div className="flex items-center gap-2 text-[11px] text-amber-300 bg-amber-950/60 border border-amber-800/60 px-3 py-1.5 rounded-xl">
          <AlertCircle size={13} className="text-amber-400 shrink-0" />
          <span>{sttError}</span>
        </div>
      )}
    </div>
  );
}
