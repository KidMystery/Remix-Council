import React, { useState, useEffect } from 'react';
import { CheckCircle2, Cloud, HardDrive, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import type { AutoSaveState } from '../types';

export interface AutoSaveIndicatorProps {
  autoSaveState?: AutoSaveState;
  lastSavedAt?: number | null;
  isSaving?: boolean;
  isSyncing?: boolean;
  destination?: 'cloud' | 'local' | null;
  error?: string | null;
  onSaveNow?: () => void | Promise<void>;
  onClick?: (e: React.MouseEvent) => void;
  variant?: 'header' | 'bar' | 'compact';
  className?: string;
}

function formatRelativeTime(timestamp: number | null | undefined, now: number): { label: string; full: string } {
  if (!timestamp || timestamp <= 0) {
    return { label: 'Not saved yet', full: 'No save event recorded' };
  }

  const diffMs = Math.max(0, now - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);

  const fullDateStr = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (diffSec < 15) {
    return { label: 'Saved just now', full: `Saved at ${fullDateStr}` };
  }
  if (diffSec < 60) {
    return { label: `Saved ${diffSec}s ago`, full: `Saved at ${fullDateStr}` };
  }
  if (diffMin < 60) {
    return { label: `Saved ${diffMin}m ago`, full: `Saved at ${fullDateStr}` };
  }
  if (diffHours < 24) {
    return { label: `Saved ${diffHours}h ago`, full: `Saved at ${fullDateStr}` };
  }

  const dateShort = new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  return { label: `Saved ${dateShort}`, full: `Saved on ${dateShort} at ${fullDateStr}` };
}

export const AutoSaveIndicator: React.FC<AutoSaveIndicatorProps> = ({
  autoSaveState,
  lastSavedAt: propLastSavedAt,
  isSaving: propIsSaving,
  isSyncing: propIsSyncing,
  destination: propDestination,
  error: propError,
  onSaveNow,
  onClick,
  variant = 'header',
  className = '',
}) => {
  const lastSavedAt = autoSaveState ? autoSaveState.lastSavedAt : propLastSavedAt;
  const isSaving = autoSaveState ? autoSaveState.isSaving : propIsSaving;
  const isSyncing = autoSaveState ? autoSaveState.isSyncing : propIsSyncing;
  const destination = autoSaveState ? autoSaveState.destination : propDestination;
  const error = autoSaveState ? autoSaveState.error : propError;

  const [now, setNow] = useState(Date.now());
  const [isManualSaving, setIsManualSaving] = useState(false);

  // Periodically refresh relative time string
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleClick = async (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
      return;
    }
    if (!onSaveNow || isSaving || isSyncing || isManualSaving) return;
    e.preventDefault();
    e.stopPropagation();
    setIsManualSaving(true);
    try {
      await onSaveNow();
    } finally {
      setTimeout(() => setIsManualSaving(false), 500);
    }
  };

  const isBusy = isSaving || isSyncing || isManualSaving;
  const isActionable = Boolean(onClick || onSaveNow);
  const { label, full } = formatRelativeTime(lastSavedAt, now);

  const destinationLabel = destination === 'cloud' ? 'Google Drive' : 'LocalStorage';
  const tooltipText = isBusy
    ? isSyncing
      ? 'Syncing changes to Google Drive cloud...'
      : 'Saving changes to local storage...'
    : error
    ? `Save notice: ${error}. Click to retry.`
    : `${full} (${destinationLabel})${onClick ? ' • Click for storage & sync options' : onSaveNow ? ' • Click to sync now' : ''}`;

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={!isActionable || isBusy}
        className={`inline-flex items-center gap-1.5 text-[10px] font-mono transition-all rounded-md px-2 py-0.5 select-none ${
          isBusy
            ? 'text-cyan-400 bg-cyan-950/40 border border-cyan-500/30'
            : error
            ? 'text-amber-400 bg-amber-950/40 border border-amber-500/30 hover:bg-amber-900/50 cursor-pointer'
            : 'text-slate-400 hover:text-slate-200 bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 cursor-pointer'
        } ${className}`}
        title={tooltipText}
      >
        {isBusy ? (
          <Loader2 size={10} className="animate-spin text-cyan-400 shrink-0" />
        ) : error ? (
          <AlertCircle size={10} className="text-amber-400 shrink-0" />
        ) : (
          <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
        )}
        <span className="truncate">{isBusy ? (isSyncing ? 'Syncing...' : 'Saving...') : label}</span>
      </button>
    );
  }

  if (variant === 'bar') {
    return (
      <div
        onClick={isActionable ? handleClick : undefined}
        role={isActionable ? 'button' : undefined}
        tabIndex={isActionable ? 0 : undefined}
        className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-lg border transition-all ${
          isActionable && !isBusy ? 'cursor-pointer hover:border-slate-700 dark:hover:border-slate-600' : ''
        } ${
          isBusy
            ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
            : error
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            : destination === 'cloud'
            ? 'bg-emerald-500/10 text-emerald-300 dark:text-emerald-400 border-emerald-500/20'
            : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/60'
        } ${className}`}
        title={tooltipText}
      >
        {isBusy ? (
          <Loader2 size={11} className="animate-spin text-cyan-400 shrink-0" />
        ) : error ? (
          <AlertCircle size={11} className="text-amber-400 shrink-0" />
        ) : destination === 'cloud' ? (
          <Cloud size={11} className="text-emerald-400 shrink-0" />
        ) : (
          <HardDrive size={11} className="text-slate-400 shrink-0" />
        )}

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {isBusy ? (isSyncing ? 'Syncing to Drive...' : 'Auto-saving...') : 'Auto-saved'}
          </span>
          {!isBusy && (
            <span className="text-[10px] text-slate-400 dark:text-slate-400 opacity-90">
              • {label}
            </span>
          )}
        </div>

        {isActionable && !isBusy && (
          <RefreshCw size={9} className="text-slate-400 dark:text-slate-400 ml-0.5 opacity-60 hover:opacity-100 shrink-0" />
        )}
      </div>
    );
  }

  // Default 'header' variant (sleek, non-intrusive status pill for the top header / status bar)
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isActionable || isBusy}
      className={`group inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-lg border transition-all select-none ${
        isBusy
          ? 'bg-cyan-950/60 border-cyan-500/30 text-cyan-300 cursor-default'
          : error
          ? 'bg-amber-950/60 border-amber-500/40 text-amber-300 hover:bg-amber-900/60 cursor-pointer shadow-xs'
          : destination === 'cloud'
          ? 'bg-emerald-950/40 hover:bg-emerald-950/70 border-emerald-500/20 hover:border-emerald-500/40 text-emerald-300 hover:text-emerald-200 cursor-pointer shadow-2xs'
          : 'bg-slate-950/60 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer shadow-2xs'
      } ${className}`}
      title={tooltipText}
    >
      <div className="flex items-center gap-1 shrink-0">
        {isBusy ? (
          <Loader2 size={11} className="animate-spin text-cyan-400" />
        ) : error ? (
          <AlertCircle size={11} className="text-amber-400" />
        ) : destination === 'cloud' ? (
          <Cloud size={11} className="text-emerald-400" />
        ) : (
          <CheckCircle2 size={11} className="text-emerald-400" />
        )}
      </div>

      <div className="flex items-center gap-1 truncate">
        <span className="hidden md:inline text-[10px] uppercase font-bold tracking-wider text-slate-400 group-hover:text-slate-300">
          {destination === 'cloud' ? 'Cloud' : 'Auto-save'}:
        </span>
        <span className="truncate text-slate-300 group-hover:text-slate-100 font-medium">
          {isBusy ? (isSyncing ? 'Syncing...' : 'Saving...') : label}
        </span>
      </div>

      {isActionable && !isBusy && (
        <RefreshCw size={10} className="text-slate-400 group-hover:text-slate-300 opacity-40 group-hover:opacity-100 shrink-0 transition-opacity ml-0.5" />
      )}
    </button>
  );
};
