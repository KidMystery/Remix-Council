import React from 'react';
import { BookmarkPlus } from 'lucide-react';
import { Persona } from '../../types';
import { CouncilPreset } from '../../lib/councilPresets';
import { CouncilPreloadSelector } from '../CouncilPreloadSelector';

interface SettingsPresetsTabProps {
  personas: Persona[];
  synthesizer: Persona;
  onApplyCouncilPreset: (preset: CouncilPreset) => void;
}

export const SettingsPresetsTab: React.FC<SettingsPresetsTabProps> = ({
  personas,
  synthesizer,
  onApplyCouncilPreset,
}) => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <BookmarkPlus size={14} className="text-indigo-500" />
            Saved Council Presets (Local Storage)
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Save your preferred persona setups, model selections, and roles into local storage as named presets for instant 1-click access. You can also export or import your preset collections as JSON files.
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
