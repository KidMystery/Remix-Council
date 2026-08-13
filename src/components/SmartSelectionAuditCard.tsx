import React, { useState } from 'react';
import { Cpu, ChevronDown, ChevronUp, Check, X, ToggleLeft, ToggleRight, AlertCircle, Info, Sparkles, CheckCircle2 } from 'lucide-react';
import { SmartSelectionResult, TaskDomain } from '../lib/smartModelSelector';

interface SmartSelectionAuditCardProps {
  selectionResult: SmartSelectionResult | null;
  activeDomain: TaskDomain;
  autoSelectModels: boolean;
  onToggleAutoSelect: (enabled: boolean) => void;
  onApplyRecommendations?: () => void;
  className?: string;
}

export function SmartSelectionAuditCard({
  selectionResult,
  activeDomain,
  autoSelectModels,
  onToggleAutoSelect,
  onApplyRecommendations,
  className = '',
}: SmartSelectionAuditCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [appliedJustNow, setAppliedJustNow] = useState(false);

  const handleApply = () => {
    if (onApplyRecommendations) {
      onApplyRecommendations();
      setAppliedJustNow(true);
      setTimeout(() => setAppliedJustNow(false), 3000);
    }
  };

  return (
    <div className={`bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 font-sans shadow-md space-y-2.5 ${className}`}>
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Cpu size={14} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100 text-xs">Deterministic Smart Routing Audit</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold uppercase">
                Domain: {activeDomain}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Joint provider & model capability selection
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Explicit Apply Button when Auto-Select is OFF */}
          {(!autoSelectModels || onApplyRecommendations) && (
            <button
              type="button"
              onClick={handleApply}
              className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition-all flex items-center gap-1.5 border cursor-pointer ${
                appliedJustNow
                  ? 'bg-emerald-900/80 border-emerald-500/60 text-emerald-200'
                  : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500/50 text-white shadow-sm'
              }`}
              title="Explicitly apply recommended model assignments to council personas"
            >
              {appliedJustNow ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Sparkles size={13} />}
              <span>{appliedJustNow ? 'Applied!' : 'Apply Recommendations'}</span>
            </button>
          )}

          {/* Auto Select Models Toggle */}
          <button
            type="button"
            onClick={() => onToggleAutoSelect(!autoSelectModels)}
            className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition-all flex items-center gap-1.5 border cursor-pointer ${
              autoSelectModels
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/80'
                : 'bg-amber-950/80 border-amber-500/50 text-amber-300 hover:bg-amber-900/80'
            }`}
            title={autoSelectModels ? 'Auto-Select is ON: models route automatically per domain' : 'Auto-Select is OFF: manual model choices are preserved'}
          >
            {autoSelectModels ? <ToggleRight size={16} className="text-emerald-400" /> : <ToggleLeft size={16} className="text-amber-400" />}
            <span>Auto-Select: {autoSelectModels ? 'ON' : 'OFF'}</span>
          </button>

          {selectionResult && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title={isExpanded ? 'Collapse routing details' : 'Expand routing details'}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Main Status Bar */}
      {!autoSelectModels && (
        <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-300 text-[11px] flex items-center justify-between gap-2">
          <div className="flex items-start gap-2">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>
              <strong>Auto-Select Models is OFF.</strong> Manual model selections are preserved until you click <strong>Apply Recommendations</strong>.
            </span>
          </div>
        </div>
      )}

      {/* Expandable Details Table */}
      {isExpanded && selectionResult && selectionResult.selectionDetails.length > 0 && (
        <div className="border-t border-slate-800 pt-2.5 space-y-2">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
            Assignment Audit Trail ({selectionResult.selectionDetails.length} Council Roles):
          </div>

          <div className="space-y-2">
            {selectionResult.selectionDetails.map((detail, idx) => {
              const isChanged = detail.previousModel !== detail.selectedModel;
              return (
                <div key={idx} className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-1.5 font-mono">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-200 text-xs font-sans">{detail.personaName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 border border-indigo-500/20">
                        {detail.roleKey}
                      </span>
                      {detail.source && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-400 border border-indigo-800/40 uppercase">
                          {detail.source.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>

                    {/* Transition: previous -> selected */}
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-slate-400 line-through truncate max-w-[140px]" title={detail.previousModel}>
                        {detail.previousModel || 'None'}
                      </span>
                      <span className="text-indigo-400">→</span>
                      <span className={`font-bold truncate max-w-[180px] ${isChanged ? 'text-emerald-400' : 'text-slate-200'}`} title={detail.selectedModel}>
                        {detail.selectedModel}
                      </span>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="text-[11px] text-slate-300 font-sans flex items-start gap-1.5">
                    <Sparkles size={12} className="text-indigo-400 shrink-0 mt-0.5" />
                    <span><strong>Reason:</strong> {detail.reason}</span>
                  </div>

                  {/* Rejected candidates */}
                  {detail.rejectedCandidates && detail.rejectedCandidates.length > 0 ? (
                    <div className="text-[10px] text-slate-400 bg-slate-900/80 p-1.5 rounded border border-slate-800 space-y-0.5">
                      <div className="font-bold text-amber-400/90 font-sans">Rejected Candidates ({detail.rejectedCandidates.length}):</div>
                      {detail.rejectedCandidates.map((rej, rIdx) => (
                        <div key={rIdx} className="flex items-start gap-1">
                          <span className="text-red-400 shrink-0">✕</span>
                          <span className="text-slate-300 font-mono font-semibold">{rej.candidate}:</span>
                          <span className="text-slate-400 font-sans">{rej.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] text-emerald-400/80 font-sans flex items-center gap-1">
                      <Check size={11} />
                      <span>First candidate matched without diversity conflicts.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

