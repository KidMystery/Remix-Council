import React, { useEffect } from 'react';
import { Shield, Settings, Wallet, Menu, Orbit, MessagesSquare, Loader2, LogOut, HardDrive, BookOpen } from 'lucide-react';
import { getCurrentUserEmail } from '../../lib/drivePersistence';
import { useOpenRouterCredits } from '../../hooks/useOpenRouterCredits';
import { AutoSaveIndicator } from '../AutoSaveIndicator';
import type { AutoSaveState } from '../../types';

export type AppViewMode = 'chamber' | 'nexus' | 'oracle';

export interface CouncilHeaderProps {
  currentView: AppViewMode;
  onNavigate: (view: AppViewMode) => void;
  sessionTitle?: string;
  activePresetName?: string;
  sessionCost?: number;
  onOpenSettings?: () => void;
  onOpenStorageSync?: () => void;
  onToggleMobileDrawer?: () => void;
  isSignedIn?: boolean;
  isSyncing?: boolean;
  isSaving?: boolean;
  lastSavedAt?: number | null;
  saveDestination?: 'cloud' | 'local' | null;
  autoSaveState?: AutoSaveState;
  onSaveNow?: () => void | Promise<void>;
  onSignIn?: () => void;
  onSignOut?: () => void;
}

const DriveIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 2L2.5 18.5 5.2 23l6.8-12L19 23l2.7-4.5L12 2zm0 5.2l6.8 11.8H5.2L12 7.2z" />
  </svg>
);

export const CouncilHeader: React.FC<CouncilHeaderProps> = ({
  currentView,
  onNavigate,
  sessionTitle,
  activePresetName = 'Deep Council',
  sessionCost,
  onOpenSettings,
  onOpenStorageSync,
  onToggleMobileDrawer,
  isSignedIn = false,
  isSyncing = false,
  isSaving = false,
  lastSavedAt,
  saveDestination,
  autoSaveState,
  onSaveNow,
  onSignIn,
  onSignOut,
}) => {
  const userEmail = getCurrentUserEmail();
  const { credits, refresh: refreshCredits } = useOpenRouterCredits();

  return (
    <header className="flex items-center justify-between px-2.5 sm:px-5 py-2 sm:py-2.5 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md sticky top-0 z-40">
      {/* Brand & Mode Switcher */}
      <div className="flex items-center gap-1.5 sm:gap-4 min-w-0">
        {onToggleMobileDrawer && (
          <button
            onClick={onToggleMobileDrawer}
            className="sm:hidden text-slate-400 hover:text-slate-100 p-2 rounded-xl cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
            title="Toggle Sessions Menu"
            aria-label="Toggle sessions navigation drawer"
          >
            <Menu size={18} />
          </button>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 bg-gradient-to-tr from-cyan-600 to-blue-500 rounded-xl shadow-sm">
            <Shield size={16} className="text-slate-950" />
          </div>
          <div className="hidden md:block">
            <h1 className="text-xs sm:text-sm font-bold text-slate-100 tracking-wide flex items-center gap-1.5">
              <span>Remix Council</span>
            </h1>
          </div>
        </div>

        {/* Chamber vs Nexus Lab Navigator */}
        <nav className="flex items-center bg-slate-950 rounded-xl p-1 border border-slate-800 text-xs shadow-inner">
          <button
            type="button"
            onClick={() => onNavigate('chamber')}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg transition-all cursor-pointer min-h-[32px] ${
              currentView === 'chamber'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessagesSquare size={13} />
            <span className="text-[11px] sm:text-xs">Chamber</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('nexus')}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg transition-all cursor-pointer min-h-[32px] ${
              currentView === 'nexus'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold shadow-md shadow-emerald-950/40'
                : 'text-emerald-400/90 hover:text-emerald-300'
            }`}
          >
            <Orbit size={13} />
            <span className="text-[11px] sm:text-xs">Nexus Lab</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('oracle')}
            className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg transition-all cursor-pointer min-h-[32px] ${
              currentView === 'oracle'
                ? 'bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-slate-950 font-bold shadow-md shadow-indigo-950/40'
                : 'text-indigo-400/90 hover:text-indigo-300'
            }`}
          >
            <BookOpen size={13} />
            <span className="text-[11px] sm:text-xs">Oracle</span>
          </button>
        </nav>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        {/* Auto-save Status Indicator (Clickable to open Storage & Sync Center) */}
        <AutoSaveIndicator
          autoSaveState={autoSaveState}
          lastSavedAt={lastSavedAt}
          isSaving={isSaving}
          isSyncing={isSyncing}
          destination={isSignedIn ? 'cloud' : saveDestination || 'local'}
          onSaveNow={onSaveNow}
          onClick={onOpenStorageSync}
          variant="header"
        />

        {/* Google Drive / Cloud Sync Action */}
        {isSignedIn ? (
          <button
            type="button"
            onClick={onOpenStorageSync || onSignOut}
            className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-300 bg-emerald-950/70 hover:bg-emerald-900/80 px-2 sm:px-2.5 py-1.5 rounded-xl border border-emerald-700/60 transition-colors cursor-pointer min-h-[32px]"
            title={`Connected: ${userEmail || 'Google Drive'}. Click to manage.`}
          >
            <DriveIcon className="text-emerald-400 shrink-0" />
            {isSyncing && <Loader2 size={12} className="animate-spin text-emerald-300" />}
            {userEmail ? (
              <span className="hidden lg:inline max-w-[100px] truncate" title={userEmail}>
                {userEmail}
              </span>
            ) : (
              <span className="hidden sm:inline">Drive</span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenStorageSync || onSignIn}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-300 bg-slate-800/80 hover:bg-slate-700 px-2 sm:px-2.5 py-1.5 rounded-xl border border-slate-700 transition-colors cursor-pointer min-h-[32px]"
            title="Where is data saved? Click for Storage & Cloud Sync"
          >
            <DriveIcon className="text-slate-400 shrink-0" />
            <span className="text-[10px] sm:text-[11px]">Sync</span>
          </button>
        )}

        {/* OpenRouter Credits Badge (server-side key — click to refresh) */}
        <button
          type="button"
          onClick={refreshCredits}
          className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-xl border border-cyan-500/30 shadow-sm cursor-pointer hover:bg-cyan-900/60"
          title={
            credits.limit !== null
              ? `OpenRouter credits — used $${credits.usage.toFixed(2)} of $${credits.limit.toFixed(2)}. Click to refresh.`
              : 'OpenRouter credits (click to refresh)'
          }
        >
          <Wallet size={12} className="text-cyan-400" />
          <span className="text-cyan-500 font-sans text-[10px]">Credits:</span>
          {credits.limit !== null ? (
            <strong>${credits.remaining?.toFixed(2)}</strong>
          ) : credits.loading ? (
            <strong>…</strong>
          ) : (
            <strong>—</strong>
          )}
        </button>

        {/* Settings Button */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow-sm cursor-pointer min-h-[32px]"
            title="Council Settings & Safeguards"
          >
            <Settings size={14} />
            <span className="hidden sm:inline font-medium">Settings</span>
          </button>
        )}
      </div>
    </header>
  );
};
