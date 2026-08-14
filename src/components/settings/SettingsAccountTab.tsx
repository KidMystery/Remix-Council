import React from 'react';

interface SettingsAccountTabProps {
  usageData: { usage: number; limit: number | null } | null;
}

export const SettingsAccountTab: React.FC<SettingsAccountTabProps> = ({ usageData }) => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <section className="space-y-4">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account Details</h3>

        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col items-center justify-center space-y-2 py-8">
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">OpenRouter Spend</p>
          {usageData ? (
            <div className="text-center">
              <p className="text-4xl font-black text-slate-800 dark:text-white">
                ${usageData.usage.toFixed(4)}
              </p>
              {usageData.limit && (
                <div className="mt-4 w-48 bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden mx-auto">
                  <div
                    className="bg-indigo-600 h-full"
                    style={{ width: `${Math.min(100, (usageData.usage / usageData.limit) * 100)}%` }}
                  />
                </div>
              )}
              {usageData.limit && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Limit: ${usageData.limit.toFixed(2)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading usage data...</p>
          )}
        </div>
      </section>
    </div>
  );
};
