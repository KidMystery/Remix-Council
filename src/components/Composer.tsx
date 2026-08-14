/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
import React, { useRef, useEffect } from 'react';
import { Send, Square, Paperclip, X, Cpu, Zap, Layers, Coins, Globe } from 'lucide-react';
import { ExecutionMode } from '../types';
import { ZipArchiveResult } from '../lib/zipReader';
import { formatCost } from '../lib/archivist';

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
  handleDeliberate: (e?: React.FormEvent) => void | Promise<void>;
  handleStop: () => void;
  removeAttachedFile: (index: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent<any>) => void | Promise<void>;
  handleDragOver: (e: React.DragEvent<any>) => void | Promise<void>;
  handlePaste: (e: React.ClipboardEvent<any>) => void | Promise<void>;
  basicMode?: boolean;
  executionMode?: ExecutionMode;
  updateExecutionMode?: (mode: ExecutionMode) => void;
  setIsSettingsOpen: (val: boolean) => void;
  hasPreviousRounds?: boolean;
  isIsolatedRound?: boolean;
  setIsIsolatedRound?: (isolated: boolean) => void;
  onStartNewSession?: () => void;
  estimatedQueryTokens?: number;
  estimatedQueryCost?: number;
  enableSearchGrounding?: boolean;
  onToggleSearchGrounding?: () => void;
  [key: string]: any;
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
  basicMode = false,
  executionMode = 'auto',
  updateExecutionMode,
  setIsSettingsOpen,
  hasPreviousRounds = false,
  isIsolatedRound = false,
  setIsIsolatedRound,
  onStartNewSession,
  estimatedQueryTokens,
  estimatedQueryCost,
  enableSearchGrounding = false,
  onToggleSearchGrounding,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-expand textarea smoothly as the user types so the entire prompt is easily readable
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      // Start at 48px minimum, expand up to 260px max, then scroll
      const targetHeight = Math.min(Math.max(scrollHeight, 48), 260);
      textareaRef.current.style.height = `${targetHeight}px`;
    }
  }, [query]);

  return (
    <div className="sticky bottom-0 z-20 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 p-2.5 sm:p-4 transition-all">
      <div className="max-w-4xl mx-auto space-y-2">
        {fileError && (
          <div className="text-xs text-red-500 bg-red-500/10 dark:bg-red-950/50 p-2.5 rounded-xl border border-red-500/30 flex items-center justify-between">
            <span className="break-words font-medium">⚠️ {fileError}</span>
            <button
              type="button"
              onClick={() => setFileError?.(null)}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-200 shrink-0 ml-2 cursor-pointer p-1"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Attachments list */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {attachedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 max-w-full shadow-xs"
              >
                <Paperclip size={12} className="text-cyan-500 shrink-0" />
                <span className="font-mono text-[11px] truncate max-w-[160px] text-slate-700 dark:text-slate-300" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachedFile(idx)}
                  className="text-slate-400 hover:text-red-500 shrink-0 cursor-pointer p-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Context Continuity & Round Distinction Pill Bar */}
        {hasPreviousRounds && (
          <div className="flex items-center justify-between gap-2 px-1 text-xs select-none flex-wrap">
            <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-slate-800/60 p-0.5 sm:p-1 rounded-xl border border-slate-300/40 dark:border-slate-700/60 shadow-2xs">
              <button
                type="button"
                onClick={() => setIsIsolatedRound?.(false)}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] flex items-center gap-1.5 transition-all cursor-pointer ${
                  !isIsolatedRound
                    ? 'bg-cyan-600 text-white shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Follow-up Round: Deliberation personas build on previous consensus, debate, and Archivist memory"
              >
                <span>💬</span>
                <span>Follow-up Round</span>
              </button>

              <button
                type="button"
                onClick={() => setIsIsolatedRound?.(true)}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] flex items-center gap-1.5 transition-all cursor-pointer ${
                  isIsolatedRound
                    ? 'bg-amber-600 text-white shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title="Fresh Topic Round: Starts an isolated question without injecting previous deliberation rounds"
              >
                <span>🆕</span>
                <span>Fresh Topic (Isolated)</span>
              </button>
            </div>

            {onStartNewSession && (
              <button
                type="button"
                onClick={onStartNewSession}
                className="text-[11px] font-mono text-slate-500 dark:text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 flex items-center gap-1 transition-colors cursor-pointer py-1 px-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-800/50 ml-auto"
                title="Create an entirely new deliberation session"
              >
                <span>➕ New Thread</span>
              </button>
            )}
          </div>
        )}

        {/* Input container */}
        <form
          onSubmit={handleDeliberate}
          className="flex items-end gap-1.5 sm:gap-2"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            className="hidden"
            accept=".txt,.md,.csv,.json,.js,.ts,.jsx,.tsx,.html,.css,.pdf,.zip,text/*,application/json,application/pdf,application/zip,image/*"
          />

          {/* Attach file button */}
          <button
            type="button"
            disabled={isDeliberating}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] min-w-[44px] sm:h-[48px] sm:w-[48px] rounded-xl bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-cyan-500 transition-colors shrink-0 disabled:opacity-40 cursor-pointer flex items-center justify-center shadow-xs"
            title="Upload context documents, data files, or code"
          >
            <Paperclip size={18} />
          </button>

          {/* Google Search Grounding toggle (integrated directly where prompts are written) */}
          {onToggleSearchGrounding && (
            <button
              type="button"
              onClick={onToggleSearchGrounding}
              className={`min-h-[44px] sm:h-[48px] px-2.5 sm:px-3 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs shrink-0 cursor-pointer ${
                enableSearchGrounding
                  ? 'bg-emerald-500/15 dark:bg-emerald-950/60 border-emerald-500/50 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30'
                  : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
              }`}
              title={
                enableSearchGrounding
                  ? 'Google Search Grounding ACTIVE: Models fact-check in real time via Google Search'
                  : 'Enable Google Search Grounding for live web fact-checking'
              }
            >
              <Globe size={16} className={enableSearchGrounding ? 'text-emerald-500 shrink-0 animate-pulse' : 'text-slate-400 shrink-0'} />
              <span className="hidden md:inline font-mono text-[11px]">Search</span>
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${
                  enableSearchGrounding
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                }`}
              >
                {enableSearchGrounding ? 'ON' : 'OFF'}
              </span>
            </button>
          )}

          {/* Quick/Deep Mode Switcher */}
          {updateExecutionMode && (
            <div className="hidden lg:flex items-center rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-1 shrink-0 h-[48px]">
              <button
                type="button"
                onClick={() => updateExecutionMode(executionMode === 'quick_panel' ? 'deep_council' : 'quick_panel')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
                  executionMode === 'quick_panel'
                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40 font-semibold'
                    : 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/40 font-semibold'
                }`}
                title={executionMode === 'quick_panel' ? 'Quick Panel mode (fast single-stage response)' : 'Deep Council mode (multi-stage peer reviews & synthesis)'}
              >
                {executionMode === 'quick_panel' ? (
                  <>
                    <Zap size={13} className="text-amber-500" />
                    <span>Quick</span>
                  </>
                ) : (
                  <>
                    <Layers size={13} className="text-indigo-500" />
                    <span>Deep</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Auto-expanding Prompt Textarea */}
          <div className="relative flex-1 min-w-0">
            <textarea
              ref={textareaRef}
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
                  ? isIsolatedRound
                    ? 'Ask a fresh, isolated question (previous deliberation history won’t be passed)...'
                    : 'Ask a follow-up question (Archivist context active)...'
                  : 'Submit a question or decision for council deliberation...'
              }
              disabled={isDeliberating}
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 sm:px-4 py-3 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 transition-all disabled:opacity-50 overflow-y-auto leading-relaxed custom-scrollbar shadow-xs resize-none"
              style={{ minHeight: '48px', maxHeight: '260px' }}
            />
          </div>

          {/* Submit or Stop button */}
          {isDeliberating ? (
            <button
              type="button"
              onClick={handleStop}
              className="min-h-[44px] min-w-[44px] sm:h-[48px] sm:w-[48px] rounded-xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors shadow-md shadow-red-950/40 shrink-0 cursor-pointer"
              title="Stop Deliberation"
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!query.trim() && attachedFiles.length === 0}
              className="min-h-[44px] min-w-[44px] sm:h-[48px] sm:w-[48px] rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white flex items-center justify-center transition-all shadow-md shadow-cyan-950/30 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 active:scale-95 cursor-pointer"
              title="Send Question (Enter)"
            >
              <Send size={18} className="ml-0.5" />
            </button>
          )}
        </form>

        {/* Proactive Token & Cost Estimate Bar */}
        {estimatedQueryTokens !== undefined && estimatedQueryTokens > 0 && (
          <div className="flex items-center justify-between px-1.5 py-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 select-none animate-fadeIn">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5" title="Estimated input tokens including query prompt and attached files">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span className="font-semibold text-slate-700 dark:text-slate-300">~{estimatedQueryTokens.toLocaleString()}</span> tokens
              </span>
              {estimatedQueryCost !== undefined && (
                <span
                  className={`flex items-center gap-1 font-semibold ${
                    estimatedQueryCost <= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                  title="Estimated deliberation cost across active personas and synthesizer"
                >
                  <Coins size={11} className="inline opacity-80" />
                  <span>Est. Cost:</span>
                  <span>{estimatedQueryCost <= 0 ? 'Free ($0.0000)' : formatCost(estimatedQueryCost)}</span>
                </span>
              )}
            </div>
            {attachedFiles.length > 0 && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {attachedFiles.length} file{attachedFiles.length > 1 ? 's' : ''} attached
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

