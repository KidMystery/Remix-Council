import React, { useState } from 'react';
import {
  RefreshCw,
  Play,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Users,
  Award,
  Clock,
  Sparkles,
  GitBranch,
} from 'lucide-react';
import type { CouncilRound, CouncilPersona } from '../types';
import { MessageMarkdown } from './MessageMarkdown';

export interface CouncilRoundViewProps {
  round: CouncilRound;
  personas: CouncilPersona[];
  basicMode?: boolean;
  incompleteStage?: { isIncomplete: boolean; description: string };
  onResumeRound?: (roundId: string) => void;
  onReRunRound?: (roundId: string) => void;
  onForkBranch?: (branchName: string) => void;
  isDeliberating?: boolean;
}

export const CouncilRoundView: React.FC<CouncilRoundViewProps> = ({
  round,
  personas,
  basicMode = false,
  incompleteStage,
  onResumeRound,
  onReRunRound,
  onForkBranch,
  isDeliberating = false,
}) => {
  const activePersonas = personas.filter((p) => p.enabled !== false);
  const stage1 = round.deliberation?.stage1 || {};
  const stage2 = round.deliberation?.stage2 || {};
  const stage3 = round.deliberation?.stage3;

  // Collapsible state for stacked stage sections
  const [stage1Expanded, setStage1Expanded] = useState(true);
  const [stage2Expanded, setStage2Expanded] = useState(true);
  const [selectedPersonaTab, setSelectedPersonaTab] = useState<string>(activePersonas[0]?.id || '');
  const [isForking, setIsForking] = useState(false);
  const [forkBranchName, setForkBranchName] = useState('');

  const hasStage2 =
    Object.keys(stage2).length > 0 &&
    Object.values(stage2).some((r: any) => r?.content || r?.status === 'streaming');

  const stage1Completed = activePersonas.filter((p) => stage1[p.id]?.status === 'completed').length;
  const stage2Completed = activePersonas.filter((p) => stage2[p.id]?.status === 'completed').length;

  const handleCreateFork = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forkBranchName.trim() || !onForkBranch) return;
    onForkBranch(forkBranchName.trim());
    setIsForking(false);
    setForkBranchName('');
  };

  return (
    <article className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-2xl backdrop-blur-sm transition-all mb-6">
      {/* Sticky Round Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-800/80 sticky top-12 bg-slate-900/95 py-2 z-20 backdrop-blur">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2">
            {round.parentRoundId ? (
              <GitBranch size={15} className="text-purple-400 shrink-0" />
            ) : (
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 shrink-0" />
            )}
            <h3 className="text-sm sm:text-base font-semibold text-slate-100 line-clamp-1">
              {round.userQuery}
            </h3>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 mt-1">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {new Date(round.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span>•</span>
            <span className="text-cyan-400 font-sans">{activePersonas.length} Panelists</span>
            {round.branchName && (
              <>
                <span>•</span>
                <span className="text-purple-300 font-sans bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800">
                  Branch: {round.branchName}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {incompleteStage?.isIncomplete && onResumeRound ? (
            <button
              onClick={() => onResumeRound(round.id)}
              disabled={isDeliberating}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-200 bg-amber-950/90 hover:bg-amber-900 px-3 py-1.5 rounded-lg border border-amber-600/80 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              title="Resume incomplete stage"
            >
              <RefreshCw size={12} className={isDeliberating ? 'animate-spin' : ''} />
              <span>Resume {incompleteStage.description}</span>
            </button>
          ) : (
            <>
              {onForkBranch && (
                <button
                  onClick={() => setIsForking(!isForking)}
                  disabled={isDeliberating}
                  className="inline-flex items-center gap-1 text-xs font-mono text-purple-300 bg-purple-950/70 hover:bg-purple-900 px-2.5 py-1.5 rounded-lg border border-purple-700/60 transition-colors disabled:opacity-50 cursor-pointer"
                  title="Fork into Sub-Council Branch"
                >
                  <GitBranch size={12} />
                  <span className="hidden sm:inline">Fork Branch</span>
                </button>
              )}
              {onReRunRound && (
                <button
                  onClick={() => onReRunRound(round.id)}
                  disabled={isDeliberating}
                  className="inline-flex items-center gap-1 text-xs font-mono text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                  title="Re-run deliberation"
                >
                  <RefreshCw size={11} />
                  <span>Re-run</span>
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Sub-Council Fork Prompt Popup */}
      {isForking && (
        <form onSubmit={handleCreateFork} className="mb-4 p-3 bg-purple-950/40 border border-purple-700/60 rounded-xl flex items-center gap-2">
          <input
            type="text"
            value={forkBranchName}
            onChange={(e) => setForkBranchName(e.target.value)}
            placeholder="Branch Name (e.g., Strict Zero-Trust Counter-Thesis)..."
            className="flex-1 bg-slate-950 text-slate-100 text-xs px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-purple-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={!forkBranchName.trim()}
            className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            Launch Branch
          </button>
          <button
            type="button"
            onClick={() => setIsForking(false)}
            className="px-2.5 py-2 text-slate-400 hover:text-slate-200 text-xs"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Consensus View (Basic Mode) */}
      {basicMode ? (
        <div className="space-y-4">
          {stage3?.content ? (
            <section className="p-5 bg-slate-950/80 border border-cyan-500/40 rounded-xl shadow-inner">
              <div className="flex items-center gap-2 mb-3 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck size={16} />
                <span>Executive Synthesis & Consensus</span>
              </div>
              <MessageMarkdown content={stage3.content} />
            </section>
          ) : (
            <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl text-xs font-mono text-slate-400 flex items-center justify-between">
              <span>Deliberating: Stage 1 ({stage1Completed}/{activePersonas.length}) · Stage 2 ({stage2Completed}/{activePersonas.length})</span>
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
            </div>
          )}
        </div>
      ) : (
        /* Full Stackable Debate View */
        <div className="space-y-5">
          {/* Stage 1: Collapsible Independent Proposals */}
          <section className="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950/40">
            <button
              type="button"
              onClick={() => setStage1Expanded(!stage1Expanded)}
              className="w-full flex items-center justify-between p-3.5 bg-slate-950/70 hover:bg-slate-950 text-slate-300 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Users size={14} className="text-cyan-400" />
                <span>Stage 1: Proposals ({stage1Completed}/{activePersonas.length})</span>
              </div>
              {stage1Expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {stage1Expanded && (
              <div className="p-4 pt-2">
                {/* Mobile Persona Tabs */}
                <div className="flex sm:hidden overflow-x-auto gap-1 pb-2 mb-3 border-b border-slate-800">
                  {activePersonas.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPersonaTab(p.id)}
                      className={`px-3 py-1 text-xs rounded-md whitespace-nowrap ${
                        selectedPersonaTab === p.id ? 'bg-cyan-600 text-white font-medium' : 'text-slate-400 bg-slate-900'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>

                {/* Grid on tablet/desktop, Tabbed on mobile */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {activePersonas.map((p) => {
                    const s1 = stage1[p.id];
                    const isHiddenOnMobile = selectedPersonaTab !== p.id;
                    return (
                      <div
                        key={p.id}
                        className={`p-4 bg-slate-900/90 border border-slate-800/90 rounded-xl text-xs flex flex-col justify-between ${
                          isHiddenOnMobile ? 'hidden sm:flex' : 'flex'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800">
                            <span className="font-bold text-slate-100">{p.name}</span>
                            <span className="text-[10px] text-cyan-400/80 font-mono truncate max-w-[110px]" title={p.model}>
                              {p.model.split('/').pop()}
                            </span>
                          </div>
                          {s1?.content ? (
                            <MessageMarkdown content={s1.content} />
                          ) : (
                            <div className="flex items-center gap-2 text-slate-500 italic py-4">
                              <span className="flex h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                              <span>Awaiting analysis...</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Stage 2: Collapsible Peer Review */}
          {hasStage2 && (
            <section className="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950/40">
              <button
                type="button"
                onClick={() => setStage2Expanded(!stage2Expanded)}
                className="w-full flex items-center justify-between p-3.5 bg-slate-950/70 hover:bg-slate-950 text-slate-300 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-purple-400" />
                  <span>Stage 2: Peer Review & Critique ({stage2Completed}/{activePersonas.length})</span>
                </div>
                {stage2Expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {stage2Expanded && (
                <div className="p-4 pt-2 grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {activePersonas.map((p) => {
                    const s2 = stage2[p.id];
                    return (
                      <div key={p.id} className="p-4 bg-slate-900/90 border border-slate-800/90 rounded-xl text-xs">
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800">
                          <span className="font-bold text-purple-300">{p.name} Critique</span>
                        </div>
                        {s2?.content ? (
                          <MessageMarkdown content={s2.content} />
                        ) : (
                          <div className="flex items-center gap-2 text-slate-500 italic py-4">
                            <span className="flex h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                            <span>Synthesizing peer critique...</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Stage 3: Authoritative Synthesis Card */}
          {stage3?.content && (
            <section className="p-5 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-cyan-500/50 rounded-2xl shadow-xl">
              <div className="flex items-center gap-2 mb-3 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                <Sparkles size={16} />
                <span>Stage 3: Executive Consensus & Verdict</span>
              </div>
              <MessageMarkdown content={stage3.content} />
            </section>
          )}
        </div>
      )}
    </article>
  );
};
