import React, { useEffect, useState, useId } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Copy, Check, Hash, Code2 } from 'lucide-react';
import { copyToClipboard } from '../lib/clipboard';

interface MessageMarkdownProps {
  content: string;
}

export const MessageMarkdown = React.memo(function MessageMarkdown({ content }: MessageMarkdownProps) {
  const [debouncedContent, setDebouncedContent] = useState(content);
  const [html, setHtml] = useState('');
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);
  const [showLineCopyMode, setShowLineCopyMode] = useState(false);
  const uniqueId = useId().replace(/:/g, '');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedContent(content), 120);
    return () => window.clearTimeout(t);
  }, [content]);

  useEffect(() => {
    if (!debouncedContent) {
      setHtml('');
      return;
    }

    // Custom marked renderer to add code block headers, line numbers, and copy line buttons
    const customRenderer = new marked.Renderer();

    customRenderer.code = function ({ text, lang }: { text: string; lang?: string }) {
      const codeLines = text.split('\n');
      const languageStr = (lang || 'code').trim();

      const lineElements = codeLines
        .map((line, idx) => {
          const rawLineEncoded = encodeURIComponent(line);
          return `<div class="code-line-row group flex items-start hover:bg-slate-800/80 rounded px-1 -mx-1 py-0.5 transition-colors cursor-pointer" data-code-line="${idx + 1}" data-raw-line="${rawLineEncoded}">
            <span class="line-num select-none text-slate-500 group-hover:text-cyan-400 w-8 shrink-0 text-right pr-2.5 font-mono text-[11px] opacity-70 group-hover:opacity-100">${idx + 1}</span>
            <span class="line-text flex-1 min-w-0 font-mono text-xs text-slate-200 overflow-x-auto whitespace-pre">${line || ' '}</span>
            <button type="button" class="copy-single-line-btn opacity-0 group-hover:opacity-100 ml-2 px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 border border-slate-700/60 transition-opacity shrink-0 flex items-center gap-1 cursor-pointer select-none" data-copy-text="${rawLineEncoded}" title="Copy line ${idx + 1}">
              <span>Copy Line</span>
            </button>
          </div>`;
        })
        .join('');

      const rawFullCodeEncoded = encodeURIComponent(text);

      return `<div class="code-block-wrapper my-4 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/90 shadow-lg">
        <div class="code-header flex items-center justify-between px-3.5 py-1.5 bg-slate-900 border-b border-slate-800 text-slate-400 text-xs font-mono select-none">
          <div class="flex items-center gap-1.5 font-semibold text-cyan-400">
            <span class="w-2 h-2 rounded-full bg-cyan-400/80"></span>
            <span>${languageStr}</span>
          </div>
          <button type="button" class="copy-full-code-btn flex items-center gap-1.5 text-xs text-slate-300 hover:text-cyan-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-700/50 transition-colors cursor-pointer" data-copy-code="${rawFullCodeEncoded}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
            <span>Copy Code</span>
          </button>
        </div>
        <div class="code-body p-3 overflow-x-auto">
          ${lineElements}
        </div>
      </div>`;
    };

    const parsed = marked.parse(debouncedContent, { async: false, renderer: customRenderer }) as string;
    const sanitized = DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['data-code-line', 'data-raw-line', 'data-copy-text', 'data-copy-code'],
    });

    setHtml(sanitized);
  }, [debouncedContent]);

  // Click handler for copy buttons inside rendered markdown HTML
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Check if clicked button or parent is a copy-single-line-btn
    const lineBtn = target.closest('.copy-single-line-btn') as HTMLElement | null;
    if (lineBtn) {
      e.preventDefault();
      e.stopPropagation();
      const rawText = lineBtn.getAttribute('data-copy-text');
      if (rawText) {
        const lineText = decodeURIComponent(rawText);
        copyToClipboard(lineText);
        showToast(`Copied line: "${lineText.slice(0, 30)}${lineText.length > 30 ? '...' : ''}"`);
      }
      return;
    }

    // Check if clicked line row directly or line number
    const lineRow = target.closest('.code-line-row') as HTMLElement | null;
    if (lineRow && (target.classList.contains('line-num') || target.classList.contains('line-text'))) {
      const rawText = lineRow.getAttribute('data-raw-line');
      const lineNum = lineRow.getAttribute('data-code-line');
      if (rawText) {
        const lineText = decodeURIComponent(rawText);
        copyToClipboard(lineText);
        showToast(`Copied line #${lineNum}!`);
      }
      return;
    }

    // Check if clicked copy-full-code-btn
    const codeBtn = target.closest('.copy-full-code-btn') as HTMLElement | null;
    if (codeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const rawCode = codeBtn.getAttribute('data-copy-code');
      if (rawCode) {
        const fullCode = decodeURIComponent(rawCode);
        copyToClipboard(fullCode);
        showToast('Copied code block!');
      }
      return;
    }
  };

  const handleCopyFullResponse = () => {
    copyToClipboard(content);
    setCopiedFull(true);
    showToast('Copied entire response!');
    setTimeout(() => setCopiedFull(false), 2000);
  };

  const showToast = (msg: string) => {
    setCopiedNotification(msg);
    setTimeout(() => setCopiedNotification(null), 2000);
  };

  // Convert general markdown text into individual copyable lines when Line Copy Mode is active
  const textLines = content ? content.split('\n') : [];

  return (
    <div className="relative group/markdown">
      {/* Response Control Toolbar */}
      <div className="flex items-center justify-between mb-2 text-[11px] font-mono text-slate-400 select-none pb-1 border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLineCopyMode(!showLineCopyMode)}
            className={`px-2 py-0.5 rounded flex items-center gap-1 border transition-colors cursor-pointer ${
              showLineCopyMode
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title="Toggle line-by-line copy mode for response text"
          >
            <Hash size={12} />
            <span>Line Copy Mode</span>
            <span className="text-[9px] font-bold px-1 rounded bg-slate-800">{showLineCopyMode ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopyFullResponse}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 border border-slate-700/60 transition-colors cursor-pointer"
          title="Copy full response text"
        >
          {copiedFull ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-300 font-semibold">Copied Response</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy Full Response</span>
            </>
          )}
        </button>
      </div>

      {/* Copy Notification Toast Badge */}
      {copiedNotification && (
        <div className="absolute right-2 top-8 z-30 bg-cyan-950 border border-cyan-500/50 text-cyan-200 text-xs px-2.5 py-1 rounded-md shadow-xl font-mono flex items-center gap-1.5 animate-fade-in">
          <Check size={13} className="text-cyan-400" />
          <span>{copiedNotification}</span>
        </div>
      )}

      {/* Line-by-Line Interactive View */}
      {showLineCopyMode ? (
        <div className="my-2 p-3 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-200 space-y-1">
          <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-semibold mb-2 flex items-center justify-between border-b border-slate-800/80 pb-1">
            <span>Line-by-Line Copy Inspector</span>
            <span className="text-slate-500">Click line or 'Copy Line' button to copy text</span>
          </div>
          {textLines.map((line, idx) => (
            <div
              key={`${uniqueId}-line-${idx}`}
              className="group/line flex items-start hover:bg-slate-800/70 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
              onClick={() => {
                copyToClipboard(line);
                showToast(`Copied line #${idx + 1}`);
              }}
            >
              <span className="w-8 shrink-0 text-right pr-2 text-slate-500 group-hover/line:text-cyan-400 font-mono text-[11px] select-none">
                {idx + 1}
              </span>
              <span className="flex-1 min-w-0 break-words whitespace-pre-wrap">
                {line || ' '}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(line);
                  showToast(`Copied line #${idx + 1}`);
                }}
                className="opacity-0 group-hover/line:opacity-100 ml-2 px-1.5 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 border border-slate-700/60 transition-opacity shrink-0 flex items-center gap-1 cursor-pointer"
                title={`Copy line ${idx + 1}`}
              >
                <Copy size={10} />
                <span>Copy Line</span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        /* Standard Rendered Markdown with Code Block Line Copy Hooks */
        <div
          onClick={handleContainerClick}
          className="prose prose-slate prose-sm max-w-none dark:prose-invert min-w-0 break-words overflow-x-auto
                     prose-p:leading-relaxed prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0 prose-pre:border-0
                     prose-code:text-cyan-700 dark:prose-code:text-cyan-300 prose-code:bg-slate-200/80 dark:prose-code:bg-slate-900/80 prose-code:border prose-code:border-slate-300 dark:prose-code:border-slate-700/80
                     prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
});
