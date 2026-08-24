import React from 'react';
import { RefreshCw, LogIn, LogOut } from 'lucide-react';
import { getCurrentUserEmail } from '../../lib/drivePersistence';

interface SettingsAccountTabProps {
  usageData: { usage: number; limit: number | null; remaining?: number | null } | null;
  onRefresh?: () => void;
  isSignedIn?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
}

export const SettingsAccountTab: React.FC<SettingsAccountTabProps> = ({
  usageData,
  onRefresh,
  isSignedIn = false,
  onSignIn,
  onSignOut,
}) => {
  const remaining =
    usageData && usageData.remaining != null
      ? Math.max(0, usageData.remaining)
      : usageData && usageData.limit !== null
        ? Math.max(0, usageData.limit - usageData.usage)
        : null;
  const pct = usageData && usageData.limit ? Math.min(100, (usageData.usage / usageData.limit) * 100) : null;
  const email = getCurrentUserEmail();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Profile identity */}
      <section className="space-y-4">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Profile</h3>
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl">
          {isSignedIn ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                  {email || 'Signed in with Google'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Profile & Drive sync are linked to this Google account. Your API keys stay server-side.
                </p>
              </div>
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-400 border border-red-500/40 px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0"
                >
                  <LogOut size={12} />
                  Sign out
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sign in with Google to sync your sessions and profile to Drive.
              </p>
              {onSignIn && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0"
                >
                  <LogIn size={12} />
                  Sign in
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Credits */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account & Credits</h3>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              title="Refresh OpenRouter credits"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          )}
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col items-center justify-center space-y-2 py-8">
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">OpenRouter Credits</p>
          {usageData ? (
            <div className="text-center w-full">
              {remaining !== null ? (
                <p className="text-4xl font-black text-slate-800 dark:text-white">
                  ${remaining.toFixed(2)}
                  <span className="text-base font-semibold text-slate-500 dark:text-slate-400"> left</span>
                </p>
              ) : (
                <p className="text-4xl font-black text-slate-800 dark:text-white">
                  ${usageData.usage.toFixed(2)}
                  <span className="text-base font-semibold text-slate-500 dark:text-slate-400"> spent</span>
                </p>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Used ${usageData.usage.toFixed(4)}
                {usageData.limit !== null ? ` of $${usageData.limit.toFixed(2)} credit` : ' (credit total not reported by OpenRouter)'}
              </p>

              {pct !== null && (
                <div className="mt-4 w-48 bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden mx-auto">
                  <div
                    className={`h-full ${pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading credits… (requires a server-side OPENROUTER_API_KEY)</p>
          )}
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          Credits are read from the OpenRouter API through the server proxy, so your API key never reaches the browser.
          Usage updates after each request; click Refresh to re-check.
        </p>
      </section>
    </div>
  );
};
