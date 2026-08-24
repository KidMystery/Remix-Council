import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, Globe, Save, Copy, Check, Download, Trash2, RefreshCw, MessageSquare, Sliders, X, Plus, Dices, Eye } from 'lucide-react';
import {
  OracleThread,
  OracleBible,
  loadOracleThreads,
  saveOracleThreads,
  loadGlobalBible,
  saveGlobalBible,
  patchOracleThread,
  ORACLE_MODEL_OPTIONS,
  DEFAULT_MINI_DELIBERATION_MODELS,
  DEFAULT_ROTATION_ROSTER,
  VISION_SAFE_FALLBACK_MODEL,
} from '../../lib/oracleStore';
import {
  buildOracleModelOptions,
  classifyOracleModel,
  normalizeModelId,
  addCustomOracleModel,
  removeCustomOracleModel,
  loadCustomOracleModels,
  loadOracleDirectList,
  saveOracleDirectList,
  ensureInOracleDirectList,
  removeFromOracleDirectList,
  restoreDefaultOracleDirectList,
  defaultOracleDirectList,
} from '../../lib/oracleModelPool';
import {
  loadBriefingStore,
  updateBriefingSettings,
} from '../../lib/briefingDetector';
import type { BriefingSettings } from '../../lib/briefingDetector';
import type { OracleCustomModel, OracleModelOption, OracleModelStatus } from '../../lib/oracleModelPool';
import type { RawOpenRouterModel } from '../../types';
import { copyToClipboard } from '../../lib/clipboard';

type OracleMode = 'direct' | 'mini_deliberation' | 'rotation';

const MODE_LABELS: Record<OracleMode, { title: string; desc: string }> = {
  direct: { title: 'Direct', desc: 'One model answers using the thread memory.' },
  mini_deliberation: { title: 'Mini Deliberation', desc: 'A panel of models answers in parallel, then a consensus is synthesized.' },
  rotation: { title: 'Auto-Rotate', desc: 'Automatically cycles through your chosen models, one per turn.' },
};

export const SettingsOracleBibleTab: React.FC<{ catalog?: RawOpenRouterModel[] | null }> = ({ catalog }) => {
  const [threads, setThreads] = useState<OracleThread[]>(() => loadOracleThreads());
  const [selectedThreadId, setSelectedThreadId] = useState<string>(() => {
    const list = loadOracleThreads();
    return list[0]?.id || '';
  });
  const [targetType, setTargetType] = useState<'thread' | 'global'>('thread');
  const [globalBible, setGlobalBible] = useState<OracleBible>(() => loadGlobalBible());
  const [bibleDraft, setBibleDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [isSavedNotice, setIsSavedNotice] = useState(false);

  const selectedThread = threads.find((t) => t.id === selectedThreadId) || threads[0] || null;

  // ---- Oracle model pool: custom models + Direct palette (global) ----
  const [customModels, setCustomModels] = useState<OracleCustomModel[]>(() => loadCustomOracleModels());
  const [directList, setDirectList] = useState<string[]>(() => loadOracleDirectList());
  const [customInput, setCustomInput] = useState('');
  const [customInputInfo, setCustomInputInfo] = useState<{
    id: string;
    status: OracleModelStatus;
    vision: boolean | null;
  } | null>(null);
  const [customInputError, setCustomInputError] = useState<string | null>(null);
  const [briefingSettings, setBriefingSettings] = useState<BriefingSettings>(
    () => loadBriefingStore().settings
  );

  const handleBriefingSettingsChange = (patch: Partial<BriefingSettings>) => {
    const next = updateBriefingSettings(patch);
    setBriefingSettings(next);
  };

  // ---- Model & Modes (moved off the main Oracle page) ----
  const [modelDraft, setModelDraft] = useState<{
    mode: OracleMode;
    model: string;
    miniRoster: string[];
    rotationRoster: string[];
  }>(() => {
    const t = loadOracleThreads()[0] || null;
    return {
      mode: t?.mode || 'direct',
      model: t?.model || ORACLE_MODEL_OPTIONS[0].id,
      miniRoster: t?.miniDeliberationModels || DEFAULT_MINI_DELIBERATION_MODELS,
      rotationRoster: t?.rotationModels || DEFAULT_ROTATION_ROSTER,
    };
  });
  const [isModelSavedNotice, setIsModelSavedNotice] = useState(false);

  // Keep the model draft in sync with the selected thread
  useEffect(() => {
    if (!selectedThread) return;
    setModelDraft({
      mode: selectedThread.mode || 'direct',
      model: selectedThread.model || ORACLE_MODEL_OPTIONS[0].id,
      miniRoster: selectedThread.miniDeliberationModels || DEFAULT_MINI_DELIBERATION_MODELS,
      rotationRoster: selectedThread.rotationModels || DEFAULT_ROTATION_ROSTER,
    });
  }, [selectedThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidateModels: OracleModelOption[] = useMemo(
    () => buildOracleModelOptions(catalog, customModels),
    [catalog, customModels]
  );

  /** The Direct palette, always including the thread's currently selected model. */
  const directDisplayList = useMemo(() => {
    const list = [...directList];
    if (modelDraft.model && !list.includes(modelDraft.model)) list.push(modelDraft.model);
    return list;
  }, [directList, modelDraft.model]);

  const optionMeta = (id: string): OracleModelOption | undefined =>
    candidateModels.find((m) => m.id === id);

  const addRosterModel = (roster: 'mini' | 'rotation', id: string) => {
    setModelDraft((d) => {
      const target = roster === 'mini' ? d.miniRoster : d.rotationRoster;
      if (target.includes(id)) return d;
      const next = [...target, id];
      return roster === 'mini' ? { ...d, miniRoster: next } : { ...d, rotationRoster: next };
    });
  };

  const removeRosterModel = (roster: 'mini' | 'rotation', id: string) => {
    setModelDraft((d) => {
      const target = roster === 'mini' ? d.miniRoster : d.rotationRoster;
      const next = target.filter((m) => m !== id);
      return roster === 'mini' ? { ...d, miniRoster: next } : { ...d, rotationRoster: next };
    });
  };

  const randomizeRoster = (roster: 'mini' | 'rotation') => {
    const pool = candidateModels.map((m) => m.id);
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const size = roster === 'mini' ? 3 : 4;
    const next = shuffled.slice(0, Math.min(size, pool.length));
    setModelDraft((d) => (roster === 'mini' ? { ...d, miniRoster: next } : { ...d, rotationRoster: next }));
  };

  // ---- Custom model management (validated against the live catalog) ----
  const handleCustomInput = (value: string) => {
    setCustomInput(value);
    setCustomInputError(null);
    const normalized = normalizeModelId(value);
    if (!normalized) {
      setCustomInputInfo(null);
      return;
    }
    const cls = classifyOracleModel(normalized, catalog);
    setCustomInputInfo({ id: normalized, status: cls.status, vision: cls.vision });
  };

  const handleAddCustomModel = () => {
    const res = addCustomOracleModel(customInput, catalog);
    if (!res.ok) {
      setCustomInputError(res.reason || 'Could not add that model.');
      return;
    }
    setCustomModels(loadCustomOracleModels());
    setDirectList(loadOracleDirectList());
    setCustomInput('');
    setCustomInputInfo(null);
    setCustomInputError(null);
  };

  const handleRemoveCustomModel = (id: string) => {
    removeCustomOracleModel(id);
    const nextPool = loadCustomOracleModels();
    // Drop it from the Direct palette (restoring defaults if it was the only
    // entry) and from the current thread's rosters.
    const cleaned = removeFromOracleDirectList(id).filter((m) => m !== id);
    const nextDirect = cleaned.length > 0 ? cleaned : defaultOracleDirectList();
    saveOracleDirectList(nextDirect);
    setCustomModels(nextPool);
    setDirectList(nextDirect);
    setModelDraft((d) => ({
      ...d,
      model: d.model === id ? nextDirect[0] || ORACLE_MODEL_OPTIONS[0].id : d.model,
      miniRoster: d.miniRoster.filter((m) => m !== id),
      rotationRoster: d.rotationRoster.filter((m) => m !== id),
    }));
  };

  // ---- Direct palette management ----
  const handleSelectDirectModel = (id: string) => {
    setModelDraft((d) => ({ ...d, model: id }));
  };

  const handleRemoveFromDirectList = (id: string) => {
    const next = removeFromOracleDirectList(id);
    setDirectList(next);
    setModelDraft((d) =>
      d.model === id ? { ...d, model: next[0] || ORACLE_MODEL_OPTIONS[0].id } : d
    );
  };

  const handleAddToDirectList = (id: string) => {
    const next = ensureInOracleDirectList(id);
    setDirectList(next);
    setModelDraft((d) => ({ ...d, model: id }));
  };

  const handleRandomizeDirect = () => {
    const pool =
      directDisplayList.length > 1
        ? directDisplayList.filter((m) => m !== modelDraft.model)
        : directDisplayList;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) setModelDraft((d) => ({ ...d, model: pick }));
  };

  const handleRestoreDirectDefaults = () => {
    const next = restoreDefaultOracleDirectList();
    setDirectList(next);
    setModelDraft((d) => ({ ...d, model: next.includes(d.model) ? d.model : next[0] }));
  };

  const handleSaveModelConfig = () => {
    if (!selectedThread) return;
    patchOracleThread(selectedThread.id, {
      mode: modelDraft.mode,
      model: modelDraft.model,
      miniDeliberationModels: modelDraft.miniRoster,
      rotationModels: modelDraft.rotationRoster,
    });
    const loaded = loadOracleThreads();
    setThreads(loaded);
    setIsModelSavedNotice(true);
    setTimeout(() => setIsModelSavedNotice(false), 2500);
  };

  // Refresh thread & global bible draft on change
  useEffect(() => {
    if (targetType === 'thread') {
      setBibleDraft(selectedThread?.bible?.content || '');
    } else {
      setBibleDraft(globalBible.content || '');
    }
  }, [targetType, selectedThreadId, selectedThread?.bible?.content, globalBible.content]);

  const handleRefreshFromStorage = () => {
    const loadedThreads = loadOracleThreads();
    const loadedGlobal = loadGlobalBible();
    setThreads(loadedThreads);
    setGlobalBible(loadedGlobal);
    if (!loadedThreads.some((t) => t.id === selectedThreadId) && loadedThreads[0]) {
      setSelectedThreadId(loadedThreads[0].id);
    }
  };

  const handleSave = () => {
    const cleanContent = bibleDraft.trim();
    const now = Date.now();

    if (targetType === 'thread') {
      if (!selectedThread) return;
      const updatedThreads = threads.map((t) =>
        t.id === selectedThread.id
          ? {
              ...t,
              bible: { content: cleanContent, updatedAt: now },
              updatedAt: now,
            }
          : t
      );
      setThreads(updatedThreads);
      saveOracleThreads(updatedThreads);
    } else {
      const updatedGlobal: OracleBible = { content: cleanContent, updatedAt: now };
      setGlobalBible(updatedGlobal);
      saveGlobalBible(updatedGlobal);
    }

    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 2500);
  };

  const handleCopy = () => {
    copyToClipboard(bibleDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename =
      targetType === 'thread'
        ? `oracle-bible-${(selectedThread?.title || 'thread').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`
        : 'oracle-global-bible.md';
    const blob = new Blob([bibleDraft], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (!window.confirm('Are you sure you want to clear this Bible memory?')) return;
    setBibleDraft('');
    const now = Date.now();
    if (targetType === 'thread') {
      if (!selectedThread) return;
      const updatedThreads = threads.map((t) =>
        t.id === selectedThread.id
          ? {
              ...t,
              bible: { content: '', updatedAt: now },
              updatedAt: now,
            }
          : t
      );
      setThreads(updatedThreads);
      saveOracleThreads(updatedThreads);
    } else {
      const updatedGlobal: OracleBible = { content: '', updatedAt: now };
      setGlobalBible(updatedGlobal);
      saveGlobalBible(updatedGlobal);
    }
  };

  const currentUpdatedTime =
    targetType === 'thread'
      ? selectedThread?.bible?.updatedAt
      : globalBible.updatedAt;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-5 h-5 text-indigo-500" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Oracle Living Memory (Bible)
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The Oracle autonomously maintains a living summary of established facts, user preferences, decisions, and context in the background. You can inspect or refine the memories below.
        </p>
      </div>

      {/* Scope switch & Thread selector */}
      <div className="space-y-3 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 dark:bg-slate-900 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setTargetType('thread')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                targetType === 'thread'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MessageSquare size={13} />
              Thread Bible
            </button>
            <button
              type="button"
              onClick={() => setTargetType('global')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                targetType === 'global'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Globe size={13} />
              Global Bible
            </button>
          </div>

          <button
            type="button"
            onClick={handleRefreshFromStorage}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-500 dark:text-slate-400 cursor-pointer"
            title="Reload from storage"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Select Conversation Thread:
          </label>
          {threads.length > 0 ? (
            <select
              value={selectedThreadId}
              onChange={(e) => setSelectedThreadId(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-indigo-500 outline-none"
            >
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title || 'Untitled Thread'} ({new Date(t.updatedAt).toLocaleDateString()})
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-slate-500 italic">No threads recorded yet.</div>
          )}
        </div>
      </div>

      {/* ============ Model & Modes (kept out of the main Oracle page) ============ */}
      <div className="space-y-3 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 mb-1">
          <Sliders className="w-4 h-4 text-fuchsia-500" />
          <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
            Model &amp; Modes <span className="font-normal text-slate-400">— applies to “{selectedThread?.title || 'Untitled Thread'}”</span>
          </h4>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Which model The Oracle uses and how it works are configured here instead of on the main page.
          Images are always safe: if a chosen model can't read pictures, the turn is automatically
          routed to <span className="font-mono">{VISION_SAFE_FALLBACK_MODEL.split('/').pop()}</span> (vision) and noted.
        </p>

        {/* Mode picker */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(Object.keys(MODE_LABELS) as OracleMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModelDraft((d) => ({ ...d, mode: m }))}
              className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                modelDraft.mode === m
                  ? 'bg-fuchsia-600/10 border-fuchsia-500/50 text-fuchsia-700 dark:text-fuchsia-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400'
              }`}
            >
              <div className="font-semibold">{MODE_LABELS[m].title}</div>
              <div className="text-[10px] mt-0.5 leading-snug opacity-80">{MODE_LABELS[m].desc}</div>
            </button>
          ))}
        </div>

        {/* Direct: single model palette (add/remove as you like) */}
        {modelDraft.mode === 'direct' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Model — click to select, <span className="font-mono">×</span> to remove from the list:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {directDisplayList.map((id) => {
                const meta = optionMeta(id);
                const isSelected = modelDraft.model === id;
                const inList = directList.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectDirectModel(id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-fuchsia-600/15 border-fuchsia-500/60 text-fuchsia-700 dark:text-fuchsia-300 font-semibold'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400'
                    }`}
                    title={`${id}${meta?.custom ? ' (custom)' : ''}`}
                  >
                    {meta?.status && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          meta.status === 'live'
                            ? 'bg-emerald-400'
                            : meta.status === 'delisted'
                              ? 'bg-amber-400'
                              : 'bg-slate-400'
                        }`}
                      />
                    )}
                    {meta?.vision ? (
                      <Eye size={10} className="text-indigo-400" />
                    ) : (
                      <span className="text-[9px] text-slate-400">txt</span>
                    )}
                    {meta?.name || id.split('/').pop()}
                    {inList && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFromDirectList(id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemoveFromDirectList(id);
                          }
                        }}
                        className="text-slate-400 hover:text-red-500 cursor-pointer"
                        aria-label={`Remove ${id} from the direct list`}
                      >
                        <X size={11} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  handleAddToDirectList(e.target.value);
                }}
                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-fuchsia-500 outline-none"
              >
                <option value="">Add a model to this list…</option>
                {candidateModels
                  .filter((m) => !directList.includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.tag ? `(${m.tag})` : ''} {m.vision ? '· Vision' : '· Text only'}
                    </option>
                  ))}
              </select>
              <Plus size={13} className="text-slate-400" />
              <button
                type="button"
                onClick={handleRandomizeDirect}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-amber-600 dark:text-amber-400 border border-amber-300/60 dark:border-amber-500/40 text-xs font-semibold cursor-pointer"
                title="Pick a random model from this list"
              >
                <Dices size={13} /> Randomize
              </button>
              <button
                type="button"
                onClick={handleRestoreDirectDefaults}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 text-[11px] cursor-pointer"
                title="Restore the default frontier list"
              >
                <RefreshCw size={11} /> Defaults
              </button>
            </div>
          </div>
        )}

        {/* Roster editors (mini deliberation / auto-rotate) */}
        {modelDraft.mode !== 'direct' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {modelDraft.mode === 'mini_deliberation' ? 'Deliberation panel:' : 'Auto-rotate roster:'}
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => randomizeRoster(modelDraft.mode === 'mini_deliberation' ? 'mini' : 'rotation')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-amber-600 dark:text-amber-400 border border-amber-300/60 dark:border-amber-500/40 text-[11px] font-semibold cursor-pointer"
                  title="Randomize roster"
                >
                  <Dices size={11} /> Randomize
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setModelDraft((d) =>
                      modelDraft.mode === 'mini_deliberation'
                        ? { ...d, miniRoster: DEFAULT_MINI_DELIBERATION_MODELS }
                        : { ...d, rotationRoster: DEFAULT_ROTATION_ROSTER }
                    )
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 text-[11px] cursor-pointer"
                  title="Reset to the default frontier roster"
                >
                  <RefreshCw size={11} /> Defaults
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(modelDraft.mode === 'mini_deliberation' ? modelDraft.miniRoster : modelDraft.rotationRoster).map((id) => {
                const meta = optionMeta(id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300"
                    title={id}
                  >
                    {meta?.status && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          meta.status === 'live'
                            ? 'bg-emerald-400'
                            : meta.status === 'delisted'
                              ? 'bg-amber-400'
                              : 'bg-slate-400'
                        }`}
                      />
                    )}
                    {meta?.vision ? <Eye size={10} className="text-indigo-400" /> : <span className="text-[9px] text-slate-400">txt</span>}
                    {meta?.name || id.split('/').pop()}
                    <button
                      type="button"
                      onClick={() => removeRosterModel(modelDraft.mode === 'mini_deliberation' ? 'mini' : 'rotation', id)}
                      className="text-slate-400 hover:text-red-500 cursor-pointer"
                      aria-label={`Remove ${id}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  addRosterModel(modelDraft.mode === 'mini_deliberation' ? 'mini' : 'rotation', e.target.value);
                }}
                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-fuchsia-500 outline-none"
              >
                <option value="">Add a model…</option>
                {candidateModels
                  .filter((m) => !(modelDraft.mode === 'mini_deliberation' ? modelDraft.miniRoster : modelDraft.rotationRoster).includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.tag ? `(${m.tag})` : ''} {m.vision ? '· Vision' : '· Text only'}
                    </option>
                  ))}
              </select>
              <Plus size={13} className="text-slate-400" />
            </div>
          </div>
        )}

        {/* Custom models: any OpenRouter id, validated against the live catalog */}
        <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Add a custom model (any OpenRouter id):
          </label>
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="text"
              value={customInput}
              onChange={(e) => handleCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomModel();
                }
              }}
              placeholder="e.g. z-ai/glm-5.3"
              spellCheck={false}
              className="flex-1 min-w-[180px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-fuchsia-500 outline-none font-mono"
            />
            {customInputInfo && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-semibold ${
                  customInputInfo.status === 'live'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300/60 dark:border-emerald-700/60'
                    : customInputInfo.status === 'delisted'
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300/60 dark:border-amber-700/60'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                }`}
                title={
                  customInputInfo.status === 'unknown'
                    ? 'No live catalog loaded yet — the id is saved and will be re-checked online.'
                    : undefined
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    customInputInfo.status === 'live'
                      ? 'bg-emerald-400'
                      : customInputInfo.status === 'delisted'
                        ? 'bg-amber-400'
                        : 'bg-slate-400'
                  }`}
                />
                {customInputInfo.status === 'live'
                  ? 'Live'
                  : customInputInfo.status === 'delisted'
                    ? 'Delisted'
                    : 'Unverified (offline)'}
                {customInputInfo.vision !== null &&
                  (customInputInfo.vision ? ' · Vision' : ' · Text only')}
              </span>
            )}
            <button
              type="button"
              onClick={handleAddCustomModel}
              disabled={!customInputInfo}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer"
            >
              <Plus size={13} /> Add
            </button>
          </div>
          {customInputError && (
            <div className="text-[11px] text-red-500">{customInputError}</div>
          )}
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Custom models join this list and every roster picker, rotate like any other model, and obey the
            vision guard (text-only models are never sent images). The live catalog is the source of truth:
            a delisted id is always shown as Delisted — never silently dropped.
          </p>
          {customModels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {customModels.map((m) => {
                const meta = optionMeta(m.id);
                return (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-fuchsia-50 dark:bg-fuchsia-950/40 border border-fuchsia-300/60 dark:border-fuchsia-700/60 text-[11px] text-slate-700 dark:text-slate-300"
                    title={m.id}
                  >
                    {meta?.status && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          meta.status === 'live'
                            ? 'bg-emerald-400'
                            : meta.status === 'delisted'
                              ? 'bg-amber-400'
                              : 'bg-slate-400'
                        }`}
                      />
                    )}
                    {meta?.vision ? (
                      <Eye size={10} className="text-indigo-400" />
                    ) : (
                      <span className="text-[9px] text-slate-400">txt</span>
                    )}
                    {meta?.name || m.id.split('/').pop()}
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomModel(m.id)}
                      className="text-slate-400 hover:text-red-500 cursor-pointer"
                      aria-label={`Remove custom model ${m.id}`}
                      title="Remove from your custom models (also removed from the direct list and this thread's rosters)"
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Council Briefings (Unasked Verdict) — zero-token local suggestions */}
        <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Council Briefings (Unasked Verdict)
            </label>
            <input
              type="checkbox"
              checked={briefingSettings.enabled}
              onChange={(e) => handleBriefingSettingsChange({ enabled: e.target.checked })}
              className="rounded text-fuchsia-500 focus:ring-0 cursor-pointer"
            />
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            The Oracle notices when you keep circling the same decision-style question across threads
            and offers to convene a mini-council. Detection is local and costs nothing — nothing runs
            until you click “Convene”. Personal topics are always excluded.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
              Suggest after
              <select
                value={briefingSettings.minMentions}
                onChange={(e) => handleBriefingSettingsChange({ minMentions: parseInt(e.target.value) || 3 })}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-[11px] rounded-lg px-2 py-1 outline-none"
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n} mentions</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
              looking back
              <select
                value={briefingSettings.lookbackDays}
                onChange={(e) => handleBriefingSettingsChange({ lookbackDays: parseInt(e.target.value) || 14 })}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-[11px] rounded-lg px-2 py-1 outline-none"
              >
                {[3, 7, 14, 30].map((n) => (
                  <option key={n} value={n}>{n} days</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {isModelSavedNotice && (
            <span className="text-xs text-emerald-500 font-medium flex items-center gap-1">
              <Check size={13} /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={handleSaveModelConfig}
            disabled={!selectedThread}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-bold shadow-md cursor-pointer transition-colors disabled:opacity-50"
          >
            <Save size={13} />
            Save Model &amp; Modes
          </button>
        </div>
      </div>

      {/* Memory Content Viewer & Editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            {bibleDraft.length} characters &bull; {bibleDraft.trim() ? bibleDraft.trim().split(/\s+/).length : 0} words
          </span>
          {currentUpdatedTime && (
            <span className="font-mono text-[10px]">
              Last updated: {new Date(currentUpdatedTime).toLocaleTimeString()}
            </span>
          )}
        </div>

        <textarea
          value={bibleDraft}
          onChange={(e) => setBibleDraft(e.target.value)}
          rows={12}
          placeholder={
            targetType === 'thread'
              ? 'The Living Thread Bible is maintained automatically as you talk with The Oracle. You can also write or edit notes directly here...'
              : 'The Global Bible stores persistent principles and facts shared across all conversation threads...'
          }
          className="w-full bg-slate-900 text-slate-100 placeholder-slate-500 text-xs p-3.5 rounded-xl border border-slate-700/80 focus:outline-none focus:border-indigo-500 resize-y font-mono leading-relaxed shadow-inner"
        />

        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!bibleDraft.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-50"
            >
              <Download size={13} />
              Export .md
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={!bibleDraft.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium border border-red-200 dark:border-red-900/40 cursor-pointer disabled:opacity-50"
            >
              <Trash2 size={13} />
              Clear
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isSavedNotice && (
              <span className="text-xs text-emerald-500 font-medium flex items-center gap-1">
                <Check size={13} /> Saved
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md cursor-pointer transition-colors"
            >
              <Save size={13} />
              Save Memory
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
