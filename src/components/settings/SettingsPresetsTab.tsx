import React from 'react';
import { BookmarkPlus, Zap, Coins, Scale, Award, Check } from 'lucide-react';
import { Persona } from '../../types';
import { CouncilPreset } from '../../lib/councilPresets';
import { PresetId, MODEL_PRESETS, RawOpenRouterModel } from '../../lib/presets';
import { CouncilPreloadSelector } from '../CouncilPreloadSelector';

interface SettingsPresetsTabProps {
  personas: Persona[];
  synthesizer: Persona;
  activePresetId?: PresetId | string;
  onApplyPreset?: (presetId: PresetId) => void;
  onApplyCouncilPreset: (preset: CouncilPreset) => void;
  rawModelsCatalog?: RawOpenRouterModel[] | null;
}

export const SettingsPresetsTab: React.FC<SettingsPresetsTabProps> = ({
  personas,
  synthesizer,
  activePresetId = 'fast_and_free',
  onApplyPreset,
  onApplyCouncilPreset,
  rawModelsCatalog,
}) => {
  const getPresetIcon = (id: PresetId) => {
    switch (id) {
      case 'fast_and_free':
        return <Zap size={16} className="text-emerald-500 shrink-0" />;
      case 'fast_and_cheap':
        return <Coins size={16} className="text-amber-500 shrink-0" />;
      case 'best_value':
        return <Scale size={16} className="text-blue-500 shrink-0" />;
      case 'highest_quality':
        return <Award size={16} className="text-indigo-500 shrink-0" />;
      default:
        return <Zap size={16} className="text-emerald-500 shrink-0" />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* 1. Dynamic Presets Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Zap size={14} className="text-indigo-500" />
            Dynamic Model Presets
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Switch council configurations with 1-click presets optimized for speed, cost, or quality.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {MODEL_PRESETS.map((preset) => {
            const isActive = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyPreset?.(preset.id)}
                className={`p-3.5 rounded-xl border text-left flex flex-col justify-between gap-2 transition-all cursor-pointer select-none ${
                  isActive
                    ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500 dark:border-indigo-400 shadow-xs ring-1 ring-indigo-500/30'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getPresetIcon(preset.id)}
                    <span className="font-bold text-sm text-slate-900 dark:text-white whitespace-normal break-words">
                      {preset.name}
                    </span>
                  </div>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/60 px-2 py-0.5 rounded-full shrink-0">
                      <Check size={11} />
                      Active
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-normal break-words">
                  {preset.description}
                </p>

                {preset.id === 'fast_and_free' && preset.freeTierAvailable === false && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 whitespace-normal break-words">
                    ⚠ No zero-cost models live right now — this preset will use the cheapest
                    paid models (flagged in the summary bar) until the free tier returns.
                  </p>
                )}

                <div className="pt-1 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span className="font-medium">{preset.badge}</span>
                  <span className="text-[10px] text-slate-500">4 models</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Custom Saved Council Presets (Local Storage) */}
      <section className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <BookmarkPlus size={14} className="text-indigo-500" />
            Saved Council Presets (Local Storage)
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Save your custom persona setups and roles into local storage as named presets for instant 1-click access.
        </p>
        <CouncilPreloadSelector
          onApplyCouncil={onApplyCouncilPreset}
          currentPersonas={personas}
          currentSynthesizer={synthesizer}
        />
      </section>
    </div>
  );
};
