import React, { useState, useRef, useEffect } from 'react';
import { Settings as SettingsIcon, Sun, Moon, ShieldAlert, LogIn, LogOut, User as UserIcon, MoreVertical } from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderActionsProps {
  theme: 'dark' | 'light' | 'system';
  onSetTheme: (t: 'dark' | 'light' | 'system') => void;
  onOpenAuditModal?: () => void;
  onOpenSettings: () => void;
  user?: User | null;
  onLogin?: () => void;
  onLogout?: () => void;
  isDeliberating?: boolean;
}

export const HeaderActions: React.FC<HeaderActionsProps> = ({
  theme,
  onSetTheme,
  onOpenAuditModal,
  onOpenSettings,
  user,
  onLogin,
  onLogout,
  isDeliberating,
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
      {/* Settings Modal Trigger */}
      <button
        type="button"
        onClick={onOpenSettings}
        disabled={isDeliberating}
        className="min-w-[36px] min-h-[36px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center cursor-pointer shadow-xs"
        title={isDeliberating ? "Settings unavailable during active deliberation" : "Chamber Settings & Data Management"}
      >
        <SettingsIcon size={16} />
      </button>

      {/* Overflow Utilities Menu (Theme Switcher, Audit Log, User Profile / Auth) */}
      <div className="relative" ref={overflowRef}>
        <button
          type="button"
          onClick={() => setIsOverflowOpen(!isOverflowOpen)}
          className={`min-w-[36px] min-h-[36px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl border transition-all flex items-center justify-center cursor-pointer shadow-xs ${
            isOverflowOpen
              ? 'bg-slate-100 dark:bg-slate-800 border-cyan-500/50 text-cyan-600 dark:text-cyan-400'
              : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
          }`}
          title="More tools & options"
        >
          <MoreVertical size={16} />
        </button>

        {isOverflowOpen && (
          <div className="absolute right-0 mt-1.5 w-56 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 z-50 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Theme Toggle in Overflow */}
            <button
              type="button"
              onClick={() => {
                onSetTheme(theme === 'dark' ? 'light' : 'dark');
                setIsOverflowOpen(false);
              }}
              className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-indigo-400" />}
                <span>Theme: {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 uppercase">Switch</span>
            </button>

            {/* Audit Log / Routing Trace in Overflow */}
            {onOpenAuditModal && (
              <button
                type="button"
                onClick={() => {
                  onOpenAuditModal();
                  setIsOverflowOpen(false);
                }}
                className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <ShieldAlert size={15} className="text-indigo-500" />
                <span>Audit & Routing Trace</span>
              </button>
            )}

            <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

            {/* User Account / Sync in Overflow */}
            {user ? (
              <div className="p-2 bg-slate-50 dark:bg-slate-950/60 rounded-xl space-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-6 h-6 rounded-full border border-cyan-500/50 shadow-xs object-cover shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-cyan-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {user.displayName ? user.displayName.slice(0, 1).toUpperCase() : <UserIcon size={12} />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {user.displayName || 'Signed In'}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                  </div>
                </div>
                {onLogout && (
                  <button
                    type="button"
                    onClick={() => {
                      onLogout();
                      setIsOverflowOpen(false);
                    }}
                    className="w-full py-1.5 px-2 rounded-lg text-left text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <LogOut size={13} />
                    <span>Log Out</span>
                  </button>
                )}
              </div>
            ) : (
              onLogin && (
                <button
                  type="button"
                  onClick={() => {
                    onLogin();
                    setIsOverflowOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-left text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <LogIn size={15} />
                  <span>Sign In with Google</span>
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};


