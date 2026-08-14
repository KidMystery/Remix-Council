import React, { useState, useEffect } from 'react';
import { ToastMessage } from '../types';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface UnifiedToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const UnifiedToast: React.FC<UnifiedToastProps> = ({ toasts, onDismiss }) => {
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && toasts.length > 0) {
        onDismiss(toasts[toasts.length - 1].id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toasts, onDismiss]);

  if (!toasts || toasts.length === 0) return null;

  const handleCopyDetails = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      aria-label="Notification alerts"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-md w-full sm:w-auto pointer-events-none"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isWarning = toast.type === 'warning';
        const isSuccess = toast.type === 'success';
        const isInfo = toast.type === 'info' || !toast.type;

        // Accessible roles & ARIA properties
        const role = isError || isWarning ? 'alert' : 'status';
        const ariaLive = isError ? 'assertive' : 'polite';

        const borderClass = isError
          ? 'border-red-500/60 dark:border-red-500/80 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-red-500/10'
          : isWarning
          ? 'border-amber-500/60 dark:border-amber-500/80 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-amber-500/10'
          : isSuccess
          ? 'border-emerald-500/60 dark:border-emerald-500/80 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-emerald-500/10'
          : 'border-cyan-500/60 dark:border-cyan-500/80 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-cyan-500/10';

        const icon = isError ? (
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
        ) : isWarning ? (
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
        ) : isSuccess ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
        ) : (
          <Info className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0" aria-hidden="true" />
        );

        return (
          <div
            key={toast.id}
            id={`toast-${toast.id}`}
            role={role}
            aria-live={ariaLive}
            tabIndex={0}
            className={`pointer-events-auto rounded-xl border p-4 shadow-xl flex flex-col gap-2 transition-all duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400 ${borderClass}`}
          >
            <div className="flex items-start gap-3 justify-between">
              <div className="flex items-start gap-3 min-w-0">
                {icon}
                <div className="min-w-0 flex-1">
                  {toast.title && (
                    <h4 className="text-xs font-bold uppercase tracking-wider font-mono opacity-90">
                      {toast.title}
                    </h4>
                  )}
                  <p className="text-sm font-medium leading-relaxed break-words">
                    {toast.message}
                  </p>
                </div>
              </div>

              <button
                type="button"
                id={`dismiss-toast-${toast.id}`}
                aria-label="Dismiss notification"
                onClick={() => onDismiss(toast.id)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Actionable buttons */}
            {(toast.action || toast.details) && (
              <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 flex-wrap">
                {toast.action && (
                  <button
                    type="button"
                    id={`action-toast-${toast.id}`}
                    onClick={() => {
                      toast.action?.onClick();
                      onDismiss(toast.id);
                    }}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      toast.action.variant === 'danger'
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : toast.action.variant === 'secondary'
                        ? 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                        : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-white'
                    }`}
                  >
                    {toast.action.label}
                  </button>
                )}

                {toast.details && (
                  <button
                    type="button"
                    id={`toggle-details-${toast.id}`}
                    onClick={() =>
                      setExpandedDetailsId(
                        expandedDetailsId === toast.id ? null : toast.id
                      )
                    }
                    className="text-xs font-mono text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <span>{expandedDetailsId === toast.id ? 'Hide details' : 'View details'}</span>
                    {expandedDetailsId === toast.id ? (
                      <ChevronUp size={12} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={12} aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Expandable details panel */}
            {toast.details && expandedDetailsId === toast.id && (
              <div className="mt-1 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 text-[11px] font-mono overflow-x-auto max-h-36 relative">
                <button
                  type="button"
                  id={`copy-details-${toast.id}`}
                  onClick={() => handleCopyDetails(toast.id, toast.details!)}
                  aria-label="Copy error details to clipboard"
                  className="absolute top-2 right-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {copiedId === toast.id ? (
                    <Check size={12} className="text-emerald-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
                <pre className="whitespace-pre-wrap break-all text-slate-600 dark:text-slate-300 pr-6">
                  {toast.details}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
