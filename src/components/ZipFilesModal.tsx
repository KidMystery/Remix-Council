import React, { useState } from 'react';
import { Archive, FileCode, Search, X, Copy, Check, FileText } from 'lucide-react';
import { ExtractedZipFile, ZipArchiveResult } from '../lib/zipReader';

interface ZipFilesModalProps {
  zipResult: ZipArchiveResult | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ZipFilesModal: React.FC<ZipFilesModalProps> = ({ zipResult, isOpen, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFile, setSelectedFile] = useState<ExtractedZipFile | null>(null);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);

  if (!isOpen || !zipResult) return null;

  const isRar =
    zipResult.archiveType === 'rar' ||
    zipResult.filename.toLowerCase().endsWith('.rar');
  const archiveLabel = isRar ? 'RAR' : 'ZIP';

  const filteredFiles = zipResult.files.filter(
    (f) =>
      f.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeFile = selectedFile || filteredFiles[0] || zipResult.files[0];

  const handleCopyFileContent = (content: string, filename: string) => {
    navigator.clipboard.writeText(content);
    setCopiedFile(filename);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const handleCopyLine = (lineText: string, lineIndex: number) => {
    navigator.clipboard.writeText(lineText);
    setCopiedLine(lineIndex);
    setTimeout(() => setCopiedLine(null), 1500);
  };

  const lines = activeFile ? activeFile.content.split('\n') : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Archive size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                <span className="truncate max-w-xs sm:max-w-md">{zipResult.filename}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">
                  {zipResult.extractedCodeFilesCount} {archiveLabel} Code Files
                </span>
                {zipResult.wasTruncated && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                    Capped
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">
                Extracted code & text files sent as context to AI Council models
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            aria-label="Close archive modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Split Pane */}
        <div className="flex-1 flex min-h-0 divide-x divide-slate-800">
          {/* File Tree / List Sidebar */}
          <div className="w-80 flex flex-col bg-slate-950/60 shrink-0">
            {/* Search Box */}
            <div className="p-3 border-b border-slate-800">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder={`Filter ${archiveLabel} files...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            </div>

            {/* File List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredFiles.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">No matching files found</div>
              ) : (
                filteredFiles.map((file) => {
                  const isSelected = activeFile?.path === file.path;
                  return (
                    <button
                      key={file.path}
                      onClick={() => setSelectedFile(file)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30'
                          : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <FileCode size={14} className={isSelected ? 'text-purple-400' : 'text-slate-500'} />
                        <span className="truncate font-mono text-[11px]">{file.path}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                        {(file.size / 1024).toFixed(1)}k
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Code Viewer Main Area */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
            {activeFile ? (
              <>
                {/* Code Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={15} className="text-cyan-400 shrink-0" />
                    <span className="font-mono text-xs font-semibold text-slate-200 whitespace-normal break-words">
                      {activeFile.path}
                    </span>
                  </div>
                  <button
                    onClick={() => handleCopyFileContent(activeFile.content, activeFile.path)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
                  >
                    {copiedFile === activeFile.path ? (
                      <>
                        <Check size={13} className="text-emerald-400" />
                        <span className="text-emerald-300">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} className="text-slate-400" />
                        <span>Copy File</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Line-by-line Code Viewer with Line Copy */}
                <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-slate-200 space-y-0.5">
                  {lines.map((lineText, idx) => (
                    <div
                      key={idx}
                      className="group flex items-center hover:bg-slate-800/80 rounded px-1.5 py-0.5 transition-colors"
                    >
                      {/* Line Number */}
                      <span
                        onClick={() => handleCopyLine(lineText, idx)}
                        className="w-10 shrink-0 text-right pr-3 text-slate-600 hover:text-cyan-400 font-mono text-[11px] select-none cursor-pointer"
                        title="Click to copy line number"
                      >
                        {idx + 1}
                      </span>

                      {/* Code Text */}
                      <span className="flex-1 min-w-0 overflow-x-auto whitespace-pre">
                        {lineText || ' '}
                      </span>

                      {/* Copy Line Hover Button */}
                      <button
                        onClick={() => handleCopyLine(lineText, idx)}
                        className="opacity-0 group-hover:opacity-100 ml-2 px-1.5 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 border border-slate-700/60 transition-opacity shrink-0 flex items-center gap-1 cursor-pointer"
                        title="Copy this line"
                      >
                        {copiedLine === idx ? (
                          <>
                            <Check size={10} className="text-emerald-400" />
                            <span className="text-emerald-300">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={10} />
                            <span>Copy Line</span>
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                Select a file to view code
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-400">
          <span>
            {archiveLabel} Archive Total: <strong className="text-slate-200">{zipResult.totalFiles}</strong> entries,{' '}
            <strong className="text-purple-300">{zipResult.extractedCodeFilesCount}</strong> code/text files ready for AI evaluation.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
};

