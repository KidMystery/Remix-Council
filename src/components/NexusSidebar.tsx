import React, { useState } from 'react';
import { Orbit, PanelLeftClose, Plus, Search, X, Clock, Trash2, Pencil, ArrowRight } from 'lucide-react';
import type { PersistedMission } from '../lib/nexusMission';
import { ConfirmButton } from './ConfirmButton';

interface NexusSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  missions: PersistedMission[];
  activeMissionId: string | null;
  isRunning?: boolean;
  onCreateNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function missionLabel(m: PersistedMission): string {
  const titled = (m.title || '').trim();
  if (titled && titled !== 'Nexus Mission') return titled;
  const goal = (m.goal || '').trim();
  if (goal) return goal.length > 72 ? `${goal.slice(0, 69)}…` : goal;
  return 'New Mission';
}

function statusLabel(status: PersistedMission['status']): string {
  if (status === 'converged') return 'converged';
  if (status === 'max_reached') return 'maxed';
  if (status === 'running') return 'running';
  if (status === 'paused') return 'paused';
  if (status === 'error') return 'error';
  if (status === 'awaiting_approval') return 'approval';
  return 'idle';
}

export const NexusSidebar: React.FC<NexusSidebarProps> = ({
  isOpen,
  onClose,
  missions,
  activeMissionId,
  isRunning,
  onCreateNew,
  onSelect,
  onRename,
  onDelete,
}) => {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const byId = new Map(missions.map((m) => [m.id, m]));
  const filtered = missions.filter((m) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return missionLabel(m).toLowerCase().includes(q) || (m.goal || '').toLowerCase().includes(q);
  });

  const commitRename = (id: string) => {
    const clean = draftTitle.trim();
    if (clean) onRename(id, clean);
    setEditingId(null);
    setDraftTitle('');
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 sm:hidden transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      <aside
        id="sidebar-nexus-missions"
        role="complementary"
        aria-label="Nexus missions"
        className={`${
          isOpen
            ? 'translate-x-0 w-80 border-r shadow-2xl sm:shadow-none'
            : '-translate-x-full sm:translate-x-0 w-80 sm:w-0 border-r-0 pointer-events-none sm:pointer-events-auto'
        } fixed inset-y-0 left-0 sm:static sm:inset-auto shrink-0 bg-slate-950/98 backdrop-blur-md border-slate-800 transition-all duration-300 ease-in-out flex flex-col h-full z-50 overflow-hidden`}
      >
        <div className="p-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Orbit size={16} className="text-emerald-400 shrink-0" aria-hidden="true" />
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-200 font-mono truncate">
              Nexus Missions
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Nexus missions sidebar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="p-3 border-b border-slate-800 space-y-2.5">
          <button
            type="button"
            onClick={onCreateNew}
            disabled={isRunning}
            aria-label="Start a new Nexus mission"
            className="w-full py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-950/30 transition-all cursor-pointer min-h-[42px]"
          >
            <Plus size={15} aria-hidden="true" /> <span>New Mission</span>
          </button>

          <div className="relative">
            <Search size={13} className="absolute left-3 top-3 text-slate-500" aria-hidden="true" />
            <input
              type="text"
              aria-label="Filter Nexus missions"
              placeholder="Filter missions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/60"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear mission search"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200 cursor-pointer p-0.5 rounded"
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <nav aria-label="Nexus missions list" className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-10 font-mono" role="status">
              {query ? 'No matching missions' : 'No missions yet'}
            </div>
          ) : (
            <ul className="space-y-1.5 list-none p-0 m-0">
              {filtered.map((m) => {
                const isActive = m.id === activeMissionId;
                const label = missionLabel(m);
                const parent = m.parentMissionId ? byId.get(m.parentMissionId) : undefined;
                return (
                  <li key={m.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={`Mission: ${label}`}
                      onClick={() => {
                        if (!isRunning) onSelect(m.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!isRunning) onSelect(m.id);
                        }
                      }}
                      className={`group relative p-2.5 rounded-xl text-xs cursor-pointer transition-all flex items-start justify-between gap-2 border ${
                        isActive
                          ? 'bg-emerald-950/50 border-emerald-500/50 text-slate-100 shadow-xs ring-1 ring-emerald-500/20'
                          : 'bg-slate-950/50 hover:bg-slate-800/60 border-slate-800 text-slate-400 hover:text-slate-200'
                      } ${isRunning && !isActive ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {editingId === m.id ? (
                          <input
                            autoFocus
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onBlur={() => commitRename(m.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRename(m.id);
                              } else if (e.key === 'Escape') {
                                setEditingId(null);
                                setDraftTitle('');
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full bg-slate-950 text-slate-100 text-xs px-2 py-1 rounded border border-emerald-500/60 focus:outline-none"
                            aria-label="Rename mission"
                          />
                        ) : (
                          <div className="flex items-start gap-1 group/title">
                            <div className="font-semibold text-xs leading-snug line-clamp-2 break-words" title={label}>
                              {label}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingId(m.id);
                                setDraftTitle(label);
                              }}
                              className="opacity-0 group-hover/title:opacity-100 text-slate-500 hover:text-emerald-400 p-0.5 rounded transition-opacity cursor-pointer shrink-0"
                              title="Rename mission"
                              aria-label={`Rename mission ${label}`}
                            >
                              <Pencil size={11} />
                            </button>
                          </div>
                        )}
                        {parent && (
                          <div className="flex items-center gap-1 text-[10px] text-emerald-400/80 font-mono">
                            <ArrowRight size={10} aria-hidden="true" />
                            <span className="truncate">follow-up of {missionLabel(parent)}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono flex-wrap">
                          <span className="flex items-center gap-1">
                            <Clock size={10} aria-hidden="true" />
                            {new Date(m.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                          <span aria-hidden="true">•</span>
                          <span>{m.rounds?.length || 0} {m.rounds?.length === 1 ? 'cycle' : 'cycles'}</span>
                          <span aria-hidden="true">•</span>
                          <span>{statusLabel(m.status)}</span>
                        </div>
                      </div>

                      <ConfirmButton
                        onConfirm={() => onDelete(m.id)}
                        disabled={isRunning && isActive}
                        aria-label={`Delete mission ${label}`}
                        className="text-slate-400 hover:text-red-500 hover:bg-red-950/40 p-1.5 rounded-lg transition-all shrink-0 cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center"
                        title="Delete mission"
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
      </aside>
    </>
  );
};
