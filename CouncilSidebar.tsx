import React, { useState } from 'react';
import { MessageSquare, PanelLeftClose, Plus, Search, X, Clock, Trash2, Eraser, RefreshCw, Cloud, Pencil } from 'lucide-react';
import { Session } from '../../types';
import { ConfirmButton } from '../ConfirmButton';

interface CouncilSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: Session[];
  filteredSessions: Session[];
  activeSessionId: string | null;
  activeSession?: Session | null;
  sessionSearchQuery: string;
  setSessionSearchQuery: (query: string) => void;
  onCreateNewSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onClearAllSessions: () => void;
  onClearActiveHistory?: () => void;
  isDeliberating?: boolean;
  isSyncing?: boolean;
  onSyncWithCloud?: () => Promise<void> | void;
  lastSyncedAt?: number | null;
  isSignedIn?: boolean;
  onOpenStorageSync?: () => void;
}

export const CouncilSidebar: React.FC<CouncilSidebarProps> = ({
  isOpen,
  onClose,
  sessions,
  filteredSessions,
  activeSessionId,
  activeSession,
  sessionSearchQuery,
  setSessionSearchQuery,
  onCreateNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onClearAllSessions,
  onClearActiveHistory,
  isDeliberating,
  isSyncing,
  onSyncWithCloud,
  lastSyncedAt,
  isSignedIn,
  onOpenStorageSync,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const commitRename = (id: string) => {
    const clean = draftTitle.trim();
    if (clean) onRenameSession?.(id, clean);
    setEditingId(null);
    setDraftTitle('');
  };
  const currentSession = activeSession || sessions.find((s) => s.id === activeSessionId);
  const activeHasRounds = Boolean(currentSession && currentSession.rounds && currentSession.rounds.length > 0);

  return (
    <>
      {/* Mobile backdrop overlay for sidebar */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 sm:hidden transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Sidebar for Deliberation Threads */}
      <aside
        id="sidebar-deliberation-threads"
        role="complementary"
        aria-label="Deliberation Threads"
        className={`${
          isOpen
            ? 'translate-x-0 w-80 border-r shadow-2xl sm:shadow-none'
            : '-translate-x-full sm:translate-x-0 w-80 sm:w-0 border-r-0 pointer-events-none sm:pointer-events-auto'
        } fixed inset-y-0 left-0 sm:static sm:inset-auto shrink-0 bg-white dark:bg-slate-900/98 backdrop-blur-md border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out flex flex-col h-full z-50 overflow-hidden`}
      >
        {/* Sidebar Header */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare size={16} className="text-cyan-500 shrink-0" aria-hidden="true" />
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-200 font-mono truncate" title="Deliberation Threads">
              Deliberation Threads
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {onSyncWithCloud && (
              <button
                type="button"
                onClick={() => onSyncWithCloud()}
                disabled={isSyncing || isDeliberating}
                aria-label="Refresh and sync threads from Firebase"
                title={
                  isSyncing
                    ? 'Syncing with Cloud...'
                    : `Sync threads with cloud${lastSyncedAt ? ` • Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : ''}`
                }
                className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500"
              >
                <RefreshCw size={14} className={isSyncing ? "animate-spin text-cyan-500" : ""} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close deliberation threads sidebar"
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400"
            >
              <PanelLeftClose size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Sidebar Action & Search */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <button
            type="button"
            onClick={() => onCreateNewSession()}
            disabled={isDeliberating}
            aria-label="Start new deliberation thread"
            className="w-full py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-cyan-950/30 transition-all cursor-pointer min-h-[42px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400"
          >
            <Plus size={15} aria-hidden="true" /> <span>New Thread</span>
          </button>

          <div className="relative">
            <Search size={13} className="absolute left-3 top-3 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <input
              type="text"
              aria-label="Filter deliberation threads"
              placeholder="Filter threads..."
              value={sessionSearchQuery}
              onChange={(e) => setSessionSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-cyan-500/60 font-sans"
            />
            {sessionSearchQuery && (
              <button
                type="button"
                aria-label="Clear thread search"
                onClick={() => setSessionSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5 rounded focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-cyan-400"
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Active Thread Fast Actions (Clear Current Thread) */}
          {activeHasRounds && onClearActiveHistory && (
            <ConfirmButton
              onConfirm={onClearActiveHistory}
              disabled={isDeliberating}
              aria-label="Clear all messages from the active thread"
              confirmPrompt="Click again to clear"
              className="w-full py-1.5 px-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/15 dark:bg-red-950/40 dark:hover:bg-red-900/50 border border-red-500/30 text-red-600 dark:text-red-400 disabled:opacity-40 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-500"
              idleChildren={
                <>
                  <Eraser size={13} aria-hidden="true" />
                  <span>Clear History in Current Thread</span>
                </>
              }
            />
          )}
        </div>

        {/* Thread List */}
        <nav aria-label="Deliberation threads list" className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {filteredSessions.length === 0 ? (
            <div className="text-xs text-slate-400 dark:text-slate-500 text-center py-10 font-mono" role="status">
              {sessionSearchQuery ? 'No matching threads found' : 'No saved threads yet'}
            </div>
          ) : (
            <ul className="space-y-1.5 list-none p-0 m-0">
              {filteredSessions.map((s) => {
                const isActive = s.id === activeSessionId;
                const sessionTitle = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : 'Untitled Session';
                return (
                  <li key={s.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={`Thread: ${sessionTitle}, ${s.rounds?.length || 0} rounds`}
                      onClick={() => onSelectSession(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectSession(s.id);
                        }
                      }}
                      className={`group relative p-2.5 rounded-xl text-xs cursor-pointer transition-all flex items-start justify-between gap-2 border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400 ${
                        isActive
                          ? 'bg-cyan-500/10 dark:bg-cyan-950/40 border-cyan-500/50 text-slate-900 dark:text-slate-100 shadow-xs ring-1 ring-cyan-500/20'
                          : 'bg-slate-50/70 dark:bg-slate-950/50 hover:bg-slate-100 dark:hover:bg-slate-800/60 border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {editingId === s.id ? (
                          <input
                            autoFocus
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onBlur={() => commitRename(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRename(s.id);
                              } else if (e.key === 'Escape') {
                                setEditingId(null);
                                setDraftTitle('');
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full bg-slate-950 text-slate-100 text-xs px-2 py-1 rounded border border-cyan-500/60 focus:outline-none"
                            aria-label="Rename thread"
                          />
                        ) : (
                          <div className="flex items-start gap-1 group/title">
                            <div className="font-semibold text-xs leading-snug line-clamp-2 break-words" title={sessionTitle}>
                              {sessionTitle}
                            </div>
                            {onRenameSession && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(s.id);
                                  setDraftTitle(sessionTitle);
                                }}
                                className="opacity-0 group-hover/title:opacity-100 text-slate-500 hover:text-cyan-400 p-0.5 rounded transition-opacity cursor-pointer shrink-0"
                                title="Rename thread"
                                aria-label={`Rename thread ${sessionTitle}`}
                              >
                                <Pencil size={11} />
                              </button>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500 font-mono flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock size={10} aria-hidden="true" />
                            {new Date(s.updatedAt || s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                          <span aria-hidden="true">•</span>
                          <span>{s.rounds?.length || 0} {s.rounds?.length === 1 ? 'round' : 'rounds'}</span>
                        </div>
                      </div>

                      <ConfirmButton
                        onConfirm={() => onDeleteSession(s.id)}
                        aria-label={`Delete thread ${sessionTitle}`}
                        className="text-slate-400 hover:text-red-500 hover:bg-red-500/10 dark:hover:bg-red-950/40 p-1.5 rounded-lg transition-all shrink-0 cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-500"
                        title="Delete thread"
                        confirmPrompt={<Trash2 size={13} className="text-white" />}
                        idleChildren={<Trash2 size={13} aria-hidden="true" />}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/60 flex flex-col gap-2">
          {onOpenStorageSync && (
            <button
              type="button"
              onClick={onOpenStorageSync}
              className="w-full py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 font-medium">
                <Cloud size={13} className={isSignedIn ? 'text-emerald-400' : 'text-cyan-400'} />
                <span>Storage &amp; Sync</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {isSignedIn ? 'Cloud' : 'Local'}
              </span>
            </button>
          )}

          {sessions.length > 0 && (
            <ConfirmButton
              disabled={isDeliberating}
              onConfirm={onClearAllSessions}
              className="w-full text-center text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 py-1.5 px-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center justify-center gap-1.5 font-medium cursor-pointer disabled:opacity-40"
              confirmPrompt="Click again to delete all"
              idleChildren={
                <>
                  <Trash2 size={13} /> Clear All Threads ({sessions.length})
                </>
              }
            />
          )}
        </div>
      </aside>
    </>
  );
};

