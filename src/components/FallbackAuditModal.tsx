import React from 'react';
import { FallbackEvent, clearStoredFallbackEvents } from '../lib/fallbackManager';
import { X, ShieldAlert, CheckCircle2, AlertCircle, RefreshCw, Trash2, ArrowRight, Layers, Cpu } from 'lucide-react';

interface FallbackAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: FallbackEvent[];
  onClearLogs: () => void;
}

export const FallbackAuditModal: React.FC<FallbackAuditModalProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
}) => {
  if (!isOpen) return null;

  const handleClear = () => {
    clearStoredFallbackEvents();
    onClearLogs();
  };

  const getReasonColor = (reason: FallbackEvent['triggerReason']) => {
    switch (reason) {
      case 'HTTP 429 (Rate Limit)':
        return 'bg-amber-950/80 text-amber-300 border-amber-800/60';
      case 'Timeout':
        return 'bg-purple-950/80 text-purple-300 border-purple-800/60';
      case 'Temporary Unavailability':
        return 'bg-blue-950/80 text-blue-300 border-blue-800/60';
      case 'Invalid Response':
        return 'bg-orange-950/80 text-orange-300 border-orange-800/60';
      case 'Provider Error':
      default:
        return 'bg-red-950/80 text-red-300 border-red-800/60';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-800/50 text-amber-400">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Fallback Event Audit Log
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
                  {logs.length} Events Logged
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Automatic model fallback activity triggered by rate limits, timeouts, unavailability, or invalid responses
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Rule Summary Bar */}
        <div className="px-5 py-3 bg-slate-950/60 border-b border-slate-800 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-3 font-mono">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 size={13} /> Unused Author Org Required
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 size={13} /> Unused Model Family Required
            </span>
            <span className="flex items-center gap-1.5 text-amber-300">
              <CheckCircle2 size={13} /> Fast & Free → Free Models Only
            </span>
          </div>
          {logs.length > 0 && (
            <button
              onClick={handleClear}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 font-medium transition-colors hover:underline"
            >
              <Trash2 size={13} /> Clear Audit Log
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {logs.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="text-sm font-semibold text-slate-300">No Fallback Events Triggered</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                All primary models are executing successfully without errors. When a model returns HTTP 429, times out, or errors out, fallback replacements will be logged here.
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 hover:border-slate-700/80 transition-all space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-200">{log.personaName}</span>
                    <span className="text-xs font-mono text-slate-400">({log.personaId})</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border font-medium ${getReasonColor(log.triggerReason)}`}>
                      {log.triggerReason}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                {/* Model Replacement Flow */}
                <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800/60 font-mono text-xs">
                  <div className="flex items-center gap-1.5 text-red-300 font-semibold truncate max-w-[260px]">
                    <Cpu size={13} className="text-red-400 shrink-0" />
                    <span className="truncate" title={log.failedModel}>{log.failedModel}</span>
                  </div>

                  <ArrowRight size={14} className="text-slate-500 shrink-0" />

                  <div className="flex items-center gap-1.5 text-emerald-300 font-semibold truncate max-w-[280px]">
                    <Layers size={13} className="text-emerald-400 shrink-0" />
                    <span className="truncate" title={log.replacementModel || 'None'}>
                      {log.replacementModelName || log.replacementModel || 'No candidate found'}
                    </span>
                  </div>

                  <div className="ml-auto shrink-0">
                    {log.status === 'fallback_success' ? (
                      <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-md">
                        ✓ Replaced
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase font-bold text-red-400 bg-red-950/60 border border-red-800/60 px-2 py-0.5 rounded-md">
                        ✕ Failed
                      </span>
                    )}
                  </div>
                </div>

                {/* Error Details */}
                <p className="text-xs text-slate-400 font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-800/40 break-words">
                  <strong className="text-slate-300">Error:</strong> {log.errorMessage}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Fallback events persist in local storage for auditing.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-xl transition-colors"
          >
            Close Audit Log
          </button>
        </div>
      </div>
    </div>
  );
};
