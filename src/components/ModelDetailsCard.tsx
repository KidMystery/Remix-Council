import React from 'react';
import {
  Award,
  Crown,
  AlertTriangle,
  Info,
  Sparkles,
  Eye,
  EyeOff,
  Activity,
} from 'lucide-react';
import { getModelDetails, ModelDetails } from '../lib/modelDetails';
import { RawOpenRouterModel } from '../lib/presets';

interface ModelDetailsCardProps {
  modelId: string;
  personaRole?: string;
  personaName?: string;
  personaAvatar?: string;
  rawModelsCatalog?: RawOpenRouterModel[] | null;
  fallbackLogs?: Array<{ personaId: string; originalModel: string; fallbackModel: string; reason: string }>;
  currentPresetId?: string;
  className?: string;
}

export function ModelDetailsCard({
  modelId,
  personaRole,
  personaName,
  personaAvatar,
  rawModelsCatalog,
  fallbackLogs,
  currentPresetId,
  className = '',
}: ModelDetailsCardProps) {
  const details: ModelDetails = getModelDetails(
    modelId,
    personaRole,
    rawModelsCatalog,
    fallbackLogs,
    currentPresetId
  );

  return (
    <div className={`bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3 text-xs text-slate-200 shadow-sm font-sans ${className}`}>
      {/* Header: Persona Avatar + Name + Model Name & Badges */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          {personaAvatar && (
            <span className="text-base p-1 bg-slate-800 rounded-lg shrink-0">{personaAvatar}</span>
          )}
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-slate-100 text-sm">{details.displayName}</span>
              {/* Chair Indicator */}
              {details.isChair && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-semibold">
                  <Crown size={10} className="fill-amber-400 text-amber-400" />
                  <span>Council Chair</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
              <span className="font-medium text-slate-300">{details.authorOrg}</span>
              <span>•</span>
              <span className="font-mono">{details.contextLengthFormatted}</span>
              <span>•</span>
              <span className="font-mono">{details.modelAgeFormatted}</span>
            </div>
          </div>
        </div>

        {/* Free/Paid Badge + Cost */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            {details.isFree ? (
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                Free ($0)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                Paid API
              </span>
            )}
            <span className="font-mono text-xs font-semibold text-emerald-400">{details.costFormatted}</span>
          </div>

          {/* Live/Vision capability badges (only shown when a live catalog is loaded) */}
          {(details.health !== 'unknown' || details.hasVision !== null) && (
            <div className="flex items-center gap-1.5">
              {details.health === 'live' && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider"
                  title="Verified present in the live OpenRouter catalog"
                >
                  <Activity size={10} />
                  Live
                </span>
              )}
              {details.health === 'delisted' && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 text-[10px] font-bold uppercase tracking-wider"
                  title="Not found in the live OpenRouter catalog — requests may fail or auto-substitute"
                >
                  <AlertTriangle size={10} />
                  Delisted
                </span>
              )}
              {details.hasVision === true && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold uppercase tracking-wider"
                  title="Accepts image input"
                >
                  <Eye size={10} />
                  Vision
                </span>
              )}
              {details.hasVision === false && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-700/40 border border-slate-600/50 text-slate-300 text-[10px] font-bold uppercase tracking-wider"
                  title="Text-only model — cannot read image attachments"
                >
                  <EyeOff size={10} />
                  Text only
                </span>
              )}
            </div>
          )}

          {/* Cross-Preset Overlap Badge */}
          {details.alsoInPresets && (
            <div className="flex flex-wrap gap-1 justify-end">
              {details.alsoInPresets.map((presetName, pIdx) => (
                <span
                  key={pIdx}
                  className="px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[9px] font-mono"
                  title={`This model is also assigned in the ${presetName} preset`}
                >
                  Also in {presetName}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rationale Section */}
      <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-[11px] text-slate-300 leading-relaxed flex items-start gap-2">
        <Info size={13} className="text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-200">Selection Rationale: </span>
          <span>{details.selectionRationale}</span>
        </div>
      </div>

      {/* Delisted warning */}
      {details.health === 'delisted' && (
        <div className="bg-red-950/40 border border-red-500/40 p-2 rounded-lg text-[11px] text-red-300 flex items-center gap-2">
          <AlertTriangle size={13} className="text-red-400 shrink-0" />
          <span>
            Not in the live OpenRouter catalog. Requests with this model will be auto-substituted with a live
            model (or fail in strict mode) — pick a model marked <strong>Live</strong> to be sure.
          </span>
        </div>
      )}

      {/* Fallback Indicator if active */}
      {details.isFallback && (
        <div className="bg-amber-950/40 border border-amber-500/40 p-2 rounded-lg text-[11px] text-amber-300 flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-400 shrink-0" />
          <span>{details.fallbackInfo || 'Automatic Fallback Active'}</span>
        </div>
      )}

      {/* Rank Badges + Quality Comparison */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        {/* Rank Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {details.rankBadges.map((badge, bIdx) => (
            <span
              key={bIdx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-medium text-cyan-300"
            >
              <Award size={10} className="text-cyan-400" />
              <span>{badge}</span>
            </span>
          ))}
        </div>

        {/* Fast & Free Quality Comparison */}
        {details.qualityComparisonText && (
          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-700/50 text-[10px] font-mono text-indigo-300">
            <Sparkles size={11} className="text-indigo-400" />
            <span>{details.qualityComparisonText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
