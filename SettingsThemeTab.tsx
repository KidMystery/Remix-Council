import React from 'react';

interface SettingsThemeTabProps {
  theme: 'dark' | 'light' | 'system';
  setTheme: (t: 'dark' | 'light' | 'system') => void;
}

export const SettingsThemeTab: React.FC<SettingsThemeTabProps> = ({
  theme,
  setTheme,
}) => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Theme Preference</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">Choose your preferred visual appearance across the council chamber.</p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`p-3.5 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
              theme === 'light'
                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/30'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Light
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`p-3.5 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
              theme === 'dark'
                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/30'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Dark
          </button>
          <button
            type="button"
            onClick={() => setTheme('system')}
            className={`p-3.5 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
              theme === 'system'
                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/30'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            System
          </button>
        </div>
      </section>
    </div>
  );
};
