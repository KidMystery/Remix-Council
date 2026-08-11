import { X, Cpu, Palette, Bell, User, RefreshCw, Zap, Award, AlertTriangle, CheckCircle2, Coins, Scale } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Persona } from '../types';
import { MODEL_PRESETS, applyPreset, checkDuplicateModels, checkDuplicateOrganizations, PresetId } from '../lib/presets';
import { useModelRecommendations } from '../hooks/useModelRecommendations';
import { CouncilSummaryBar } from './CouncilSummaryBar';
import { ModelDetailsCard } from './ModelDetailsCard';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  personas: Persona[];
  setPersonas: (p: Persona[]) => void;
  synthesizer: Persona;
  setSynthesizer: (p: Persona) => void;
  theme: 'dark' | 'light' | 'system';
  setTheme: (t: 'dark' | 'light' | 'system') => void;
  maxTokens?: number;
  setMaxTokens?: (val: number) => void;
  executionMode?: 'auto' | 'quick_panel' | 'deep_council';
  setExecutionMode?: (mode: 'auto' | 'quick_panel' | 'deep_council') => void;
  quickPanelMaxTokens?: number;
  setQuickPanelMaxTokens?: (val: number) => void;
  synthesisMaxTokens?: number;
  setSynthesisMaxTokens?: (val: number) => void;
  panelTimeoutSeconds?: number;
  setPanelTimeoutSeconds?: (val: number) => void;
  isProCompareEnabled?: boolean;
  handleToggleProCompare?: () => void;
  setIsAuditModalOpen?: (val: boolean) => void;
}

export function SettingsPanel({ 
  isOpen, onClose, apiKey, setApiKey, personas, setPersonas, synthesizer, setSynthesizer, theme, setTheme, maxTokens = 4000, setMaxTokens,
  executionMode = 'auto', setExecutionMode, quickPanelMaxTokens = 350, setQuickPanelMaxTokens, synthesisMaxTokens = 500, setSynthesisMaxTokens, panelTimeoutSeconds = 30, setPanelTimeoutSeconds,
  isProCompareEnabled, handleToggleProCompare, setIsAuditModalOpen
}: SettingsPanelProps) {
  
  const [activeTab, setActiveTab] = useState<'personas' | 'advanced' | 'theme' | 'notifications' | 'account'>('personas');
  const [usageData, setUsageData] = useState<{usage: number, limit: number | null} | null>(null);

  const {
    metadata,
    availableModels,
    rawModelsCatalog,
    presetWarnings,
    isRefreshing,
    isDebounced,
    refreshModelRecommendations,
    formatUpdateTime,
    formatErrorTime,
  } = useModelRecommendations();

  const dupInfo = checkDuplicateModels(personas, synthesizer);
  const dupOrgInfo = checkDuplicateOrganizations(personas, synthesizer);

  const handleApplyPreset = (presetId: PresetId) => {
    const { updatedPersonas, updatedSynthesizer } = applyPreset(presetId, personas, synthesizer);
    setPersonas(updatedPersonas);
    setSynthesizer(updatedSynthesizer);
  };

  useEffect(() => {
    if (isOpen && activeTab === 'account') {
      fetch('/api/council/account', {
        headers: { ...(apiKey ? { 'X-Api-Key-Override': apiKey } : {}) }
      })
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setUsageData({ usage: d.data.usage, limit: d.data.limit });
        }
      })
      .catch(e => console.error('Failed to fetch usage:', e));
    }
  }, [isOpen, apiKey, activeTab]);

  if (!isOpen) return null;

  const updatePersona = (id: string, updates: Partial<Persona>) => {
    setPersonas(personas.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const tabs = [
    { id: 'personas', label: 'Basic Details', icon: Cpu },
    { id: 'advanced', label: 'Advanced', icon: Zap },
    { id: 'theme', label: 'Theme', icon: Palette },
    { id: 'notifications', label: 'Alerts', icon: Bell },
    { id: 'account', label: 'Account', icon: User },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20 dark:bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Settings</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="flex px-4 pt-2 space-x-6 border-b border-slate-100 dark:border-slate-800 overflow-x-auto custom-scrollbar shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {(activeTab === 'personas' || activeTab === 'advanced') && (
            <div className="space-y-6">
              {activeTab === 'advanced' && (
              <section className="space-y-3">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">OpenRouter API & Token Limits</h3>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">API Key (Optional Override)</label>
                  <input 
                    type="password" 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Defaults to server OPENROUTER_API_KEY"
                    className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors shadow-sm"
                  />
                </div>

                <div className="pt-2 space-y-2 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Text Count Window (Max Output Tokens)
                    </label>
                    <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {maxTokens} tokens
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Maximum token output limit per persona response. The Chair (synthesis phase) automatically gets double this limit (minimum 8,000 tokens) to guarantee complete consensus reports without truncation.
                  </p>
                  {setMaxTokens && (
                    <div className="space-y-2 pt-1">
                      <input
                        type="range"
                        min={1000}
                        max={16000}
                        step={1000}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {[2000, 4000, 8000, 16000].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setMaxTokens(preset)}
                            className={`px-2 py-0.5 rounded border transition-colors ${
                              maxTokens === preset
                                ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-700'
                            }`}
                          >
                            {preset === 4000 ? '4K (Default)' : `${preset / 1000}K`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>


                <div className="pt-3 space-y-3 border-t border-slate-200/60 dark:border-slate-800/60">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Features & Logs</h3>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Blind Pro Compare (Phase 2)
                    </label>
                    <button
                      type="button"
                      onClick={handleToggleProCompare}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                        isProCompareEnabled
                          ? 'bg-purple-600 text-white'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {isProCompareEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Telemetry & Audit Logs
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAuditModalOpen?.(true)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      View Logs
                    </button>
                  </div>
                </div>

                {/* Quick Panel & Deliberation Mode Configs */}
                <div className="pt-3 space-y-3 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                      Default Execution Mode
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg text-xs font-medium">
                      {(['auto', 'quick_panel', 'deep_council'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setExecutionMode?.(m)}
                          className={`py-1.5 px-2 rounded-md transition-all text-center ${
                            executionMode === m
                              ? 'bg-indigo-600 text-white font-bold shadow-sm'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {m === 'auto' ? 'Auto Router' : m === 'quick_panel' ? 'Quick Panel' : 'Deep Council'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Quick Panel Max Tokens (250–400)
                      </label>
                      <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {quickPanelMaxTokens} tokens
                      </span>
                    </div>
                    {setQuickPanelMaxTokens && (
                      <input
                        type="range"
                        min={250}
                        max={400}
                        step={25}
                        value={quickPanelMaxTokens}
                        onChange={(e) => setQuickPanelMaxTokens(parseInt(e.target.value, 10))}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Synthesis Max Tokens (400–600)
                      </label>
                      <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {synthesisMaxTokens} tokens
                      </span>
                    </div>
                    {setSynthesisMaxTokens && (
                      <input
                        type="range"
                        min={400}
                        max={600}
                        step={25}
                        value={synthesisMaxTokens}
                        onChange={(e) => setSynthesisMaxTokens(parseInt(e.target.value, 10))}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Panelist Timeout Limit
                      </label>
                      <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {panelTimeoutSeconds}s
                      </span>
                    </div>
                    {setPanelTimeoutSeconds && (
                      <input
                        type="range"
                        min={15}
                        max={60}
                        step={5}
                        value={panelTimeoutSeconds}
                        onChange={(e) => setPanelTimeoutSeconds(parseInt(e.target.value, 10))}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                    )}
                  </div>
                </div>
              </section>
              )}

              {activeTab === 'personas' && dupInfo.hasDuplicates && (
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
                      onClick={() => handleApplyPreset('fast_and_free')}
                      className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 rounded font-semibold text-[10px] transition-colors cursor-pointer"
                    >
                      Fix: Apply Fast & Free
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPreset('highest_quality')}
                      className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 rounded font-semibold text-[10px] transition-colors cursor-pointer"
                    >
                      Fix: Apply Highest Quality
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'personas' && dupOrgInfo.hasDuplicates && !dupInfo.hasDuplicates && (
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

              {activeTab === 'personas' && presetWarnings.length > 0 && (
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

              {activeTab === 'personas' && (<section className="space-y-3 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Smart Persona Auto-Selection Presets
                  </h3>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">
                    Zero Duplicates guaranteed
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Quickly fill all 4 active council slots (Skeptic, Visionary, Pragmatist, and Synthesizer) with distinct models.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('fast_and_free')}
                    className="p-3 border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-lg text-left transition-all hover:shadow-sm group cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 flex items-center gap-1.5">
                        <Zap size={14} className="text-emerald-500" />
                        Fast & Free
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded font-semibold">
                        $0 Cost
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
                      {(() => {
                        const p = MODEL_PRESETS.find(x => x.id === 'fast_and_free');
                        if (!p) return '$0 speed-optimized models';
                        return `${p.assignments.skeptic.name} • ${p.assignments.visionary.name} • ${p.assignments.pragmatist.name} • ${p.assignments.synthesizer.name}`;
                      })()}
                    </p>
                    {(() => {
                      const p = MODEL_PRESETS.find(x => x.id === 'fast_and_free');
                      if (!p) return null;
                      const overlaps = new Set<string>();
                      Object.values(p.assignments).forEach(a => {
                        if (a.alsoInPresets) a.alsoInPresets.forEach(o => overlaps.add(o));
                      });
                      if (overlaps.size === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {Array.from(overlaps).map((o, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 rounded text-[9px] font-bold">
                              Also in {o}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleApplyPreset('fast_and_cheap')}
                    className="p-3 border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 hover:border-amber-500 dark:hover:border-amber-500 rounded-lg text-left transition-all hover:shadow-sm group cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 flex items-center gap-1.5">
                        <Coins size={14} className="text-amber-500" />
                        Fast & Cheap
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded font-semibold">
                        Low Cost
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
                      {(() => {
                        const p = MODEL_PRESETS.find(x => x.id === 'fast_and_cheap');
                        if (!p) return 'Fast paid models at low cost';
                        return `${p.assignments.skeptic.name} • ${p.assignments.visionary.name} • ${p.assignments.pragmatist.name} • ${p.assignments.synthesizer.name}`;
                      })()}
                    </p>
                    {(() => {
                      const p = MODEL_PRESETS.find(x => x.id === 'fast_and_cheap');
                      if (!p) return null;
                      const overlaps = new Set<string>();
                      Object.values(p.assignments).forEach(a => {
                        if (a.alsoInPresets) a.alsoInPresets.forEach(o => overlaps.add(o));
                      });
                      if (overlaps.size === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {Array.from(overlaps).map((o, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 rounded text-[9px] font-bold">
                              Also in {o}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleApplyPreset('best_value')}
                    className="p-3 border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 hover:border-blue-500 dark:hover:border-blue-500 rounded-lg text-left transition-all hover:shadow-sm group cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 flex items-center gap-1.5">
                        <Scale size={14} className="text-blue-500" />
                        Best Value
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded font-semibold">
                        Balanced
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
                      {(() => {
                        const p = MODEL_PRESETS.find(x => x.id === 'best_value');
                        if (!p) return 'Quality-to-cost balance';
                        return `${p.assignments.skeptic.name} • ${p.assignments.visionary.name} • ${p.assignments.pragmatist.name} • ${p.assignments.synthesizer.name}`;
                      })()}
                    </p>
                    {(() => {
                      const p = MODEL_PRESETS.find(x => x.id === 'best_value');
                      if (!p) return null;
                      const overlaps = new Set<string>();
                      Object.values(p.assignments).forEach(a => {
                        if (a.alsoInPresets) a.alsoInPresets.forEach(o => overlaps.add(o));
                      });
                      if (overlaps.size === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {Array.from(overlaps).map((o, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 rounded text-[9px] font-bold">
                              Also in {o}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleApplyPreset('highest_quality')}
                    className="p-3 border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-lg text-left transition-all hover:shadow-sm group cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 flex items-center gap-1.5">
                        <Award size={14} className="text-indigo-500" />
                        Highest Quality
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded font-semibold">
                        Top Rank
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
                      {(() => {
                        const p = MODEL_PRESETS.find(x => x.id === 'highest_quality');
                        if (!p) return 'Top overall capability';
                        return `${p.assignments.skeptic.name} • ${p.assignments.visionary.name} • ${p.assignments.pragmatist.name} • ${p.assignments.synthesizer.name}`;
                      })()}
                    </p>
                    {(() => {
                      const p = MODEL_PRESETS.find(x => x.id === 'highest_quality');
                      if (!p) return null;
                      const overlaps = new Set<string>();
                      Object.values(p.assignments).forEach(a => {
                        if (a.alsoInPresets) a.alsoInPresets.forEach(o => overlaps.add(o));
                      });
                      if (overlaps.size === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {Array.from(overlaps).map((o, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 rounded text-[9px] font-bold">
                              Also in {o}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </button>
                </div>
              </section>)}

              {/* Council Summary Bar */}
              {activeTab === "personas" && <CouncilSummaryBar
                personas={personas}
                synthesizer={synthesizer}
                rawModels={rawModelsCatalog}
                updatedAt={metadata.updatedAt}
              />}

              <section className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Council Members ({personas.filter(p => p.enabled !== false).length}/{personas.length} Active)
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Toggle specific perspectives on or off for deliberation.</p>
                  </div>
                  
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <button 
                      type="button"
                      onClick={() => refreshModelRecommendations({ force: true })} 
                      disabled={isRefreshing || isDebounced} 
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed"
                      title="Force refresh model recommendations and recalculate presets"
                    >
                      <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
                      <span>{isRefreshing ? 'Refreshing…' : 'Refresh recommendations'}</span>
                    </button>

                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono text-right">
                      {metadata.sourceStatus === 'error' ? (
                        <span className="text-amber-600 dark:text-amber-400 font-sans font-medium">
                          Refresh failed — {formatErrorTime(metadata.lastSuccessfulRefresh || metadata.updatedAt)}
                        </span>
                      ) : isRefreshing ? (
                        <span className="text-indigo-600 dark:text-indigo-400 font-sans animate-pulse font-medium">
                          Updating recommendations…
                        </span>
                      ) : (
                        <span>
                          {formatUpdateTime(metadata.updatedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {personas.map(persona => {
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
                        <div className="flex items-center space-x-2">
                          <span className="text-base">{persona.avatar}</span>
                          <span className="text-sm font-bold text-slate-800 dark:text-white">{persona.name}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider border ${persona.color}`}>
                            {persona.role}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
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
                          <span className={`text-[11px] font-medium ${isEnabled ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
                            {isEnabled ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                      </div>
                      
                      {activeTab === 'personas' && <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Model</label>
                        <input 
                          list={`models-list-${persona.id}`}
                          value={persona.model}
                          onChange={(e) => updatePersona(persona.id, { model: e.target.value })}
                          className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          placeholder="Search or select a model..."
                        />
                        <datalist id={`models-list-${persona.id}`}>
                          {availableModels.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </datalist>
                      </div>}

                      {/* Detailed Model Card */}
                      {activeTab === 'personas' && persona.model && (
                        <ModelDetailsCard
                          modelId={persona.model}
                          personaRole={persona.id}
                          personaName={persona.name}
                          personaAvatar={persona.avatar}
                          rawModelsCatalog={rawModelsCatalog}
                        />
                      )}
                      
                      {activeTab === 'advanced' && <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">System Prompt</label>
                        <textarea 
                          value={persona.systemPrompt}
                          onChange={(e) => updatePersona(persona.id, { systemPrompt: e.target.value })}
                          rows={3}
                          className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
                        />
                      </div>}
                    </div>
                  );
                })}
              </section>

              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">The Synthesizer</h3>
                <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3 bg-slate-50 dark:bg-slate-800/50 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-800 dark:text-white">{synthesizer.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider border ${synthesizer.color}`}>
                        {synthesizer.role}
                      </span>
                    </div>
                    
                    {activeTab === 'personas' && <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Model</label>
                      <input 
                        list="models-list-synth"
                        value={synthesizer.model}
                        onChange={(e) => setSynthesizer({ ...synthesizer, model: e.target.value })}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        placeholder="Search or select a model..."
                      />
                      <datalist id="models-list-synth">
                        {availableModels.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </datalist>
                    </div>}

                    {/* Detailed Model Card for Synthesizer */}
                    {activeTab === 'personas' && synthesizer.model && (
                      <ModelDetailsCard
                        modelId={synthesizer.model}
                        personaRole="synthesizer"
                        personaName={synthesizer.name}
                        personaAvatar={synthesizer.avatar}
                        rawModelsCatalog={rawModelsCatalog}
                      />
                    )}
                    
                    {activeTab === 'advanced' && <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">System Prompt</label>
                      <textarea 
                        value={synthesizer.systemPrompt}
                        onChange={(e) => setSynthesizer({ ...synthesizer, systemPrompt: e.target.value })}
                        rows={4}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                    </div>}
                  </div>
              </section>
            </div>
          )}

          {activeTab === 'theme' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <section className="space-y-3">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Theme Preference</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Choose your preferred visual appearance across the council chamber.</p>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setTheme('light')} 
                    className={`p-3.5 border rounded-xl text-sm font-bold transition-all ${
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
                    className={`p-3.5 border rounded-xl text-sm font-bold transition-all ${
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
                    className={`p-3.5 border rounded-xl text-sm font-bold transition-all ${
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
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Notification Preferences</h3>
                
                <div className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/50 shadow-sm cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-white">Email Notifications</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Receive session summaries via email</p>
                  </div>
                  <div className="w-11 h-6 bg-indigo-600 rounded-full relative shadow-inner">
                    <div className="absolute right-1 top-1 bg-white w-4 h-4 rounded-full shadow transition-all"></div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'account' && (
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
                          <div className="bg-indigo-600 h-full" style={{ width: `${Math.min(100, (usageData.usage / usageData.limit) * 100)}%` }}></div>
                        </div>
                      )}
                      {usageData.limit && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                          Limit: ${usageData.limit.toFixed(2)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Loading usage data...
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-sm transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
