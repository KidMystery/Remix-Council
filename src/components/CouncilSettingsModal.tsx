import React, { useState } from 'react';
import { Shield, Key, DollarSign, Users, X, Check, Sliders, ShieldAlert, Cpu, Sparkles } from 'lucide-react';
import type { CouncilPersona, CostCeilingConfig } from '../types';
import { ARCHETYPE_LIBRARY, instantiateArchetype } from '../lib/archetypes';

export interface CouncilSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  personas: CouncilPersona[];
  onUpdatePersonas: (updated: CouncilPersona[]) => void;
  costCeiling: CostCeilingConfig;
  onUpdateCostCeiling: (updated: CostCeilingConfig) => void;
}

export const CouncilSettingsModal: React.FC<CouncilSettingsModalProps> = ({
  isOpen,
  onClose,
  personas,
  onUpdatePersonas,
  costCeiling,
  onUpdateCostCeiling,
}) => {
  const [activeTab, setActiveTab] = useState<'budget' | 'archetypes' | 'access'>('budget');
  const [localCeiling, setLocalCeiling] = useState<CostCeilingConfig>(costCeiling);
  const [councilSecret, setCouncilSecret] = useState('');

  if (!isOpen) return null;

  const handleSaveBudget = () => {
    onUpdateCostCeiling(localCeiling);
    onClose();
  };

  const handleToggleArchetype = (archetypeId: string) => {
    const existingIdx = personas.findIndex((p) => p.archetypeId === archetypeId);
    if (existingIdx >= 0) {
      // Toggle enabled
      const next = [...personas];
      next[existingIdx] = { ...next[existingIdx], enabled: !next[existingIdx].enabled };
      onUpdatePersonas(next);
    } else {
      // Instantiate and add
      const newPersona = instantiateArchetype(archetypeId);
      onUpdatePersonas([...personas, newPersona]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-cyan-950 border border-cyan-800 rounded-xl text-cyan-400">
              <Sliders size={18} />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-100">Council Chamber Preferences</h3>
              <p className="text-[11px] text-slate-400">Manage spend limits, panel archetypes, and security</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Streamlined Tab Switcher */}
        <div className="flex items-center gap-1 px-6 pt-3 pb-1 border-b border-slate-800/80 bg-slate-950/40 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('budget')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t-xl transition-colors border-b-2 ${
              activeTab === 'budget'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <DollarSign size={13} />
            <span>Budget & Cost Safeguards</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('archetypes')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t-xl transition-colors border-b-2 ${
              activeTab === 'archetypes'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users size={13} />
            <span>Archetype Library</span>
          </button>
        </div>

        {/* Modal Tab Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === 'budget' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-3">
                <label className="block text-xs font-semibold text-slate-200">
                  Pre-Execution Approval Threshold ($ USD)
                </label>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  The council will pause and prompt for explicit confirmation before running any autonomous mission iteration estimated above this cost.
                </p>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      value={localCeiling.requireApprovalAboveDollars}
                      onChange={(e) =>
                        setLocalCeiling((prev) => ({
                          ...prev,
                          requireApprovalAboveDollars: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full bg-slate-900 text-slate-100 text-xs pl-7 pr-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                  <span className="text-xs text-slate-400 font-mono">USD / task</span>
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-3">
                <label className="block text-xs font-semibold text-slate-200">
                  Hard Session Spend Ceiling ($ USD)
                </label>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Automatic fail-safe hard stop. Total multi-agent deliberation halts once this aggregate limit is reached.
                </p>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0.1"
                      value={localCeiling.maxSpendPerMissionDollars}
                      onChange={(e) =>
                        setLocalCeiling((prev) => ({
                          ...prev,
                          maxSpendPerMissionDollars: parseFloat(e.target.value) || 1,
                        }))
                      }
                      className="w-full bg-slate-900 text-slate-100 text-xs pl-7 pr-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                  <span className="text-xs text-slate-400 font-mono">USD / session</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'archetypes' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400 mb-2">
                Select specialist personas to include in the multi-model deliberation panel:
              </p>
              <div className="grid grid-cols-1 gap-2.5">
                {ARCHETYPE_LIBRARY.map((arch) => {
                  const persona = personas.find((p) => p.archetypeId === arch.id || p.name === arch.name);
                  const isEnabled = persona ? persona.enabled !== false : false;

                  return (
                    <div
                      key={arch.id}
                      onClick={() => handleToggleArchetype(arch.id)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                        isEnabled
                          ? 'bg-cyan-950/40 border-cyan-500/50 shadow-md'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-100">{arch.name}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300">
                            {arch.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">{arch.role}</p>
                      </div>
                      <div
                        className={`h-5 w-5 rounded-md flex items-center justify-center border transition-all ${
                          isEnabled
                            ? 'bg-cyan-500 border-cyan-400 text-slate-950'
                            : 'border-slate-700 bg-slate-900'
                        }`}
                      >
                        {isEnabled && <Check size={12} className="stroke-[3]" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-3.5 border-t border-slate-800 bg-slate-900/90">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveBudget}
            className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg transition-all"
          >
            Apply & Save
          </button>
        </div>
      </div>
    </div>
  );
};
