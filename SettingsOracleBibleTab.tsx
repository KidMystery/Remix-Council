import React, { useState, useEffect } from 'react';
import { BookOpen, Globe, Save, Copy, Check, Download, Trash2, RefreshCw, MessageSquare } from 'lucide-react';
import {
  OracleThread,
  OracleBible,
  loadOracleThreads,
  saveOracleThreads,
  loadGlobalBible,
  saveGlobalBible,
} from '../../lib/oracleStore';
import { copyToClipboard } from '../../lib/clipboard';

export const SettingsOracleBibleTab: React.FC = () => {
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

        {targetType === 'thread' && (
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
        )}
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
