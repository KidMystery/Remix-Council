import React from 'react';
import {
  AlertTriangle,
  UserPlus,
  RefreshCw,
  Edit3,
  Trash2,
} from 'lucide-react';
import { Persona } from '../../types';
import {
  checkDuplicateModels,
  checkDuplicateOrganizations,
  PresetId,
} from '../../lib/presets';
import { CouncilPreset } from '../../lib/councilPresets';
import { ModelDetailsCard } from '../ModelDetailsCard';

interface SettingsPersonasTabProps {
  personas: Persona[];
  setPersonas: (p: Persona[]) => void;
  synthesizer: Persona;
  setSynthesizer: (p: Persona) => void;
  availableModels: { id: string; name: string }[];
  rawModelsCatalog?: any[];
  metadata?: any;
  presetWarnings?: string[];
  autoSelectModels?: boolean;
  setAutoSelectModels?: (val: boolean) => void;
  onRefreshModels?: (options?: { force?: boolean; applyToPersonas?: boolean }) => Promise<any>;
  refreshModelRecommendations: (options?: { force?: boolean }) => Promise<any>;
  isRefreshing?: boolean;
  isDebounced?: boolean;
  onApplyPreset: (presetId: PresetId) => void;
  onApplyCouncilPreset: (preset: CouncilPreset) => void;
  onOpenCreateModal: (persona?: Persona | null) => void;
}

export const SettingsPersonasTab: React.FC<SettingsPersonasTabProps> = ({
  personas,
  setPersonas,
  synthesizer,
  setSynthesizer,
  availableModels,
  rawModelsCatalog,
  metadata,
  presetWarnings = [],
  autoSelectModels = true,
  setAutoSelectModels,
  onRefreshModels,
  refreshModelRecommendations,
  isRefreshing,
  isDebounced,
  onApplyPreset,
  onApplyCouncilPreset,
  onOpenCreateModal,
}) => {
  const dupInfo = checkDuplicateModels(personas, synthesizer);
  const dupOrgInfo = checkDuplicateOrganizations(personas, synthesizer);

  const updatePersona = (id: string, updates: Partial<Persona>) => {
    setPersonas(personas.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const handleDeletePersona = (id: string) => {
    if (personas.length <= 1) return;
    setPersonas(personas.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Duplicate Models Warning */}
      {dupInfo.hasDuplicates && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-800 dark:text-amber-300 space-y-2 text-xs shadow-sm">
          <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
            <AlertTriangle size={15} className="text-amber-500 shrink-0" />
            <span>Duplicate Models Detected Across Active Slots</span>
          </div>
          <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
            To maximize reasoning diversity, each persona slot should be assigned a distinct model.
            Duplicates: <span className="font-mono font-semibold">{dupInfo.duplicates.join(', ')}</span>.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => onApplyPreset('fast_and_free')}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 rounded font-semibold text-[10px] transition-colors cursor-pointer"
            >
              Fix: Apply Fast & Free
            </button>
            <button
              type="button"
              onClick={() => onApplyPreset('highest_quality')}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 rounded font-semibold text-[10px] transition-colors cursor-pointer"
            >
              Fix: Apply Highest Quality
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Orgs Warning */}
      {dupOrgInfo.hasDuplicates && !dupInfo.hasDuplicates && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-800 dark:text-amber-300 space-y-2 text-xs shadow-sm">
          <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
            <AlertTriangle size={15} className="text-amber-500 shrink-0" />
            <span>Duplicate Author Organizations Detected</span>
          </div>
          <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
            To ensure maximum council diversity, each slot should be assigned a model from a different author organization.
            Shared Orgs: <span className="font-mono font-semibold uppercase">{dupOrgInfo.duplicateOrgs.join(', ')}</span>.
          </p>
        </div>
      )}

      {/* Preset Organization Diversity Warnings */}
      {presetWarnings.length > 0 && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-800 dark:text-amber-300 space-y-1.5 text-xs shadow-sm">
          <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
            <AlertTriangle size={15} className="text-amber-500 shrink-0" />
            <span>Council Organization Diversity Warning</span>
          </div>
          {presetWarnings.map((w, idx) => (
            <p key={idx} className="text-[11px] text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Persona Cards */}
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Council Members ({personas.filter((p) => p.enabled !== false).length}/{personas.length} Active)
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Toggle or edit perspectives for deliberation.</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onOpenCreateModal(null)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
              title="Add a custom persona to the council"
            >
              <UserPlus size={13} />
              <span>Add Personality</span>
            </button>

            {setAutoSelectModels && (
              <button
                type="button"
                onClick={() => setAutoSelectModels(!autoSelectModels)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 cursor-pointer ${
                  autoSelectModels
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                }`}
                title={autoSelectModels ? 'Auto-Select Models is ON (domain smart assignment enabled)' : 'Auto-Select Models is OFF (manual model choices preserved)'}
              >
                <span>Auto-Select: {autoSelectModels ? 'ON' : 'OFF'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                if (onRefreshModels) {
                  await onRefreshModels({ force: true, applyToPersonas: true });
                } else {
                  await refreshModelRecommendations({ force: true });
                }
              }}
              disabled={isRefreshing || isDebounced}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
              title="Force refresh model recommendations and update all council personality model selections"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {personas.map((persona) => {
          const isEnabled = persona.enabled !== false;
          return (
            <div
              key={persona.id}
              className={`p-3 border rounded-lg space-y-3 transition-colors shadow-sm ${
                isEnabled
                  ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50'
                  : 'border-slate-200/60 dark:border-slate-800/40 bg-slate-100/50 dark:bg-slate-900/30 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 pr-2 min-w-0" title={persona.name}>
                  <span className="text-base shrink-0">{persona.avatar}</span>
                  <span className="text-sm font-bold text-slate-800 dark:text-white whitespace-normal break-words">{persona.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider border shrink-0 ${persona.color}`}>
                    {persona.role}
                  </span>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenCreateModal(persona)}
                    className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded transition-colors"
                    title="Edit personality details"
                  >
                    <Edit3 size={14} />
                  </button>
                  {personas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeletePersona(persona.id)}
                      className="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors"
                      title="Delete persona from council"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => updatePersona(persona.id, { enabled: !isEnabled })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                    title={isEnabled ? 'Disable persona for query' : 'Enable persona for query'}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Model</label>
                <input
                  list={`models-list-${persona.id}`}
                  value={persona.model}
                  onChange={(e) => {
                    const val = e.target.value;
                    const matched = availableModels.find(
                      (m) => m.name.toLowerCase() === val.toLowerCase() || m.id.toLowerCase() === val.toLowerCase()
                    );
                    updatePersona(persona.id, { model: matched ? matched.id : val });
                  }}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="Search or select a model..."
                />
                <datalist id={`models-list-${persona.id}`}>
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </datalist>
              </div>

              {persona.model && (
                <ModelDetailsCard
                  modelId={persona.model}
                  personaRole={persona.id}
                  personaName={persona.name}
                  personaAvatar={persona.avatar}
                  rawModelsCatalog={rawModelsCatalog}
                />
              )}
            </div>
          );
        })}
      </section>

      {/* The Synthesizer */}
      <section className="space-y-4">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">The Synthesizer (The Chair)</h3>
        <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3 bg-slate-50 dark:bg-slate-800/50 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-800 dark:text-white">{synthesizer.name}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider border ${synthesizer.color}`}>
              {synthesizer.role}
            </span>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Model</label>
            <input
              list="models-list-synth"
              value={synthesizer.model}
              onChange={(e) => {
                const val = e.target.value;
                const matched = availableModels.find(
                  (m) => m.name.toLowerCase() === val.toLowerCase() || m.id.toLowerCase() === val.toLowerCase()
                );
                setSynthesizer({ ...synthesizer, model: matched ? matched.id : val });
              }}
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Search or select a model..."
            />
            <datalist id="models-list-synth">
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </div>

          {synthesizer.model && (
            <ModelDetailsCard
              modelId={synthesizer.model}
              personaRole="synthesizer"
              personaName={synthesizer.name}
              personaAvatar={synthesizer.avatar}
              rawModelsCatalog={rawModelsCatalog}
            />
          )}
        </div>
      </section>
    </div>
  );
};
