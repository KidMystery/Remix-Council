import React from 'react';
import { PanelLeft, Sparkles, DollarSign, Eye, EyeOff, Plus } from 'lucide-react';
import { HeaderActions } from '../HeaderActions';
import { User } from 'firebase/auth';

interface CouncilHeaderProps {
  isSidebarOpen: boolean;
  onOpenSidebar: () => void;
  sessionsCount: number;
  sessionCostMetrics: {
    totalCost: number;
    promptCost: number;
    completionCost: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  formatCost: (cost: number) => string;
  basicMode: boolean;
  onToggleBasicMode: () => void;
  theme: 'dark' | 'light' | 'system';
  onSetTheme: (t: 'dark' | 'light' | 'system') => void;
  onOpenAuditModal: () => void;
  onOpenSettings: () => void;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  onCreateNewSession: () => void;
  isDeliberating?: boolean;
  isSyncing?: boolean;
  onSyncWithCloud?: () => Promise<void> | void;
  lastSyncedAt?: number | null;
}

export const CouncilHeader: React.FC<CouncilHeaderProps> = ({
  isSidebarOpen,
  onOpenSidebar,
  sessionsCount,
  sessionCostMetrics,
  formatCost,
  basicMode,
  onToggleBasicMode,
  theme,
  onSetTheme,
  onOpenAuditModal,
  onOpenSettings,
  user,
  onLogin,
  onLogout,
  onCreateNewSession,
  isDeliberating,
  isSyncing,
  onSyncWithCloud,
  lastSyncedAt,
}) => {
  return (
    <header role="banner" aria-label="Deliberation Chamber Header" className="sticky top-0 z-30 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2 min-w-0 transition-all">
      {/* Left side: Navigation toggle, Brand, and Cost Metrics */}
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 shrink">
        {!isSidebarOpen && (
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open deliberation threads sidebar"
            aria-expanded={false}
            aria-controls="sidebar-deliberation-threads"
            className="min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-1.5 text-xs font-mono shrink-0 cursor-pointer shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400"
            title="Open Deliberation Threads"
          >
            <PanelLeft size={16} className="text-cyan-500" aria-hidden="true" />
            <span className="hidden sm:inline font-semibold">Threads</span>
            <span className="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-1.5 py-0.2 rounded-full text-[10px] font-bold" aria-label={`${sessionsCount} threads`}>
              {sessionsCount}
            </span>
          </button>
        )}

        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-950/40 shrink-0" aria-hidden="true">
          <Sparkles size={18} />
        </div>

        <div className="min-w-0 flex items-center gap-2 truncate">
          <h1 className="font-bold text-sm sm:text-base tracking-tight text-slate-900 dark:text-slate-100 truncate">
            AI Council
          </h1>

          {/* Compact Cost / Token pill */}
          <span
            className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-950/70 px-2 py-0.5 rounded-lg border border-emerald-500/30 shadow-xs shrink-0 select-none"
            aria-label={`Session Cost: ${formatCost(sessionCostMetrics.totalCost)}, ${sessionCostMetrics.totalTokens} tokens`}
            title={`Total Tokens: ${sessionCostMetrics.totalTokens.toLocaleString()}
• Prompt Tokens: ${sessionCostMetrics.promptTokens.toLocaleString()} (${formatCost(sessionCostMetrics.promptCost)})
• Completion Tokens: ${sessionCostMetrics.completionTokens.toLocaleString()} (${formatCost(sessionCostMetrics.completionCost)})`}
          >
            <DollarSign size={11} className="text-emerald-500" aria-hidden="true" />
            <span className="font-bold">{formatCost(sessionCostMetrics.totalCost)}</span>
            <span className="text-slate-400 dark:text-slate-500 text-[9px] border-l border-emerald-500/30 pl-1">
              {sessionCostMetrics.promptTokens > 1000 ? `${(sessionCostMetrics.promptTokens / 1000).toFixed(1)}k` : sessionCostMetrics.promptTokens} in / {sessionCostMetrics.completionTokens > 1000 ? `${(sessionCostMetrics.completionTokens / 1000).toFixed(1)}k` : sessionCostMetrics.completionTokens} out
            </span>
          </span>
        </div>
      </div>

      {/* Right side: Clean action suite & New Thread */}
      <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
        {/* Consensus View / Full Debate Toggle */}
        <button
          type="button"
          onClick={onToggleBasicMode}
          aria-pressed={basicMode}
          aria-label={basicMode ? "Switch to Full Debate mode" : "Switch to Consensus View mode"}
          className={`min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs shrink-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400 ${
            basicMode
              ? 'bg-cyan-500/15 dark:bg-cyan-950/60 border-cyan-500/50 text-cyan-700 dark:text-cyan-300 ring-1 ring-cyan-500/30'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          title={
            basicMode
              ? "Consensus View active: Showing consensus only — full debate runs in background"
              : "Full Debate active: Showing all persona stage outputs and peer reviews"
          }
        >
          {basicMode ? (
            <>
              <Eye size={15} className="text-cyan-500 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline font-mono text-[11px]">Consensus View</span>
            </>
          ) : (
            <>
              <EyeOff size={15} className="text-slate-400 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline font-mono text-[11px]">Full Debate</span>
            </>
          )}
        </button>

        {/* Streamlined Header Actions (Theme, Audit, Auth, Settings) */}
        <HeaderActions
          theme={theme}
          onSetTheme={onSetTheme}
          onOpenAuditModal={onOpenAuditModal}
          onOpenSettings={onOpenSettings}
          user={user}
          onLogin={onLogin}
          onLogout={onLogout}
          isDeliberating={isDeliberating}
          isSyncing={isSyncing}
          onSyncWithCloud={onSyncWithCloud}
          lastSyncedAt={lastSyncedAt}
        />

        {/* Primary New Thread Action */}
        <button
          type="button"
          onClick={onCreateNewSession}
          disabled={isDeliberating}
          aria-label="Start new deliberation thread"
          className="min-h-[36px] sm:min-h-[38px] px-3 sm:px-3.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all flex items-center gap-1.5 text-xs font-bold shadow-md shadow-cyan-950/30 shrink-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400"
          title={isDeliberating ? "Cannot start a new thread during deliberation" : "Start New Deliberation Thread"}
        >
          <Plus size={15} aria-hidden="true" />
          <span className="hidden sm:inline">New Thread</span>
        </button>
      </div>
    </header>
  );
};

