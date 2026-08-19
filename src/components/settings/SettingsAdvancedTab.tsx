import React, { useRef } from 'react';
import { Download, Upload, Database, Search } from 'lucide-react';
import { Persona } from '../../types';

interface SettingsAdvancedTabProps {
  personas: Persona[];
  setPersonas: (p: Persona[]) => void;
  synthesizer: Persona;
  setSynthesizer: (p: Persona) => void;
  maxTokens: number;
  setMaxTokens?: (val: number) => void;
  executionMode: 'auto' | 'quick_panel' | 'deep_council';
  setExecutionMode?: (mode: 'auto' | 'quick_panel' | 'deep_council') => void;
  webMode?: 'off' | 'auto' | 'always';
  setWebMode?: (mode: 'off' | 'auto' | 'always') => void;
  quickPanelMaxTokens: number;
  setQuickPanelMaxTokens?: (val: number) => void;
  synthesisMaxTokens: number;
  setSynthesisMaxTokens?: (val: number) => void;
  panelTimeoutSeconds: number;
  setPanelTimeoutSeconds?: (val: number) => void;
  isProCompareEnabled?: boolean;
  handleToggleProCompare?: () => void;
  setIsAuditModalOpen?: (val: boolean) => void;
  maxRoundCostCeiling: number;
  setMaxRoundCostCeiling?: (val: number) => void;
  stopAfterStage1: boolean;
  setStopAfterStage1?: (val: boolean) => void;
  useSingleModelForSimple: boolean;
  setUseSingleModelForSimple?: (val: boolean) => void;
  archivistRecentRounds?: number;
  setArchivistRecentRounds?: (val: number) => void;
  proCompareModelId?: string;
  setProCompareModelId?: (modelId: string) => void;
  disableFallback?: boolean;
  setDisableFallback?: (val: boolean) => void;
  disableLoadingOverlay?: boolean;
  setDisableLoadingOverlay?: (val: boolean) => void;
  availableModels?: { id: string; name: string }[];
  onExportSessions?: () => void;
  onImportSessions?: (file: File) => void;
  sessionsCount?: number;
}

export const SettingsAdvancedTab: React.FC<SettingsAdvancedTabProps> = ({
  personas,
  setPersonas,
  synthesizer,
  setSynthesizer,
  maxTokens,
  setMaxTokens,
  executionMode,
  setExecutionMode,
  webMode = 'auto',
  setWebMode,
  quickPanelMaxTokens,
  setQuickPanelMaxTokens,
  synthesisMaxTokens,
  setSynthesisMaxTokens,
  panelTimeoutSeconds,
  setPanelTimeoutSeconds,
  isProCompareEnabled,
  handleToggleProCompare,
  setIsAuditModalOpen,
  maxRoundCostCeiling,
  setMaxRoundCostCeiling,
  stopAfterStage1,
  setStopAfterStage1,
  useSingleModelForSimple,
  setUseSingleModelForSimple,
  archivistRecentRounds = 2,
  setArchivistRecentRounds,
  proCompareModelId = 'anthropic/claude-3.7-sonnet',
  setProCompareModelId,
  disableFallback = false,
  setDisableFallback,
  disableLoadingOverlay = false,
  setDisableLoadingOverlay,
  availableModels = [],
  onExportSessions,
  onImportSessions,
  sessionsCount,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImportSessions) {
      onImportSessions(file);
    }
    if (e.target) e.target.value = '';
  };

  const updatePersona = (id: string, updates: Partial<Persona>) => {
    setPersonas(personas.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  return (
    <div className="space-y-6">
      {/* Data & Backup Management (Export & Import) */}
      {(onExportSessions || onImportSessions) && (
        <section className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-cyan-500" />
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider font-mono">
              Data & Deliberation Backups
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Export all stored deliberation threads, evaluations, and synthesizer consensus records as a standalone JSON backup file, or restore threads from a previous export.
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {onExportSessions && (
              <button
                type="button"
                onClick={onExportSessions}
                disabled={sessionsCount !== undefined && sessionsCount === 0}
                className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 transition-all flex items-center gap-2 text-xs font-semibold shadow-xs cursor-pointer"
                title={sessionsCount === 0 ? "No deliberation threads to export" : "Export threads as JSON file"}
              >
                <Download size={15} className="text-cyan-500" />
                <span>Export Sessions (JSON)</span>
                {sessionsCount !== undefined && sessionsCount > 0 && (
                  <span className="text-[10px] font-mono bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-1.5 py-0.2 rounded-full">
                    {sessionsCount}
                  </span>
                )}
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
                  className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 transition-all flex items-center gap-2 text-xs font-semibold shadow-xs cursor-pointer"
                  title="Import and restore deliberation sessions from JSON file"
                >
                  <Upload size={15} className="text-indigo-500" />
                  <span>Import Sessions (JSON)</span>
                </button>
              </>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Token Output Limits</h3>


        <div className="space-y-2">
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

        {/* Features & Logs */}
        <div className="pt-3 space-y-3 border-t border-slate-200/60 dark:border-slate-800/60">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Features & Logs</h3>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Blind Pro Compare (Phase 2)
              </label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Runs an independent adversarial evaluation alongside council consensus.
              </p>
            </div>
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

          {/* Pro Compare Model Selector */}
          {isProCompareEnabled && (
            <div className="p-3 bg-purple-50/60 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800/50 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-purple-900 dark:text-purple-300">
                  Target "Pro" Model
                </label>
                <span className="text-[10px] font-mono text-purple-700 dark:text-purple-400">
                  {proCompareModelId}
                </span>
              </div>
              {setProCompareModelId && (
                <select
                  value={proCompareModelId}
                  onChange={(e) => setProCompareModelId(e.target.value)}
                  aria-label="Target Pro Model for Blind Comparison"
                  className="w-full text-xs font-mono p-2 rounded-md bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  <optgroup label="Recommended Pro Engines">
                    <option value="anthropic/claude-3.7-sonnet">Claude 3.7 Sonnet (Anthropic)</option>
                    <option value="openai/gpt-4o">GPT-4o (OpenAI)</option>
                    <option value="google/gemini-2.5-pro">Gemini 2.5 Pro (Google)</option>
                    <option value="deepseek/deepseek-r1">DeepSeek R1 (DeepSeek)</option>
                    <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B (Meta)</option>
                    <option value="qwen/qwen-2.5-72b-instruct">Qwen 2.5 72B (Alibaba)</option>
                  </optgroup>
                  {availableModels.length > 0 && (
                    <optgroup label="All Available Models">
                      {availableModels
                        .filter(
                          (m) =>
                            ![
                              'anthropic/claude-3.7-sonnet',
                              'openai/gpt-4o',
                              'google/gemini-2.5-pro',
                              'deepseek/deepseek-r1',
                              'meta-llama/llama-3.3-70b-instruct',
                              'qwen/qwen-2.5-72b-instruct',
                            ].includes(m.id)
                        )
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              )}
              <p className="text-[10px] text-purple-700/80 dark:text-purple-300/70 leading-relaxed">
                Uses the adversarial evaluation system prompt to critically review, challenge assumptions, and independently benchmark against the council's synthesized output.
              </p>
            </div>
          )}

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

        {/* Execution Mode Configs */}
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
                Per-Round Cost Ceiling
              </label>
              <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                {maxRoundCostCeiling > 0 ? `${maxRoundCostCeiling.toFixed(2)} USD` : 'Unlimited'}
              </span>
            </div>
            {setMaxRoundCostCeiling && (
              <input
                type="range"
                min={0}
                max={1.0}
                step={0.05}
                value={maxRoundCostCeiling}
                onChange={(e) => setMaxRoundCostCeiling(parseFloat(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            )}
            <p className="text-[11px] text-slate-500">
              Auto-abort remaining stages if round cumulative cost exceeds ceiling.
            </p>
          </div>

          <div className="pt-2 space-y-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <label className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Stop after Stage 1 (Skip Peer Review)</span>
              <input
                type="checkbox"
                checked={stopAfterStage1}
                onChange={(e) => setStopAfterStage1?.(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
            </label>
            <p className="text-[11px] text-slate-500">
              Bypasses Stage 2 peer review and proceeds directly to consensus synthesis.
            </p>
          </div>

          <div className="pt-2 space-y-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <label className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Use Single Model for Simple Questions</span>
              <input
                type="checkbox"
                checked={useSingleModelForSimple}
                onChange={(e) => setUseSingleModelForSimple?.(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
            </label>
            <p className="text-[11px] text-slate-500">
              For quick panel requests, uses 1 single primary model instead of full multi-panel deliberation.
            </p>
          </div>

          <div className="pt-2 space-y-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <label className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Strict No-Fallback Mode</span>
              <input
                type="checkbox"
                checked={disableFallback}
                onChange={(e) => setDisableFallback?.(e.target.checked)}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
            </label>
            <p className="text-[11px] text-slate-500">
              Disables silent fallback to alternative or free models. If your chosen model fails or errors, the raw error will be reported directly so you can diagnose and fix it.
            </p>
          </div>

          <div className="pt-2 space-y-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <label className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <span>Show Deliberation Screen Overlay</span>
              <input
                type="checkbox"
                checked={!disableLoadingOverlay}
                onChange={(e) => setDisableLoadingOverlay?.(!e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
            </label>
            <p className="text-[11px] text-slate-500">
              When turned off, disables the full-screen "Council Deliberating" overlay so you can observe live model streaming and persona interactions directly in the feed without interruption.
            </p>
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
                max={180}
                step={15}
                value={panelTimeoutSeconds}
                onChange={(e) => setPanelTimeoutSeconds(parseInt(e.target.value, 10))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            )}
          </div>

          {/* Archivist Memory Recent Rounds Window */}
          <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Archivist Recent Rounds Window (1–5)
              </label>
              <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                {archivistRecentRounds} round{archivistRecentRounds > 1 ? 's' : ''} (full detail)
              </span>
            </div>
            {setArchivistRecentRounds && (
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={archivistRecentRounds}
                onChange={(e) => setArchivistRecentRounds(parseInt(e.target.value, 10))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Number of recent deliberation rounds kept in full verbatim context. Earlier rounds are automatically condensed by the Council Archivist into an executive memory summary.
            </p>
          </div>
        </div>
      </section>

      {/* System Prompt Customization for Personas */}
      <section className="space-y-4 pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Persona System Prompt Overrides
        </h3>
        {personas.map((persona) => (
          <div key={persona.id} className="space-y-1.5 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{persona.avatar}</span>
              <span className="text-xs font-bold text-slate-800 dark:text-white">{persona.name}</span>
            </div>
            <textarea
              value={persona.systemPrompt}
              onChange={(e) => updatePersona(persona.id, { systemPrompt: e.target.value })}
              rows={3}
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>
        ))}

        <div className="space-y-1.5 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">⚖️</span>
            <span className="text-xs font-bold text-slate-800 dark:text-white">{synthesizer.name}</span>
          </div>
          <textarea
            value={synthesizer.systemPrompt}
            onChange={(e) => setSynthesizer({ ...synthesizer, systemPrompt: e.target.value })}
            rows={4}
            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
          />
        </div>
      </section>
    </div>
  );
};
