import React, { useState, useRef } from 'react';
import {
  BUILTIN_COUNCIL_PRESETS,
  CouncilPreset,
  getCustomCouncilPresets,
  saveCustomCouncilPreset,
  deleteCustomCouncilPreset,
  exportCustomPresetsJSON,
  importCustomPresetsJSON,
} from '../lib/councilPresets';
import { Persona } from '../types';
import { Sparkles, Check, BookmarkPlus, Trash2, ShieldCheck, ChevronRight, Scale, Download, Upload, Search, Copy, Edit3, Save } from 'lucide-react';

interface CouncilPreloadSelectorProps {
  onApplyCouncil: (preset: CouncilPreset) => void;
  currentPersonas: Persona[];
  currentSynthesizer: Persona;
}

export function CouncilPreloadSelector({
  onApplyCouncil,
  currentPersonas,
  currentSynthesizer,
}: CouncilPreloadSelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [customPresets, setCustomPresets] = useState<CouncilPreset[]>(() => getCustomCouncilPresets());
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleSaveCurrentAsPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;

    const newPreset: CouncilPreset = {
      id: `custom-council-${Date.now()}`,
      name: newPresetName.trim(),
      badge: '⭐ Custom Council',
      description: newPresetDesc.trim() || `User-defined setup with ${currentPersonas.length} panel members and ${currentSynthesizer.name}.`,
      category: 'custom',
      personas: currentPersonas,
      synthesizer: currentSynthesizer,
      isCustom: true,
      createdAt: Date.now(),
    };

    const updated = saveCustomCouncilPreset(newPreset);
    setCustomPresets(updated);
    setNewPresetName('');
    setNewPresetDesc('');
    setIsSavingCustom(false);
    showToast(`Saved custom preset: "${newPreset.name}" to local storage`);
  };

  const handleCloneAsPreset = (preset: CouncilPreset) => {
    const cloned: CouncilPreset = {
      ...preset,
      id: `custom-council-${Date.now()}`,
      name: `${preset.name} (Copy)`,
      badge: '⭐ Custom Copy',
      category: 'custom',
      isCustom: true,
      createdAt: Date.now(),
    };
    const updated = saveCustomCouncilPreset(cloned);
    setCustomPresets(updated);
    showToast(`Cloned "${preset.name}" into your custom presets!`);
  };

  const handleUpdatePresetWithActive = (presetId: string, name: string) => {
    const updatedPreset: CouncilPreset = {
      id: presetId,
      name,
      badge: '⭐ Updated Custom',
      description: `Updated on ${new Date().toLocaleDateString()} with ${currentPersonas.length} personas.`,
      category: 'custom',
      personas: currentPersonas,
      synthesizer: currentSynthesizer,
      isCustom: true,
      createdAt: Date.now(),
    };
    const updated = saveCustomCouncilPreset(updatedPreset);
    setCustomPresets(updated);
    setEditingPresetId(null);
    showToast(`Updated "${name}" with current active personas!`);
  };

  const handleDeleteCustom = (id: string, name: string) => {
    const updated = deleteCustomCouncilPreset(id);
    setCustomPresets(updated);
    showToast(`Deleted custom preset: "${name}"`);
  };

  const handleExportPresets = () => {
    const json = exportCustomPresetsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `council_custom_presets_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${customPresets.length} saved custom presets to file`);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const res = importCustomPresetsJSON(text);
        if (res.success && res.presets) {
          setCustomPresets(res.presets);
          showToast(res.message);
        } else {
          showToast(`Import Error: ${res.message}`);
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const allPresets = [...customPresets, ...BUILTIN_COUNCIL_PRESETS];

  const filteredPresets = allPresets.filter((p) => {
    const matchesCategory = selectedCategory === 'all' ? true : p.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.personas.some(pers => pers.name.toLowerCase().includes(q) || pers.role.toLowerCase().includes(q));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-4">
      {toastMsg && (
        <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center justify-between animate-in fade-in duration-200 shadow-sm">
          <span className="flex items-center gap-1.5">
            <Check size={14} className="text-emerald-500 shrink-0" />
            {toastMsg}
          </span>
        </div>
      )}

      {/* Hidden file input for import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        accept=".json"
        className="hidden"
      />

      {/* Domain Council Category Tabs & Storage Toolbar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search presets or roles..."
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Import JSON */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-semibold transition-colors border border-slate-200 dark:border-slate-700"
              title="Import saved presets from JSON file"
            >
              <Upload size={12} />
              <span className="hidden sm:inline">Import</span>
            </button>

            {/* Export JSON */}
            <button
              type="button"
              onClick={handleExportPresets}
              disabled={customPresets.length === 0}
              className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-semibold transition-colors border border-slate-200 dark:border-slate-700"
              title={customPresets.length === 0 ? "No custom presets to export" : "Export custom presets to JSON file"}
            >
              <Download size={12} />
              <span className="hidden sm:inline">Export ({customPresets.length})</span>
            </button>

            {/* Save Custom Setup Toggle */}
            <button
              type="button"
              onClick={() => setIsSavingCustom(!isSavingCustom)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold shrink-0 transition-colors shadow-sm cursor-pointer"
            >
              <BookmarkPlus size={13} />
              <span>Save Current Council</span>
            </button>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
          {[
            { id: 'all', label: `All (${allPresets.length})` },
            { id: 'custom', label: `⭐ Saved (${customPresets.length})` },
            { id: 'general', label: '🏛️ General' },
            { id: 'finance', label: '💼 Finance' },
            { id: 'life', label: '🌿 Life & Health' },
            { id: 'tech', label: '💻 Tech Stack' },
            { id: 'product', label: '🚀 Product' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                selectedCategory === cat.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save Custom Setup Card Form */}
      {isSavingCustom && (
        <form
          onSubmit={handleSaveCurrentAsPreset}
          className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl space-y-2.5 animate-in fade-in duration-200"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
              <BookmarkPlus size={14} className="text-indigo-500" />
              Save Active Setup to Local Storage
            </span>
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-medium">
              {currentPersonas.length} personas + {currentSynthesizer.name}
            </span>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              required
              placeholder="Preset Name (e.g., Code Review Board, Legal & Tax Council)"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Optional description / notes for this configuration..."
              value={newPresetDesc}
              onChange={(e) => setNewPresetDesc(e.target.value)}
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsSavingCustom(false)}
              className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newPresetName.trim()}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1 cursor-pointer"
              title={!newPresetName.trim() ? "Enter a preset name to save" : "Save preset to local storage"}
            >
              <Save size={13} />
              <span>Save Preset</span>
            </button>
          </div>
        </form>
      )}

      {/* Council Cards Grid */}
      <div className="grid grid-cols-1 gap-3">
        {filteredPresets.length === 0 ? (
          <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/40 space-y-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              No presets found matching "{searchQuery || selectedCategory}".
            </p>
            <p className="text-[11px] text-slate-400">
              Try saving your current council setup or adjusting your search query!
            </p>
          </div>
        ) : (
          filteredPresets.map((preset) => {
            const isEditingThis = editingPresetId === preset.id;
            return (
              <div
                key={preset.id}
                className={`p-3.5 border rounded-xl space-y-2.5 transition-all shadow-sm ${
                  preset.isCustom
                    ? 'border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white whitespace-normal break-words">{preset.name}</h4>
                      <span className={`text-[9px] px-2 py-0.5 font-semibold rounded-full border ${
                        preset.isCustom
                          ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 font-bold'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}>
                        {preset.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug whitespace-normal break-words">
                      {preset.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Clone into custom */}
                    <button
                      type="button"
                      onClick={() => handleCloneAsPreset(preset)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-colors"
                      title="Clone this configuration into custom presets"
                    >
                      <Copy size={13} />
                    </button>

                    {preset.isCustom && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleUpdatePresetWithActive(preset.id, preset.name)}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors"
                          title="Overwrite this saved preset with active current council setup"
                        >
                          <Save size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustom(preset.id, preset.name)}
                          className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Delete custom preset from local storage"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        onApplyCouncil(preset);
                        showToast(`Loaded preset "${preset.name}" into active council!`);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
                    >
                      <span>Apply</span>
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>

                {/* Council Personalities List */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                  {preset.personas.map((p) => (
                    <div
                      key={p.id}
                      className="p-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-lg flex items-center justify-between text-[10px] gap-1"
                    >
                      <div className="flex items-center gap-1.5 min-w-0" title={p.name}>
                        <span className="shrink-0">{p.avatar}</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200 whitespace-normal break-words">{p.name}</span>
                      </div>
                      <span className="font-mono text-[9px] text-slate-500 dark:text-slate-400 shrink-0 bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 whitespace-normal break-words max-w-[120px]" title={p.model}>
                        {p.model?.split('/')[1] || p.model}
                      </span>
                    </div>
                  ))}

                  {/* Chair */}
                  <div className="p-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between text-[10px] gap-1">
                    <div className="flex items-center gap-1.5 min-w-0" title={preset.synthesizer.name}>
                      <span className="shrink-0">{preset.synthesizer.avatar}</span>
                      <span className="font-bold text-amber-900 dark:text-amber-200 whitespace-normal break-words">
                        {preset.synthesizer.name}
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-amber-700 dark:text-amber-400 shrink-0 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30 whitespace-normal break-words max-w-[120px]" title={preset.synthesizer.model}>
                      {preset.synthesizer.model?.split('/')[1] || preset.synthesizer.model}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

