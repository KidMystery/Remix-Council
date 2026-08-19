import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, ChevronDown, ChevronUp, FileCode, CornerDownLeft, Sparkles } from 'lucide-react';
import type { AttachedFile } from '../types';

export interface ComposerProps {
  onSend: (query: string, attachedFiles: AttachedFile[], isFollowUp: boolean) => void;
  isDeliberating: boolean;
  estimatedCost?: number;
  estimatedTokens?: number;
}

export const Composer: React.FC<ComposerProps> = ({
  onSend,
  isDeliberating,
  estimatedCost = 0,
  estimatedTokens = 0,
}) => {
  const [query, setQuery] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [topicMode, setTopicMode] = useState<'fresh' | 'followup'>('fresh');
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    if (isDeliberating) return;

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setAttachedFiles((prev) => [
          ...prev,
          { name: file.name, content, size: file.size, type: file.type },
        ]);
      };
      reader.readAsText(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="sticky bottom-3 z-30 w-full max-w-4xl mx-auto px-2">
      <form
        onSubmit={handleSubmit}
        className="w-full bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl p-3 shadow-2xl transition-all ring-1 ring-white/5"
      >
        {/* Attached Files Carousel */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-24 overflow-y-auto">
            {attachedFiles.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/90 rounded-lg text-xs text-slate-200 border border-slate-700 shadow-sm"
              >
                <FileCode size={12} className="text-cyan-400 shrink-0" />
                <span className="truncate max-w-[130px] font-mono text-[11px]">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-slate-400 hover:text-red-400 ml-1 font-bold"
                  title="Remove attachment"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text Input Area */}
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the Council anything... (Press ⌘+Enter to send)"
          rows={2}
          className="w-full bg-slate-950/70 text-slate-100 placeholder-slate-500 text-sm p-3 rounded-xl border border-slate-800 focus:outline-none focus:border-cyan-500/70 resize-none transition-all"
        />

        {/* Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800/80 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors shadow-sm"
            >
              <Paperclip size={12} className="text-slate-400" />
              <span>Attach</span>
            </button>

            {/* Desktop Fresh/Followup switcher */}
            <div className="hidden sm:flex items-center bg-slate-950 rounded-lg p-0.5 border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setTopicMode('fresh')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  topicMode === 'fresh' ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Fresh Topic
              </button>
              <button
                type="button"
                onClick={() => setTopicMode('followup')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
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
              className="sm:hidden text-xs bg-slate-950 text-slate-300 rounded-lg px-2.5 py-1.5 border border-slate-800"
            >
              <option value="fresh">Fresh</option>
              <option value="followup">Follow-up</option>
            </select>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Mobile Cost Dropdown Toggle */}
            <button
              type="button"
              onClick={() => setShowMobileDetails(!showMobileDetails)}
              className="sm:hidden text-xs text-slate-400 flex items-center gap-0.5"
            >
              <span>Info</span>
              {showMobileDetails ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            <div className={`${showMobileDetails ? 'flex' : 'hidden'} sm:flex items-center gap-2 text-[11px] font-mono text-slate-400`}>
              <span>~{estimatedTokens} tokens</span>
              <span className="text-slate-500">|</span>
              <span>${estimatedCost.toFixed(4)}</span>
            </div>

            <button
              type="submit"
              disabled={isDeliberating || (!query.trim() && attachedFiles.length === 0)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl transition-all shadow-md text-xs cursor-pointer"
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
