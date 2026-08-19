import React, { useState, useRef, useEffect } from 'react';
import { Settings as SettingsIcon, Sun, Moon, ShieldAlert, MoreVertical, Cloud, RefreshCw, CheckCircle2 } from 'lucide-react';

interface HeaderActionsProps {
  theme: 'dark' | 'light' | 'system';
  onSetTheme: (t: 'dark' | 'light' | 'system') => void;
  onOpenAuditModal?: () => void;
  onOpenSettings: () => void;
  isDeliberating?: boolean;
  isSyncing?: boolean;
  onSyncWithCloud?: () => Promise<void> | void;
  lastSyncedAt?: number | null;
}

export const HeaderActions: React.FC<HeaderActionsProps> = ({
  theme,
  onSetTheme,
  onOpenAuditModal,
  onOpenSettings,
  isDeliberating,
  isSyncing,
  onSyncWithCloud,
  lastSyncedAt,
}) => {
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Close overflow menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setIsOverflowOpen(false);
      }
    };
    if (isOverflowOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOverflowOpen]);

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
      {/* Cloud Sync Status Indicator */}
      {onSyncWithCloud && (
        <button
          type="button"
          onClick={() => onSyncWithCloud()}
          className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors cursor-pointer"
          title={`${isSyncing ? 'Syncing...' : 'Sync sessions to Google Drive'}${lastSyncedAt ? ` — Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : ''}`}
        >
          {isSyncing ? (
            <RefreshCw size={11} className="animate-spin text-cyan-500" />
          ) : (
            <Cloud size={11} className="text-cyan-500" />
          )}
          <span>{isSyncing ? 'Syncing…' : 'Cloud Sync'}</span>
        </button>
      )}

      {/* Theme Toggle */}
      <button
        type="button"
        onClick={() => onSetTheme(theme === 'dark' ? 'light' : 'dark')}
        className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-amber-500 dark:hover:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        title="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      {/* Audit Log */}
      {onOpenAuditModal && (
        <button
          type="button"
          onClick={onOpenAuditModal}
          className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-cyan-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Council Request Audit Log"
        >
          <ShieldAlert size={14} />
        </button>
      )}

      {/* Overflow Utilities Menu */}
      <div className="relative" ref={overflowRef}>
        <button
          type="button"
          onClick={() => setIsOverflowOpen(!isOverflowOpen)}
          className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="More options"
        >
          <MoreVertical size={14} />
        </button>

        {isOverflowOpen && (
          <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5 space-y-0.5">
            <button
              type="button"
              onClick={() => { onOpenSettings(); setIsOverflowOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <SettingsIcon size={13} />
              <span>Settings</span>
            </button>

            {onSyncWithCloud && (
              <button
                type="button"
                onClick={() => { onSyncWithCloud(); setIsOverflowOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {isSyncing ? <RefreshCw size={13} className="animate-spin text-cyan-500" /> : <Cloud size={13} className="text-cyan-500" />}
                <span>{isSyncing ? 'Syncing…' : 'Sync to Google Drive'}</span>
              </button>
            )}

            {isSyncing && (
              <div className="flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-cyan-600 dark:text-cyan-300">
                <CheckCircle2 size={12} />
                <span>Cloud sync in progress…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
