import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Clock, Coins, Layers, Activity, AlertTriangle, CheckCircle2, Award, Zap, Trash2, ChevronDown, ChevronRight, BarChart2 } from 'lucide-react';
import { getStoredAuditLogs, clearAuditLogs, CouncilRequestAuditLog } from '../lib/auditLogger';
import { ConfirmButton } from './ConfirmButton';

interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuditLogModal({ isOpen, onClose }: AuditLogModalProps) {
  const [logs, setLogs] = useState<CouncilRequestAuditLog[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLogs(getStoredAuditLogs());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClear = () => {
    clearAuditLogs();
    setLogs([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl text-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Activity size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Request Audit & Telemetry Logs
              </h2>
              <p className="text-xs text-slate-400">
                Detailed metrics per deliberation request • Zero private content stored
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {logs.length > 0 && (
              <ConfirmButton
                onConfirm={handleClear}
                confirmPrompt="Click again to clear"
                className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                idleChildren={
                  <>
                    <Trash2 size={13} />
                    <span>Clear Logs</span>
                  </>
                }
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {logs.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-2">
              <BarChart2 size={36} className="mx-auto text-slate-600" />
              <p className="text-sm font-semibold">No audit logs recorded yet.</p>
              <p className="text-xs text-slate-500">Run a deliberation query to record performance & model telemetry.</p>
            </div>
          ) : (
            logs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const dateStr = new Date(log.timestamp).toLocaleString();

              return (
                <div
                  key={log.id}
                  className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm transition-all"
                >
                  {/* Summary Bar for Log Entry */}
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-slate-400">
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-indigo-300">{log.presetName}</span>
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300 uppercase font-mono">
                            {log.answerMode}
                          </span>
                          {log.fallbackEvents.length > 0 && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                              <AlertTriangle size={10} />
                              <span>{log.fallbackEvents.length} Fallback</span>
                            </span>
                          )}
                          {log.proComparison?.userVote && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                              Pro Vote: {log.proComparison.userVote.replace('_', ' ').toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{dateStr}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Wall-Clock</div>
                        <div className="text-cyan-400 font-bold">{log.totalWallClockMs} ms</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Panel Success</div>
                        <div className="text-emerald-400 font-bold">
                          {log.panelSuccessCount}/{log.panelTotalCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Tokens</div>
                        <div className="text-slate-200">{log.totalTokens.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Total Cost</div>
                        <div className="text-amber-400 font-bold">${log.totalCost.toFixed(5)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="p-4 border-t border-slate-800 bg-slate-900/80 space-y-4 text-xs">
                      <h4 className="font-bold text-slate-200 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                        <Layers size={13} className="text-indigo-400" />
                        <span>Per-Model Execution Breakdown ({log.modelAudits.length} Models)</span>
                      </h4>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {log.modelAudits.map((mAudit, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2 font-sans"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="font-bold text-slate-100 text-sm">{mAudit.personaId.toUpperCase()}</div>
                                <div className="text-[11px] text-slate-400 font-mono">{mAudit.selectedModelId}</div>
                              </div>
                              <div className="text-right font-mono">
                                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-bold text-[10px]">
                                  ${mAudit.cost.toFixed(5)}
                                </span>
                              </div>
                            </div>

                            {/* Resolved Model if changed */}
                            {mAudit.selectedModelId !== mAudit.resolvedModelId && (
                              <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 p-1.5 rounded flex items-center gap-1 font-mono">
                                <AlertTriangle size={11} className="shrink-0 text-amber-400" />
                                <span>Resolved: {mAudit.resolvedModelId}</span>
                              </div>
                            )}

                            {/* Author Org & Latency */}
                            <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-300 font-mono bg-slate-900/60 p-2 rounded">
                              <div>
                                <span className="text-slate-400 block text-[9px] uppercase">Org</span>
                                <span className="font-semibold">{mAudit.authorOrg}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[9px] uppercase">Latency</span>
                                <span className="font-semibold text-cyan-300">{mAudit.latencyMs} ms</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[9px] uppercase">Tokens</span>
                                <span>{mAudit.promptTokens} in / {mAudit.completionTokens} out</span>
                              </div>
                            </div>

                            {/* Scores */}
                            <div className="pt-1">
                              <div className="text-[10px] text-slate-400 font-medium mb-1">Dimension Scores:</div>
                              <div className="grid grid-cols-4 gap-1 text-[10px] font-mono text-center">
                                <div className="bg-slate-900 p-1 rounded border border-slate-800">
                                  <div className="text-slate-400 text-[8px]">INTEL</div>
                                  <div className="text-indigo-400 font-bold">{mAudit.scores.intelligence}</div>
                                </div>
                                <div className="bg-slate-900 p-1 rounded border border-slate-800">
                                  <div className="text-slate-400 text-[8px]">SPEED</div>
                                  <div className="text-emerald-400 font-bold">{mAudit.scores.speed}</div>
                                </div>
                                <div className="bg-slate-900 p-1 rounded border border-slate-800">
                                  <div className="text-slate-400 text-[8px]">LATENCY</div>
                                  <div className="text-cyan-400 font-bold">{mAudit.scores.latencyRating}</div>
                                </div>
                                <div className="bg-slate-900 p-1 rounded border border-slate-800">
                                  <div className="text-slate-400 text-[8px]">COST RAT.</div>
                                  <div className="text-amber-400 font-bold">{mAudit.scores.costRating}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Pro Comparison section if exists */}
                      {log.proComparison && (
                        <div className="p-3 bg-indigo-950/40 border border-indigo-800/60 rounded-lg space-y-2">
                          <div className="font-bold text-indigo-300 text-xs flex items-center justify-between">
                            <span>Blind Pro Comparison Result</span>
                            <span className="font-mono text-[10px] text-slate-400">Pro Model: {log.proComparison.proModelId}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                            <div className="p-2 bg-slate-900 rounded border border-slate-800">
                              <div className="text-slate-400 text-[10px]">Council Latency & Cost</div>
                              <div className="text-cyan-300 font-bold">{log.proComparison.councilLatencyMs} ms • ${log.proComparison.councilCost.toFixed(5)}</div>
                            </div>
                            <div className="p-2 bg-slate-900 rounded border border-slate-800">
                              <div className="text-slate-400 text-[10px]">Pro Latency & Cost</div>
                              <div className="text-purple-300 font-bold">{log.proComparison.proLatencyMs} ms • ${log.proComparison.proCost.toFixed(5)}</div>
                            </div>
                          </div>
                          <div className="text-[11px] text-emerald-300 font-sans font-medium">
                            User Preference Vote: {log.proComparison.userVote ? log.proComparison.userVote.replace('_', ' ').toUpperCase() : 'Not voted yet'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
