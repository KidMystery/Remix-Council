import React from 'react';
import { ShieldCheck, TrendingUp, CheckCircle2, AlertCircle, Users, Activity } from 'lucide-react';
import type { ConsensusMetric, Persona } from '../types';

export interface ConsensusVisualizerProps {
  metric?: ConsensusMetric | undefined;
  personas?: Persona[];
  roundIndex?: number;
}

export const ConsensusVisualizer: React.FC<ConsensusVisualizerProps> = ({
  metric,
  personas = [],
  roundIndex,
}) => {
  // If no metric is provided, render nothing.
  if (!metric) return null;

  const score = Math.min(100, Math.max(0, metric.agreementScore || 85));
  const delta = metric.iterationDelta ?? 0;

  // Determine score tone
  const getScoreColor = (val: number) => {
    if (val >= 80) return 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40';
    if (val >= 60) return 'text-cyan-400 border-cyan-500/40 bg-cyan-950/40';
    return 'text-amber-400 border-amber-500/40 bg-amber-950/40';
  };

  const getScoreBarGradient = (val: number) => {
    if (val >= 80) return 'from-emerald-500 to-teal-400';
    if (val >= 60) return 'from-cyan-500 to-blue-400';
    return 'from-amber-500 to-orange-400';
  };

  return (
    <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 sm:p-5 space-y-4 shadow-inner">
      {/* Header with Gauge & Delta */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-cyan-950 rounded-lg border border-cyan-800 text-cyan-400">
            <Activity size={16} />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Consensus Convergence Telemetry {roundIndex !== undefined ? `(Iteration ${roundIndex})` : ''}
            </h4>
            <p className="text-[11px] text-slate-400">
              Multi-model semantic agreement & invariant stability
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {delta !== 0 && (
            <div
              className={`inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border ${
                delta > 0
                  ? 'text-emerald-300 bg-emerald-950/80 border-emerald-700/60'
                  : 'text-amber-300 bg-amber-950/80 border-amber-700/60'
              }`}
            >
              <TrendingUp size={12} className={delta < 0 ? 'rotate-180' : ''} />
              <span>{delta > 0 ? `+${delta}%` : `${delta}%`} Shift</span>
            </div>
          )}

          <div className={`px-3 py-1 rounded-xl border font-mono font-bold text-sm ${getScoreColor(score)} flex items-center gap-1.5`}>
            <ShieldCheck size={15} />
            <span>{score}% Consensus</span>
          </div>
        </div>
      </div>

      {/* Progress Bar Gauge */}
      <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
        <div
          className={`h-full bg-gradient-to-r ${getScoreBarGradient(score)} transition-all duration-700`}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Panelist Alignment Matrix */}
      {metric.panelistAlignment && Object.keys(metric.panelistAlignment).length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Users size={12} />
            <span>Panelist Convergence Alignment</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {Object.entries(metric.panelistAlignment).map(([personaId, alignScore]) => {
              const persona = personas.find((p) => p.id === personaId);
              const name = persona?.name || personaId;
              return (
                <div
                  key={personaId}
                  className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl flex flex-col justify-between text-xs"
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-300 mb-1.5">
                    <span className="truncate max-w-[130px]" title={name}>{name}</span>
                    <span className="font-mono text-cyan-400 font-bold">{alignScore}%</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-cyan-500 h-full rounded-full transition-all"
                      style={{ width: `${alignScore}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Locked Invariants vs Disagreements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
        {/* Consensus Invariants */}
        {metric.keyConsensusPoints && metric.keyConsensusPoints.length > 0 && (
          <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded-xl space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <CheckCircle2 size={13} />
              <span>Locked Architectural Invariants</span>
            </div>
            <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside">
              {metric.keyConsensusPoints.map((pt, i) => (
                <li key={i} className="line-clamp-2">{pt}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Key Disagreements */}
        {metric.keyDisagreements && metric.keyDisagreements.length > 0 && (
          <div className="p-3 bg-amber-950/20 border border-amber-900/40 rounded-xl space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
              <AlertCircle size={13} />
              <span>Active Disagreements / Open Trade-offs</span>
            </div>
            <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside">
              {metric.keyDisagreements.map((pt, i) => (
                <li key={i} className="line-clamp-2">{pt}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
