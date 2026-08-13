import React, { useRef } from 'react';
import {
  Send,
  Square,
  Paperclip,
  X,
  Sparkles,
  Zap,
  Layers,
  Cpu,
  DollarSign,
  FastForward,
  Shuffle,
  ShieldAlert,
  Code,
  Calculator,
  Palette,
  Compass,
  Archive,
} from 'lucide-react';
import { ExecutionMode, TaskDomain, Persona, PersonaId } from '../types';
import { SmartSelectionAuditCard } from './SmartSelectionAuditCard';
import { SmartSelectionResult } from '../lib/smartModelSelector';
import { FallbackEvent } from '../lib/fallbackManager';
import { ZipArchiveResult } from '../lib/zipReader';
import { calculateCallCost, formatCost } from '../lib/archivist';

export interface FileAttachment {
  name: string;
  type: string;
  content: string;
  size: number;
  unzippedResult?: ZipArchiveResult;
}

export interface ComposerProps {
  query: string;
  setQuery: (q: string) => void;
  attachedFiles: FileAttachment[];
  fileError?: string | null;
  setFileError?: (err: string | null) => void;
  isDeliberating: boolean;
  handleDeliberate: (e?: React.FormEvent) => void;
  handleStop: () => void;
  removeAttachedFile: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  queryTokens: number;
  sessionCostMetrics: { totalCost: number };
  basicMode: boolean;
  selectedTaskDomain: TaskDomain | 'auto';
  handleApplySmartDomainModelSelection: (domain: TaskDomain | 'auto') => void;
  activeAppliedDomain: TaskDomain | null;
  selectionDebugResult: SmartSelectionResult | null;
  autoSelectModels: boolean;
  handleToggleAutoSelectModels: (val: boolean) => void;
  personas: Persona[];
  setPersonas: React.Dispatch<React.SetStateAction<Persona[]>>;
  setSynthesizer: React.Dispatch<React.SetStateAction<Persona>>;
  executionMode: ExecutionMode;
  updateExecutionMode: (mode: ExecutionMode) => void;
  rotateRoleAssignments: () => void;
  fallbackLogs: FallbackEvent[];
  setIsFallbackModalOpen: (val: boolean) => void;
  setIsSettingsOpen: (val: boolean) => void;
  setActiveZipResult: (res: ZipArchiveResult | null) => void;
  setIsZipModalOpen: (val: boolean) => void;
  hasPreviousRounds: boolean;
  stopAfterStage1?: boolean;
  setStopAfterStage1?: (val: boolean) => void;
  useSingleModelForSimple?: boolean;
  setUseSingleModelForSimple?: (val: boolean) => void;
  maxRoundCostCeiling?: number;
}

export const Composer: React.FC<ComposerProps> = ({
  query,
  setQuery,
  attachedFiles,
  fileError,
  setFileError,
  isDeliberating,
  handleDeliberate,
  handleStop,
  removeAttachedFile,
  fileInputRef,
  handleFileUpload,
  handleDrop,
  handleDragOver,
  handlePaste,
  queryTokens,
  sessionCostMetrics,
  basicMode,
  selectedTaskDomain,
  handleApplySmartDomainModelSelection,
  activeAppliedDomain,
  selectionDebugResult,
  autoSelectModels,
  handleToggleAutoSelectModels,
  personas,
  setPersonas,
  setSynthesizer,
  executionMode,
  updateExecutionMode,
  rotateRoleAssignments,
  fallbackLogs,
  setIsFallbackModalOpen,
  setIsSettingsOpen,
  setActiveZipResult,
  setIsZipModalOpen,
  hasPreviousRounds,
  stopAfterStage1 = false,
  setStopAfterStage1,
  useSingleModelForSimple = false,
  setUseSingleModelForSimple,
  maxRoundCostCeiling = 0,
}) => {
  return (
    <div className="sticky bottom-0 z-20 bg-slate-50 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700/80 p-3 sm:p-4">
      <div className="max-w-4xl mx-auto space-y-2.5">
        {fileError && (
          <div className="text-xs text-red-400 bg-red-950/50 p-2 rounded-lg border border-red-800/50 flex items-center justify-between">
            <span>⚠️ {fileError}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (setFileError) setFileError(null);
              }}
              className="text-red-400 hover:text-red-200 cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Smart Task Domain Model Selector Bar */}
        {!basicMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 custom-scrollbar">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider shrink-0 flex items-center gap-1 font-mono">
                <Cpu size={12} className="text-indigo-400" />
                Domain Routing:
              </span>

              {[
                { id: 'auto', label: 'Auto Detect', icon: Sparkles },
                { id: 'code', label: 'Code', icon: Code },
                { id: 'math', label: 'Math', icon: Calculator },
                { id: 'finance', label: 'Finance', icon: DollarSign },
                { id: 'creative', label: 'Creative', icon: Palette },
                { id: 'general', label: 'General', icon: Compass },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = selectedTaskDomain === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleApplySmartDomainModelSelection(item.id as TaskDomain)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 shrink-0 ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                    title={`Apply smart LLM model selection optimized for ${item.label}`}
                  >
                    <Icon size={12} className={isSelected ? 'text-white' : 'text-indigo-400'} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {activeAppliedDomain && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 flex items-center gap-1 shrink-0">
                <span>Active:</span>
                <strong className="uppercase text-indigo-300">{activeAppliedDomain}</strong>
              </span>
            )}
          </div>
        )}

        {!basicMode && (
          <div className="py-1">
            <SmartSelectionAuditCard
              selectionResult={selectionDebugResult}
              activeDomain={activeAppliedDomain || 'general'}
              autoSelectModels={autoSelectModels}
              onToggleAutoSelect={handleToggleAutoSelectModels}
              onApplyRecommendations={() => {
                if (selectionDebugResult) {
                  setPersonas(selectionDebugResult.updatedPersonas);
                  setSynthesizer(selectionDebugResult.updatedSynthesizer);
                  const defaultModelsMap: Record<string, string> = {};
                  selectionDebugResult.updatedPersonas.forEach((p) => {
                    defaultModelsMap[p.id] = p.model;
                  });
                  defaultModelsMap['synthesizer'] = selectionDebugResult.updatedSynthesizer.model;
                  localStorage.setItem('council_default_models', JSON.stringify(defaultModelsMap));
                }
              }}
            />
          </div>
        )}

        {/* Mode Selector & Quick Options Bar */}
        {!basicMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 pb-1 text-xs">
            <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => updateExecutionMode('auto')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-medium text-xs ${
                  executionMode === 'auto'
                    ? 'bg-cyan-950 text-cyan-200 border border-cyan-700/60 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200'
                }`}
                title="Automatically choose Quick Panel or Deep Council based on query context"
              >
                <Sparkles size={12} className="text-cyan-400" />
                <span>Auto Router</span>
              </button>
              <button
                type="button"
                onClick={() => updateExecutionMode('quick_panel')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-medium text-xs ${
                  executionMode === 'quick_panel'
                    ? 'bg-amber-950 text-amber-200 border border-amber-700/60 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200'
                }`}
                title="Concurrent independent answers with low token limits"
              >
                <Zap size={12} className="text-amber-400" />
                <span>Quick Panel</span>
              </button>
              <button
                type="button"
                onClick={() => updateExecutionMode('deep_council')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 font-medium text-xs ${
                  executionMode === 'deep_council'
                    ? 'bg-purple-950 text-purple-200 border border-purple-700/60 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200'
                }`}
                title="Full 3-stage deliberation with peer review and synthesis"
              >
                <Layers size={12} className="text-purple-400" />
                <span>Deep Council</span>
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap font-mono text-[11px]">
              {maxRoundCostCeiling > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/70 text-emerald-300 flex items-center gap-1" title="Per-round cost ceiling active">
                  <DollarSign size={10} />
                  Max ${maxRoundCostCeiling.toFixed(2)}/round
                </span>
              )}

              {setStopAfterStage1 && (
                <label className="flex items-center gap-1 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={stopAfterStage1}
                    onChange={(e) => setStopAfterStage1(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-purple-600 focus:ring-purple-500 text-xs"
                  />
                  <span className="flex items-center gap-1">
                    <FastForward size={11} className="text-purple-400" />
                    Stop after Stage 1
                  </span>
                </label>
              )}

              {setUseSingleModelForSimple && (
                <label className="flex items-center gap-1 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={useSingleModelForSimple}
                    onChange={(e) => setUseSingleModelForSimple(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-cyan-600 focus:ring-cyan-500 text-xs"
                  />
                  <span className="flex items-center gap-1">
                    <Zap size={11} className="text-amber-400" />
                    Single Model for Simple
                  </span>
                </label>
              )}
            </div>
          </div>
        )}

        {/* Quick Persona Toggle Bar */}
        {!basicMode && (
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                Council ({personas.filter((p) => p.enabled !== false).length}/{personas.length}):
              </span>
              <button
                type="button"
                disabled={isDeliberating || personas.filter((p) => p.enabled !== false).length < 2}
                onClick={rotateRoleAssignments}
                className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700/80 text-slate-600 hover:text-cyan-300 text-[11px] font-mono flex items-center gap-1 transition-colors disabled:opacity-40"
                title="Rotate model assignments across active personas"
              >
                <Shuffle size={11} className="text-cyan-400" />
                <span>Rotate Roles</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFallbackModalOpen(true)}
                className={`px-2 py-0.5 rounded-md border text-[11px] font-mono flex items-center gap-1 transition-colors ${
                  fallbackLogs.length > 0
                    ? 'bg-amber-950/60 border-amber-700/80 text-amber-300 hover:bg-amber-900/80'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200'
                }`}
                title="View automatic fallback events audit log"
              >
                <ShieldAlert size={11} className={fallbackLogs.length > 0 ? 'text-amber-400' : 'text-slate-500 dark:text-slate-400'} />
                <span>Fallback Audit ({fallbackLogs.length})</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              {personas.map((p) => {
                const isEnabled = p.enabled !== false;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isDeliberating}
                    onClick={() => {
                      setPersonas(
                        personas.map((item) =>
                          item.id === p.id ? { ...item, enabled: !isEnabled } : item
                        )
                      );
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all shrink-0 ${
                      isEnabled
                        ? 'bg-white dark:bg-slate-900 border-cyan-500/50 text-cyan-200 shadow-sm shadow-cyan-950/40'
                        : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 line-through opacity-50 hover:opacity-80'
                    }`}
                    title={isEnabled ? `Disable ${p.name}` : `Enable ${p.name}`}
                  >
                    <span>{p.avatar}</span>
                    <span>{p.name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* File Attachment List */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {attachedFiles.map((file, fIdx) => (
              <div
                key={fIdx}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs shadow-sm relative group ${
                  file.unzippedResult
                    ? 'bg-purple-950/40 border-purple-500/40 text-purple-200'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {file.type?.startsWith('image/') ? (
                  <img src={file.content} alt={file.name} className="w-4 h-4 object-cover rounded shrink-0" />
                ) : file.unzippedResult ? (
                  <Archive size={13} className="text-purple-400 shrink-0" />
                ) : (
                  <Paperclip size={12} className="text-cyan-400 shrink-0" />
                )}
                <span className="font-mono text-[11px] max-w-[150px] truncate">{file.name}</span>
                {file.unzippedResult ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveZipResult(file.unzippedResult || null);
                      setIsZipModalOpen(true);
                    }}
                    className="text-[10px] bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 font-mono px-1.5 py-0.5 rounded transition-colors underline cursor-pointer"
                    title="Inspect extracted code files from zip archive"
                  >
                    {file.unzippedResult.extractedCodeFilesCount} code files
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachedFile(fIdx)}
                  className="text-slate-500 dark:text-slate-400 hover:text-red-400 transition-colors p-0.5 ml-1 cursor-pointer"
                  title="Remove file"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!basicMode && (query.length > 0 || attachedFiles.length > 0) && (
          <div className="flex items-center justify-between px-1 text-[11px] font-mono text-emerald-400/90">
            <span>
              Prompt Input ({queryTokens.toLocaleString()} tokens):{' '}
              {formatCost(calculateCallCost(queryTokens, 0, 'google/gemini-2.5-flash'))}
            </span>
            <span>Accumulated Session Cost: {formatCost(sessionCostMetrics.totalCost)}</span>
          </div>
        )}

        {/* Input Form */}
        <form
          onSubmit={handleDeliberate}
          className="flex items-end gap-2.5"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            accept=".txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.html,.css,.pdf,.zip,text/*,application/json,application/pdf,application/zip,application/x-zip-compressed,image/*,.png,.jpg,.jpeg,.webp,.gif,.heic,.svg"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-3 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-cyan-400 transition-colors shrink-0"
            title="Open Settings"
          >
            <Cpu size={18} />
          </button>
          <button
            type="button"
            disabled={isDeliberating}
            onClick={() => fileInputRef.current?.click()}
            className="p-3 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-cyan-400 transition-colors shrink-0 disabled:opacity-40"
            title="Upload context document or code file"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (query.trim() || attachedFiles.length > 0) {
                  handleDeliberate(e as any);
                }
              }
            }}
            placeholder={
              hasPreviousRounds
                ? 'Ask a follow-up question to the council...'
                : 'Submit a question or decision for council deliberation...'
            }
            rows={2}
            disabled={isDeliberating}
            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 transition-colors disabled:opacity-50 resize-y min-h-[48px] max-h-[160px]"
          />
          {isDeliberating ? (
            <button
              type="button"
              onClick={handleStop}
              className="h-[48px] w-[48px] rounded-xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors shadow-md shrink-0"
              title="Stop Deliberation"
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!query.trim() && attachedFiles.length === 0}
              className="h-[48px] w-[48px] rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white flex items-center justify-center transition-all shadow-md shadow-cyan-950/30 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 active:scale-95"
              title="Send Question"
            >
              <Send size={18} className="ml-0.5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
