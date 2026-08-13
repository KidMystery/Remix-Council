import React, { useRef } from 'react';
import { Settings as SettingsIcon, Sun, Moon, ShieldAlert, Sparkles, Download, Upload, Zap, Layers, Cpu } from 'lucide-react';
import { ExecutionMode } from '../types';
import { PresetId } from '../lib/presets';

interface HeaderActionsProps {
  executionMode: ExecutionMode;
  onUpdateExecutionMode: (mode: ExecutionMode) => void;
  isProCompareEnabled?: boolean;
  onToggleProCompare?: () => void;
  activePresetId?: PresetId;
  onApplyPreset?: (id: PresetId) => void;
  theme: 'dark' | 'light' | 'system';
  onSetTheme: (t: 'dark' | 'light' | 'system') => void;
  onOpenAuditModal?: () => void;
  onExportSessions?: () => void;
  onImportSessions?: (file: File) => void;
  onOpenSettings: () => void;
  maxRoundCostCeiling?: number;
  stopAfterStage1?: boolean;
  useSingleModelForSimple?: boolean;
}

export const HeaderActions: React.FC<HeaderActionsProps> = ({
  executionMode,
  onUpdateExecutionMode,
  isProCompareEnabled,
  onToggleProCompare,
  activePresetId,
  onApplyPreset,
  theme,
  onSetTheme,
  onOpenAuditModal,
  onExportSessions,
  onImportSessions,
  onOpenSettings,
  maxRoundCostCeiling,
  stopAfterStage1,
  useSingleModelForSimple,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImportSessions) {
      onImportSessions(file);
    }
    if (e.target) e.target.value = '';
  };

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
      {/* Execution Mode Selector */}
      <div className="hidden md:flex items-center p-0.5 bg-slate-200/80 dark:bg-slate-800/80 rounded-lg border border-slate-300/60 dark:border-slate-700/60 text-[11px] font-mono">
        <button
          type="button"
          onClick={() => onUpdateExecutionMode('auto')}
          className={`px-2 py-1 rounded-md font-medium transition-all ${
            executionMode === 'auto'
              ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
          title="Auto: Intelligence router dynamically selects mode"
        >
          Auto
        </button>
        <button
          type="button"
          onClick={() => onUpdateExecutionMode('quick_panel')}
          className={`px-2 py-1 rounded-md font-medium transition-all ${
            executionMode === 'quick_panel'
              ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
          title="Quick Panel: Fast single-stage evaluation"
        >
          Quick
        </button>
        <button
          type="button"
          onClick={() => onUpdateExecutionMode('deep_council')}
          className={`px-2 py-1 rounded-md font-medium transition-all ${
            executionMode === 'deep_council'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
          title="Deep Council: Multi-stage peer review and synthesis"
        >
          Deep
        </button>
      </div>

      {/* Pro Comparison Toggle */}
      {onToggleProCompare && (
        <button
          type="button"
          onClick={onToggleProCompare}
          className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition-all ${
            isProCompareEnabled
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
          title="Toggle Gemini 2.5 Pro Comparison Benchmark"
        >
          <Sparkles size={14} className={isProCompareEnabled ? 'text-amber-500' : ''} />
          <span className="hidden lg:inline">Pro Benchmark</span>
        </button>
      )}

      {/* JSON Session Export / Import */}
      {onExportSessions && (
        <button
          type="button"
          onClick={onExportSessions}
          className="p-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex items-center gap-1 text-xs font-mono"
          title="Export thread sessions as JSON"
        >
          <Download size={14} />
          <span className="hidden xl:inline">Export JSON</span>
        </button>
      )}

      {onImportSessions && (
        <>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json,application/json"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex items-center gap-1 text-xs font-mono"
            title="Import thread sessions from JSON file"
          >
            <Upload size={14} />
            <span className="hidden xl:inline">Import JSON</span>
          </button>
        </>
      )}

      {/* Theme Toggle */}
      <button
        type="button"
        onClick={() => onSetTheme(theme === 'dark' ? 'light' : 'dark')}
        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
        title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
      >
        {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-slate-600" />}
      </button>

      {/* Audit Log Modal Trigger */}
      {onOpenAuditModal && (
        <button
          type="button"
          onClick={onOpenAuditModal}
          className="p-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
          title="View Audit Log & Model Routing Trace"
        >
          <ShieldAlert size={15} className="text-indigo-500" />
        </button>
      )}

      {/* Settings Panel Trigger */}
      <button
        type="button"
        onClick={onOpenSettings}
        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
        title="Open Settings"
      >
        <SettingsIcon size={15} />
      </button>
    </div>
  );
};
