import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Paperclip,
  ChevronDown,
  ChevronUp,
  FileCode,
  FileText,
  Archive,
  Sparkles,
  Loader2,
  X,
  Mic,
} from 'lucide-react';
import type { AttachedFile } from '../types';
import { extractCodeFromArchive } from '../lib/zipReader';
import { extractTextFromPDF } from '../lib/pdfUtils';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

export interface ComposerProps {
  onSend: (query: string, attachedFiles: AttachedFile[], isFollowUp: boolean) => void;
  isDeliberating: boolean;
  onStop?: () => void;
  estimatedCost?: number;
  estimatedTokens?: number;
}

export const Composer: React.FC<ComposerProps> = ({
  onSend,
  isDeliberating,
  onStop,
  estimatedCost = 0,
  estimatedTokens = 0,
}) => {
  const [query, setQuery] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [topicMode, setTopicMode] = useState<'fresh' | 'followup'>('fresh');
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Dictation (speech-to-text) into the query box.
  const preQueryRef = useRef('');
  const { supported: sttSupported, isListening, toggle: toggleDictation } = useSpeechRecognition(
    ({ transcript }) => {
      setQuery(preQueryRef.current + transcript);
    }
  );
  const handleMic = () => {
    if (isListening) {
      toggleDictation();
    } else {
      preQueryRef.current = query;
      toggleDictation();
    }
  };

  // Auto-resize textarea height to content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [query]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() && attachedFiles.length === 0) return;
    if (isDeliberating || isExtracting) return;

    onSend(query.trim(), attachedFiles, topicMode === 'followup');
    setQuery('');
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const processIncomingFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsExtracting(true);
    const newFiles: AttachedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name;
      const lower = name.toLowerCase();

      try {
        if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.tar') || lower.endsWith('.gz')) {
          const result = await extractCodeFromArchive(file);
          newFiles.push({
            name,
            content: result.formattedContext,
            size: file.size,
            type: result.archiveType,
          });
        } else if (lower.endsWith('.pdf')) {
          const text = await extractTextFromPDF(file);
          newFiles.push({
            name,
            content: text,
            size: file.size,
            type: 'pdf',
          });
        } else {
          const text = await file.text();
          newFiles.push({
            name,
            content: text,
            size: file.size,
            type: file.type || 'text/plain',
          });
        }
      } catch (err: any) {
        console.error(`Failed to process file ${name}:`, err);
      }
    }

    setAttachedFiles((prev) => [...prev, ...newFiles]);
    setIsExtracting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processIncomingFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processIncomingFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="sticky bottom-2 sm:bottom-3 z-30 w-full max-w-4xl mx-auto px-2 sm:px-3">
      <form
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full bg-slate-900/95 backdrop-blur-md border rounded-2xl p-2.5 sm:p-3 shadow-2xl transition-all ring-1 ring-white/5 ${
          isDraggingOver ? 'border-cyan-400 ring-2 ring-cyan-400/40 bg-cyan-950/20' : 'border-slate-700/80'
        }`}
      >
        {/* Large attachment storage warning */}
        {attachedFiles.some((f) => (f.content || '').length > 8000) && (
          <div className="mb-2 px-3 py-1.5 rounded-lg bg-amber-950/70 border border-amber-600/40 text-amber-300 text-[11px] leading-snug">
            ⚠️ A large attachment will be truncated to ~8,000 characters in local storage. Use Drive sync or attach smaller files for full fidelity.
          </div>
        )}

        {/* Attached Files Carousel */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 max-h-28 overflow-y-auto">
            {attachedFiles.map((f, i) => {
              const isArchive = f.type === 'zip' || f.type === 'rar' || f.name.endsWith('.zip');
              const isPdf = f.type === 'pdf' || f.name.endsWith('.pdf');
              return (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/90 rounded-lg text-xs text-slate-200 border border-slate-700 shadow-sm"
                >
                  {isArchive ? (
                    <Archive size={12} className="text-purple-400 shrink-0" />
                  ) : isPdf ? (
                    <FileText size={12} className="text-red-400 shrink-0" />
                  ) : (
                    <FileCode size={12} className="text-cyan-400 shrink-0" />
                  )}
                  <span className="truncate max-w-[120px] sm:max-w-[180px] font-mono text-[11px]">{f.name}</span>
                  {f.size && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({(f.size / 1024).toFixed(0)} KB)
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-slate-400 hover:text-red-400 ml-1 p-0.5 rounded cursor-pointer min-w-[20px] min-h-[20px] flex items-center justify-center"
                    title="Remove attachment"
                    aria-label={`Remove attachment ${f.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Text Input Area */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the Council anything... (Press Ctrl+Enter to deliberate)"
            rows={2}
            className="w-full bg-slate-950/70 text-slate-100 placeholder-slate-500 text-xs sm:text-sm p-3 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500/70 resize-none transition-all leading-relaxed"
          />
          {isExtracting && (
            <div className="absolute right-3 top-3 flex items-center gap-1.5 text-xs text-cyan-400 font-mono bg-slate-950/90 px-2 py-1 rounded-md border border-cyan-500/30">
              <Loader2 size={12} className="animate-spin" />
              <span>Unpacking...</span>
            </div>
          )}
        </div>

        {/* Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              accept=".ts,.tsx,.js,.jsx,.py,.json,.sql,.rs,.go,.java,.cpp,.c,.md,.txt,.yaml,.yml,.csv,.pdf,.zip,.rar,.tar,.gz"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isExtracting}
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800/80 hover:bg-slate-700 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-700 transition-colors shadow-sm cursor-pointer min-h-[38px]"
            >
              <Paperclip size={13} className="text-slate-400" />
              <span className="text-[11px] sm:text-xs">Attach</span>
            </button>

            {sttSupported && (
              <button
                type="button"
                onClick={handleMic}
                disabled={isExtracting}
                title={isListening ? 'Stop dictation' : 'Dictate your question (speech-to-text)'}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 rounded-xl border transition-colors shadow-sm cursor-pointer min-h-[38px] ${
                  isListening
                    ? 'bg-red-950/80 hover:bg-red-900 text-red-300 border-red-700 animate-pulse'
                    : 'text-slate-300 hover:text-slate-100 bg-slate-800/80 hover:bg-slate-700 border-slate-700'
                }`}
              >
                <Mic size={13} className={isListening ? 'text-red-400' : 'text-emerald-400'} />
                <span className="text-[11px] sm:text-xs">{isListening ? 'Listening…' : 'Dictate'}</span>
              </button>
            )}

            {/* Desktop Fresh/Followup switcher */}
            <div className="hidden sm:flex items-center bg-slate-950 rounded-xl p-0.5 border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setTopicMode('fresh')}
                className={`px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  topicMode === 'fresh' ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Fresh Topic
              </button>
              <button
                type="button"
                onClick={() => setTopicMode('followup')}
                className={`px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  topicMode === 'followup' ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Follow-up
              </button>
            </div>

            {/* Mobile Topic Select */}
            <select
              value={topicMode}
              onChange={(e) => setTopicMode(e.target.value as any)}
              className="sm:hidden text-xs bg-slate-950 text-slate-300 rounded-xl px-2.5 py-1.5 border border-slate-800 min-h-[38px]"
            >
              <option value="fresh">Fresh</option>
              <option value="followup">Follow-up</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {/* Mobile Cost Toggle */}
            <button
              type="button"
              onClick={() => setShowMobileDetails(!showMobileDetails)}
              className="sm:hidden text-xs text-slate-400 flex items-center gap-0.5 p-1 rounded-lg min-h-[36px]"
              aria-label="Toggle token estimation info"
            >
              <span>Info</span>
              {showMobileDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            <div className={`${showMobileDetails ? 'flex' : 'hidden'} sm:flex items-center gap-2 text-[11px] font-mono text-slate-400`}>
              <span>~{estimatedTokens} tok</span>
              <span className="text-slate-600">•</span>
              <span>${estimatedCost.toFixed(4)}</span>
            </div>

            {isDeliberating && onStop && (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all shadow-md text-xs cursor-pointer min-h-[38px]"
                title="Stop the current deliberation"
              >
                <X size={13} />
                <span>Stop</span>
              </button>
            )}

            <button
              type="submit"
              disabled={isDeliberating || isExtracting || (!query.trim() && attachedFiles.length === 0)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl transition-all shadow-md text-xs cursor-pointer min-h-[38px]"
            >
              {isDeliberating ? (
                <>
                  <Sparkles size={13} className="animate-spin text-slate-950" />
                  <span>Deliberating...</span>
                </>
              ) : (
                <>
                  <Send size={13} />
                  <span>Deliberate</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
