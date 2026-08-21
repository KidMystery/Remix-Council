import React, { useState, useRef, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import {
  OracleThread,
  OracleBible,
  OracleMessage,
  OracleImage,
  OracleTextFile,
  newOracleThread,
  loadOracleThreads,
  saveOracleThreads,
  loadGlobalBible,
  saveGlobalBible,
  exportOracleThreads,
  importOracleThreads,
  ORACLE_MODEL_OPTIONS,
} from '../lib/oracleStore';
import { streamOpenRouterCompletion } from '../lib/openrouter';
import { streamWithTokenGovernor } from '../lib/tokenGovernor';
import { pickVoice } from '../lib/oracleVoices';
import { summarizeTitle } from '../lib/titleUtils';
import { useSpeech } from '../hooks/useSpeech';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useOpenRouterCredits } from '../hooks/useOpenRouterCredits';
import { saveOracleToDrive, loadOracleFromDrive } from '../lib/drivePersistence';
import { copyToClipboard } from '../lib/clipboard';
import { MessageMarkdown } from './MessageMarkdown';

const ORACLE_SYSTEM_PROMPT = `You are The Oracle — a persistent, autonomous advisor with long-term memory.
You are given a "Living Memory" (this thread's Bible) and a Global Bible that summarize everything established so far. Use them to stay consistent and current.
Answer the user directly, decisively, and with clear structure when the topic warrants it. When web search is enabled and the question needs current facts, ground your answer in live sources.
Never mention the Bibles or your internal reflection unless the user asks.`;

const REFLECT_PROMPT = `You are The Oracle's fast internal planner. Given the Living Memory and the user's latest message, produce a short plan (2-4 bullet points) for your answer and note any Bible facts that will need updating. Keep it under 60 words.`;

const BIBLE_SYSTEM_PROMPT = `You maintain a thread's Living Bible: a concise, current, self-contained summary of everything established in this conversation (facts, decisions, preferences, constraints, open questions). Merge new confirmed information, preserve user-stated facts verbatim, drop stale or contradicted details. Use compact sections. Return ONLY the updated Bible — no preamble, no code fences.`;

const GLOBAL_BIBLE_SYSTEM_PROMPT = `You maintain a shared Global Bible: durable, cross-conversation knowledge distilled from all threads. Merge the incoming digest, deduplicate, keep it concise and organized by topic. Return ONLY the updated Global Bible — no preamble, no code fences.`;

function stripFences(text: string): string {
  return (text || '').replace(/^```[a-zA-Z]*\s*\n?/gm, '').replace(/```$/gm, '').trim();
}

function buildThreadBiblePrompt(bible: string, userText: string, answerText: string, filesBlock: string): string {
  return `Current Thread Bible:\n${bible || '(empty)'}\n\nLatest exchange:\nUser: ${userText}${filesBlock}\n\nAssistant: ${answerText}\n\nProduce the updated Thread Bible.`;
}

function buildGlobalBiblePrompt(global: string, threadBible: string, userText: string, answerText: string): string {
  return `Current Global Bible:\n${global || '(empty)'}\n\nLatest thread digest:\nThread Bible:\n${threadBible || '(empty)'}\n\nLatest exchange:\nUser: ${userText}\nAssistant: ${answerText}\n\nProduce the updated Global Bible.`;
}

export const OracleView: React.FC<{ isSignedIn?: boolean }> = ({ isSignedIn = false }) => {
  const [threads, setThreads] = useState<OracleThread[]>(() => loadOracleThreads());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const loaded = loadOracleThreads();
    return loaded[0]?.id || null;
  });
  const [globalBible, setGlobalBible] = useState<OracleBible>(() => loadGlobalBible());
  const [isBusy, setIsBusy] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState<{ id: string; text: string } | null>(null);
  const [bibleTab, setBibleTab] = useState<'thread' | 'global'>('thread');
  const [bibleDraft, setBibleDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [driveSyncState, setDriveSyncState] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle');
  const [lastDriveSync, setLastDriveSync] = useState<number | null>(null);

  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const globalBibleRef = useRef(globalBible);
  globalBibleRef.current = globalBible;
  const liveAnswerRef = useRef(liveAnswer);
  liveAnswerRef.current = liveAnswer;
  const abortRef = useRef<AbortController | null>(null);

  const { speak, stop, speakingId } = useSpeech();
  const { credits, refresh: refreshCredits } = useOpenRouterCredits();

  const activeThread = threads.find((t) => t.id === activeId) || null;

  // Ensure a thread exists on first mount.
  useEffect(() => {
    if (threads.length === 0) {
      const t = newOracleThread();
      setThreads([t]);
      setActiveId(t.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync the editable Bible draft when tab/thread changes.
  useEffect(() => {
    if (bibleTab === 'thread') {
      setBibleDraft(activeThread?.bible?.content || '');
    } else {
      setBibleDraft(globalBible.content || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bibleTab, activeId, activeThread?.bible?.updatedAt, globalBible.updatedAt]);

  // ---- Drive sync ----
  // Load from Drive on mount / sign-in (only replaces local when Drive has data).
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      setDriveSyncState('syncing');
      try {
        const remote = await loadOracleFromDrive();
        if (!cancelled && remote && remote.threads.length > 0) {
          threadsRef.current = remote.threads;
          setThreads(remote.threads);
          setActiveId((prev) => (remote.threads.some((t: any) => t.id === prev) ? prev : remote.threads[0]?.id || null));
          if (remote.globalBible) {
            globalBibleRef.current = remote.globalBible;
            setGlobalBible(remote.globalBible);
          }
          setLastDriveSync(Date.now());
        }
        setDriveSyncState('saved');
      } catch (err) {
        console.warn('[Oracle] Drive load failed:', err);
        setDriveSyncState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Debounced save to Drive whenever threads / global Bible change.
  const driveSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isSignedIn) return;
    if (driveSaveTimer.current) clearTimeout(driveSaveTimer.current);
    driveSaveTimer.current = setTimeout(() => {
      setDriveSyncState('syncing');
      saveOracleToDrive(threadsRef.current, globalBibleRef.current)
        .then(() => {
          setDriveSyncState('saved');
          setLastDriveSync(Date.now());
        })
        .catch((err) => {
          console.warn('[Oracle] Drive save failed:', err);
          setDriveSyncState('error');
        });
    }, 4000);
    return () => {
      if (driveSaveTimer.current) clearTimeout(driveSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, globalBible, isSignedIn]);

  const commitThread = useCallback((updated: OracleThread) => {
    const next = threadsRef.current.map((t) => (t.id === updated.id ? updated : t));
    threadsRef.current = next;
    setThreads(next);
    saveOracleThreads(next);
  }, []);

  const handleNewThread = () => {
    const t = newOracleThread(activeThread?.model);
    const next = [t, ...threadsRef.current];
    threadsRef.current = next;
    setThreads(next);
    setActiveId(t.id);
    saveOracleThreads(next);
  };

  const handleDeleteThread = (id: string) => {
    const next = threadsRef.current.filter((t) => t.id !== id);
    threadsRef.current = next;
    setThreads(next);
    if (activeId === id) setActiveId(next[0]?.id || null);
    saveOracleThreads(next);
  };

  const patchThread = (id: string, patch: Partial<OracleThread>) => {
    const thread = threadsRef.current.find((t) => t.id === id);
    if (!thread) return;
    commitThread({ ...thread, ...patch, updatedAt: Date.now() });
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSend = async (text: string, images: OracleImage[], files: OracleTextFile[]) => {
    if (!text.trim() && images.length === 0 && files.length === 0) return;
    if (!activeId || isBusy) return;
    const thread = threadsRef.current.find((t) => t.id === activeId);
    if (!thread) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const now = Date.now();
    const history = thread.messages.slice(-12);
    const userMsg: OracleMessage = {
      id: `m_${now}_u`,
      role: 'user',
      content: text.trim(),
      images: images.length ? images : undefined,
      files: files.length ? files : undefined,
      timestamp: now,
    };

    let latest: OracleThread = {
      ...thread,
      title: thread.title === 'New Conversation' || !thread.title ? summarizeTitle(text) : thread.title,
      messages: [...thread.messages, userMsg],
      updatedAt: now,
    };
    commitThread(latest);
    setIsBusy(true);

    const filesBlock = files.length
      ? '\n\n[Attached Files]:\n' + files.map((f) => `--- ${f.name} ---\n${f.content}`).join('\n\n')
      : '';
    const contextBlock = `[Your Living Memory (Thread Bible)]:\n${thread.bible?.content || '(empty)'}\n\n[Global Bible]:\n${globalBibleRef.current.content || '(empty)'}`;

    try {
      // 1. Reflect (internal plan + Bible facts to update).
      let reflection = '';
      if (thread.reflectEnabled) {
        try {
          const ref = await streamOpenRouterCompletion({
            model: thread.model,
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

      // 2. Answer (streamed, with images when present).
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

      // Rotating voice: pick the next persona this turn (budget-safe — same model).
      const voice = thread.rotateVoices ? pickVoice(thread.turnCount || 0) : null;
      const systemPrompt = voice
        ? `${ORACLE_SYSTEM_PROMPT}\n\n[Voice for this turn: ${voice.name}]\n${voice.prompt}`
        : ORACLE_SYSTEM_PROMPT;

      // "Model per voice" rotation: only for paid-tier models, and never when
      // images need vision the voice model can't provide.
      const threadModelIsFree = (thread.model || '').endsWith(':free');
      const voiceModelWanted =
        voice && thread.rotateVoiceModels && !threadModelIsFree && voice.model;
      const visionCapable = (id: string) =>
        ORACLE_MODEL_OPTIONS.find((m) => m.id === id)?.vision !== false;
      const answerModel =
        voiceModelWanted &&
        (!images.length || visionCapable(voice.model!))
          ? voice.model!
          : thread.model;

      const answerId = `m_${now}_a`;
      setLiveAnswer({ id: answerId, text: '' });

      let govNote: string | undefined;
      const res = await streamWithTokenGovernor({
        model: answerModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: userContent },
        ],
        baseMaxTokens: 1600,
        webSearch: thread.webEnabled,
        query: text,
        signal: controller.signal,
        governorKey: thread.id,
        onToken: (chunk) => setLiveAnswer((prev) => (prev ? { ...prev, text: prev.text + chunk } : prev)),
        onBudgetAdjust: (_budget, direction) => {
          govNote = direction === 'up' ? 'auto-expanded tokens' : 'tokens trimmed to fit';
        },
      });

      if (res.expansions > 0) govNote = `auto-expanded tokens ×${res.expansions}`;

      const answerText = res.content || '';
      const answerModelUsed = res.actualModel || answerModel;
      setLiveAnswer(null);

      const assistantMsg: OracleMessage = {
        id: answerId,
        role: 'assistant',
        content: answerText,
        timestamp: Date.now(),
        model: answerModelUsed,
        voice: voice ? { id: voice.id, name: voice.name, avatar: voice.avatar } : undefined,
        note: govNote,
      };
      latest = {
        ...latest,
        messages: [...latest.messages, assistantMsg],
        turnCount: (latest.turnCount || 0) + 1,
        updatedAt: Date.now(),
      };
      commitThread(latest);

      // 3. Update the thread Bible.
      try {
        const bibleRes = await streamOpenRouterCompletion({
          model: thread.model,
          messages: [
            { role: 'system', content: BIBLE_SYSTEM_PROMPT },
            { role: 'user', content: buildThreadBiblePrompt(latest.bible?.content || '', text, answerText, filesBlock) },
          ],
          maxTokens: 800,
          signal: controller.signal,
        });
        const newBible = stripFences(bibleRes.content || '');
        if (newBible) {
          latest = { ...latest, bible: { content: newBible, updatedAt: Date.now() }, updatedAt: Date.now() };
          commitThread(latest);
        }
      } catch (err) {
        console.warn('[Oracle] Thread Bible update failed:', err);
      }

      // 4. Update the Global Bible.
      try {
        const gbRes = await streamOpenRouterCompletion({
          model: thread.model,
          messages: [
            { role: 'system', content: GLOBAL_BIBLE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildGlobalBiblePrompt(globalBibleRef.current.content, latest.bible?.content || '', text, answerText),
            },
          ],
          maxTokens: 800,
          signal: controller.signal,
        });
        const newGlobal = stripFences(gbRes.content || '');
        if (newGlobal) {
          const nextGb = { content: newGlobal, updatedAt: Date.now() };
          globalBibleRef.current = nextGb;
          setGlobalBible(nextGb);
          saveGlobalBible(nextGb);
        }
      } catch (err) {
        console.warn('[Oracle] Global Bible update failed:', err);
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
        const errMsg: OracleMessage = {
          id: `m_${now}_err`,
          role: 'assistant',
          content: `[Error: ${err?.message || String(err)}]`,
          timestamp: Date.now(),
          error: true,
        };
        commitThread({ ...latest, messages: [...latest.messages, errMsg], updatedAt: Date.now() });
      }
      setLiveAnswer(null);
    } finally {
      abortRef.current = null;
      setIsBusy(false);
    }
  };

  const handleManualBibleSave = () => {
    const clean = bibleDraft.trim();
    if (bibleTab === 'thread') {
      if (activeId) {
        const t = threadsRef.current.find((x) => x.id === activeId);
        if (t) commitThread({ ...t, bible: { content: clean, updatedAt: Date.now() }, updatedAt: Date.now() });
      }
    } else {
      const nextGb = { content: clean, updatedAt: Date.now() };
      globalBibleRef.current = nextGb;
      setGlobalBible(nextGb);
      saveGlobalBible(nextGb);
    }
  };

  const handleExport = () => {
    const json = exportOracleThreads(threadsRef.current, globalBibleRef.current);
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
        threadsRef.current = result.threads;
        setThreads(result.threads);
        setActiveId(result.threads[0]?.id || null);
        saveOracleThreads(result.threads);
        if (result.globalBible) {
          globalBibleRef.current = result.globalBible;
          setGlobalBible(result.globalBible);
          saveGlobalBible(result.globalBible);
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

  return (
    <div className="min-h-[calc(100vh-65px)] bg-slate-950 text-slate-100 p-3 sm:p-4 font-sans">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 p-4 bg-gradient-to-r from-indigo-950/60 via-slate-900 to-fuchsia-950/60 border border-indigo-500/30 rounded-3xl">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-tr from-indigo-500 to-fuchsia-500 rounded-2xl shadow-lg text-slate-950">
              <BookOpen size={22} />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 via-fuchsia-200 to-cyan-200">
                The Oracle — Living Assistant
              </h1>
              <p className="text-xs text-slate-400">Persistent multimodal assistant with a self-maintaining memory Bible</p>
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
            <button
              type="button"
              onClick={handleNewThread}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
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
            <label className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer" title="Import threads + Bibles">
              <Upload size={13} />
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
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
                <Cloud size={13} className={driveSyncState === 'syncing' ? 'animate-pulse text-cyan-400' : 'text-emerald-400'} />
                {driveSyncState === 'syncing' ? 'Syncing' : driveSyncState === 'error' ? 'Sync error' : 'Drive'}
              </span>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: threads + chat */}
          <div className="lg:col-span-8 flex flex-col space-y-3 min-w-0">
            {/* Thread chips + controls */}
            <div className="flex items-center gap-2 flex-wrap p-2 bg-slate-900/80 border border-slate-800 rounded-2xl">
              <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                {threads.map((t) => (
                  <div key={t.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveId(t.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer max-w-[180px] truncate ${
                        t.id === activeId
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-600'
                      }`}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteThread(t.id)}
                      className="text-slate-500 hover:text-red-400 p-1 cursor-pointer"
                      title="Delete thread"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={activeThread?.model || ''}
                  onChange={(e) => activeId && patchThread(activeId, { model: e.target.value })}
                  className="bg-slate-950 text-slate-200 text-xs px-2 py-1.5 rounded-lg border border-slate-800"
                  title="Model"
                >
                  {ORACLE_MODEL_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { reflectEnabled: !activeThread?.reflectEnabled })}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border cursor-pointer ${
                    activeThread?.reflectEnabled
                      ? 'bg-indigo-950/70 text-indigo-300 border-indigo-700/60'
                      : 'bg-slate-950 text-slate-500 border-slate-800'
                  }`}
                  title="Internal reflection step"
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
                  title="Rotate analytical voices each turn (budget-safe — same model)"
                >
                  <Users size={12} />
                  Voices
                </button>
                <button
                  type="button"
                  onClick={() => activeId && patchThread(activeId, { rotateVoiceModels: !activeThread?.rotateVoiceModels })}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border cursor-pointer ${
                    activeThread?.rotateVoiceModels
                      ? 'bg-fuchsia-950/70 text-fuchsia-300 border-fuchsia-700/60'
                      : 'bg-slate-950 text-slate-500 border-slate-800'
                  }`}
                  title="Rotate the model per voice too (budget tier; ignored on free models)"
                >
                  <Sparkles size={12} />
                  Model/voice
                </button>
              </div>
            </div>

            {/* Chat area */}
            <div className="flex-1 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-4 min-h-[320px] max-h-[60vh] overflow-y-auto">
              {(!activeThread || activeThread.messages.length === 0) && !liveAnswer && (
                <div className="text-center text-slate-500 text-sm py-16 font-mono">
                  Ask The Oracle anything. It will deliberate, answer, and update its memory.
                </div>
              )}

              {activeThread?.messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  copiedId={copiedId}
                  speakingId={speakingId}
                  onCopy={handleCopy}
                  onSpeak={(text, id) => (speakingId === id ? stop() : speak(text, id))}
                />
              ))}

              {liveAnswer && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] p-3.5 bg-indigo-950/60 border border-indigo-700/50 rounded-2xl text-xs">
                    <div className="flex items-center gap-2 mb-2 text-indigo-300 font-semibold">
                      <Sparkles size={12} className="animate-pulse" />
                      <span>The Oracle</span>
                      <span className="font-mono text-[10px] text-indigo-400/70 animate-pulse">streaming…</span>
                    </div>
                    <MessageMarkdown content={liveAnswer.text || '…'} />
                  </div>
                </div>
              )}
            </div>

            {/* Composer */}
            <OracleComposer onSend={handleSend} isBusy={isBusy} onStop={handleStop} />
          </div>

          {/* Right: Bible panel */}
          <div className="lg:col-span-4 flex flex-col bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 min-h-[400px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 bg-slate-950 rounded-lg p-0.5 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setBibleTab('thread')}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${bibleTab === 'thread' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}`}
                >
                  Thread Bible
                </button>
                <button
                  type="button"
                  onClick={() => setBibleTab('global')}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${bibleTab === 'global' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}`}
                >
                  Global Bible
                </button>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                {bibleTab === 'thread'
                  ? (activeThread?.bible?.content || '').length
                  : globalBible.content.length}{' '}
                chars
              </span>
            </div>

            <textarea
              value={bibleDraft}
              onChange={(e) => setBibleDraft(e.target.value)}
              rows={14}
              placeholder="The Living Bible will be written here automatically as you converse…"
              className="flex-1 w-full bg-slate-950 text-slate-200 text-xs p-3 rounded-xl border border-slate-800 focus:outline-none focus:border-indigo-500 resize-none font-mono leading-relaxed"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleManualBibleSave}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Save Bible
              </button>
              <span className="text-[10px] text-slate-500 font-mono">
                {bibleTab === 'thread'
                  ? activeThread?.bible?.updatedAt
                    ? `Updated ${new Date(activeThread.bible.updatedAt).toLocaleTimeString()}`
                    : ''
                  : globalBible.updatedAt
                    ? `Updated ${new Date(globalBible.updatedAt).toLocaleTimeString()}`
                    : ''}
              </span>
            </div>

            <p className="text-[10px] text-slate-500 leading-relaxed">
              The Oracle reads this memory on every turn and rewrites it after every answer, so it stays current across the whole conversation. You can edit it by hand too.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

function MessageBubble({
  message,
  copiedId,
  speakingId,
  onCopy,
  onSpeak,
}: {
  message: OracleMessage;
  copiedId: string | null;
  speakingId: string | null;
  onCopy: (id: string, text: string) => void;
  onSpeak: (text: string, id: string) => void;
}) {
  const isUser = message.role === 'user';
  const speakId = `speak-${message.id}`;
  const copyId = `copy-${message.id}`;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] p-3.5 rounded-2xl text-xs border ${
          isUser
            ? 'bg-cyan-950/50 border-cyan-700/40 text-slate-100'
            : message.error
              ? 'bg-red-950/50 border-red-700/50 text-red-200'
              : 'bg-indigo-950/60 border-indigo-700/50 text-slate-100'
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
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
            <span className="font-mono text-[10px] text-slate-400">{message.model.split('/').pop()}</span>
          )}
          {message.note && !isUser && (
            <span className="font-mono text-[9px] text-amber-300/80">{message.note}</span>
          )}
          {!isUser && (
            <div className="flex items-center gap-0.5 ml-auto">
              <button
                type="button"
                onClick={() => onSpeak(message.content, speakId)}
                className="p-1 rounded text-slate-400 hover:text-cyan-300 cursor-pointer"
                title={speakingId === speakId ? 'Stop reading' : 'Read aloud'}
              >
                {speakingId === speakId ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              <button
                type="button"
                onClick={() => onCopy(copyId, message.content)}
                className="p-1 rounded text-slate-400 hover:text-emerald-300 cursor-pointer"
                title="Copy"
              >
                {copiedId === copyId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
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
              <span key={i} className="text-[10px] font-mono text-slate-400 bg-slate-900/70 border border-slate-700 px-1.5 py-0.5 rounded">
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
}: {
  onSend: (text: string, images: OracleImage[], files: OracleTextFile[]) => void;
  isBusy: boolean;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<OracleImage[]>([]);
  const [files, setFiles] = useState<OracleTextFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dictation (speech-to-text).
  const preTextRef = useRef('');
  const { supported: sttSupported, isListening, toggle: toggleDictation } = useSpeechRecognition(
    ({ transcript }) => {
      setText(preTextRef.current + transcript);
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
    const out: OracleTextFile[] = [];
    for (const file of Array.from(list)) {
      if (file.type.startsWith('image/')) continue;
      try {
        const content = await file.text();
        out.push({ name: file.name, content: content.slice(0, 50000) });
      } catch (err) {
        console.warn('[Oracle] Could not read file', file.name, err);
      }
    }
    setFiles((prev) => [...prev, ...out]);
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
            <span key={`img-${i}`} className="flex items-center gap-1 text-[10px] font-mono text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded">
              <FileImage size={11} className="text-fuchsia-400" />
              {im.name}
              <button type="button" onClick={() => setImages((p) => p.filter((_, x) => x !== i))} className="text-slate-500 hover:text-red-400 cursor-pointer">
                <X size={11} />
              </button>
            </span>
          ))}
          {files.map((f, i) => (
            <span key={`file-${i}`} className="flex items-center gap-1 text-[10px] font-mono text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded">
              <FileText size={11} className="text-cyan-400" />
              {f.name}
              <button type="button" onClick={() => setFiles((p) => p.filter((_, x) => x !== i))} className="text-slate-500 hover:text-red-400 cursor-pointer">
                <X size={11} />
              </button>
            </span>
          ))}
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
          <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleImages(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => imageInputRef.current?.click()} disabled={isBusy} className="inline-flex items-center gap-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer disabled:opacity-50">
            <FileImage size={13} className="text-fuchsia-400" />
            Image
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy} className="inline-flex items-center gap-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer disabled:opacity-50">
            <Paperclip size={13} className="text-cyan-400" />
            File
          </button>
          {sttSupported && (
            <button
              type="button"
              onClick={handleMic}
              disabled={isBusy}
              title={isListening ? 'Stop dictation' : 'Dictate (speech-to-text)'}
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer disabled:opacity-50 ${
                isListening
                  ? 'bg-red-950/70 text-red-300 border-red-700/60 animate-pulse'
                  : 'text-slate-300 bg-slate-800 hover:bg-slate-700 border-slate-700'
              }`}
            >
              <Mic size={13} className={isListening ? 'text-red-400' : 'text-emerald-400'} />
              {isListening ? 'Listening…' : 'Dictate'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isBusy && (
            <button type="button" onClick={onStop} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl cursor-pointer">
              <Square size={13} />
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={isBusy || (!text.trim() && images.length === 0 && files.length === 0)}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:opacity-50 text-white rounded-xl cursor-pointer"
          >
            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            <span>{isBusy ? 'Thinking…' : 'Send'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
