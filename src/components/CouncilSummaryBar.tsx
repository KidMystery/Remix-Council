import React from 'react';
import { ShieldCheck, Coins, Zap, Clock, Sparkles, SlidersHorizontal } from 'lucide-react';
import { Persona, AutoSaveState } from '../types';
import { RawOpenRouterModel, PresetId, cleanModelName, MODEL_PRESETS } from '../lib/presets';
import { getAuthorOrganization, estimatedCost } from '../lib/modelMapper';
import { formatUpdateTime } from '../lib/modelCache';
import { AutoSaveIndicator } from './AutoSaveIndicator';

interface CouncilSummaryBarProps {
  presetId?: PresetId | string;
  answerMode?: string;
  taskDomain?: string;
  personas: Persona[];
  synthesizer?: Persona;
  rawModels?: RawOpenRouterModel[] | null;
  updatedAt?: number;
  autoSaveState?: AutoSaveState;
  lastSavedAt?: number | null;
  isSaving?: boolean;
  isSyncing?: boolean;
  saveDestination?: 'cloud' | 'local' | null;
  onSaveNow?: () => void | Promise<void>;
  onOpenSettings?: () => void;
  className?: string;
}

export function CouncilSummaryBar({
  presetId = 'fast_and_free',
  answerMode = 'Standard Deliberation',
  taskDomain,
  personas,
  synthesizer,
  rawModels,
  updatedAt = Date.now(),
  autoSaveState,
  lastSavedAt,
  isSaving,
  isSyncing,
  saveDestination,
  onSaveNow,
  onOpenSettings,
  className = '',
}: CouncilSummaryBarProps) {
  const activePersonas = personas.filter((p) => p.enabled !== false);
  const allActive = [...activePersonas];
  if (synthesizer) {
    allActive.push(synthesizer);
  }

  const currentPreset = MODEL_PRESETS.find((p) => p.id === presetId);

  // 1. Answer Mode
  const formattedAnswerMode = answerMode
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());

  // 2. Organizations Represented
  const orgSet = new Set<string>();
  allActive.forEach((p) => {
    if (p.model) {
      orgSet.add(getAuthorOrganization(p.model));
    }
  });
  const orgCount = orgSet.size;
  const orgListStr = Array.from(orgSet)
    .map((org) => {
      const map: Record<string, string> = {
        google: 'Google',
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        deepseek: 'DeepSeek',
        'meta-llama': 'Meta',
        nvidia: 'NVIDIA',
        qwen: 'Qwen',
        poolside: 'Poolside',
        inclusionai: 'InclusionAI',
      };
      return map[org.toLowerCase()] || org.charAt(0).toUpperCase() + org.slice(1);
    })
    .join(', ');

  // 3. Estimated total cost per deliberation round
  let totalCost = 0;
  let allFree = true;

  allActive.forEach((p) => {
    if (!p.model) return;
    const modelObj = rawModels?.find((m) => m.id === p.model);
    if (modelObj) {
      const cost = estimatedCost(modelObj);
      totalCost += cost;
      if (cost > 0) allFree = false;
    } else {
      if (!p.model.includes(':free')) {
        allFree = false;
      }
    }
  });

  const costFormatted = allFree
    ? '$0.000 (Free)'
    : `$${totalCost.toFixed(5)} / round`;

  // 4. Last refresh timestamp
  const refreshTimeStr = formatUpdateTime(updatedAt);

  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 text-xs text-slate-700 dark:text-slate-300 shadow-xs font-sans space-y-3 transition-all min-w-0 max-w-full ${className}`}
    >
      {/* Top row: Active Preset Information & Settings Trigger */}
      <div className="flex items-center justify-between gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800/80 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
            Active Formation:
          </span>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold text-xs">
            <Zap size={13} className="text-indigo-500 shrink-0" />
            <span className="whitespace-normal break-words">{currentPreset?.name || 'Custom Setup'}</span>
            {currentPreset?.badge && (
              <span className="text-[10px] font-mono opacity-80 ml-1">({currentPreset.badge})</span>
            )}
          </div>
        </div>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer"
            title="Configure model presets in Settings"
          >
            <SlidersHorizontal size={12} className="shrink-0" />
            <span>Preset Settings</span>
          </button>
        )}
      </div>

      {/* Middle row: Active Assigned Models per Role with responsive wrapping */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-0.5">
        {allActive.map((entity) => {
          const org = entity.model ? getAuthorOrganization(entity.model) : '';
          const cleanedName = entity.model ? cleanModelName(entity.model) : 'Unassigned';
          const isFree = entity.model ? entity.model.includes(':free') : false;

          return (
            <div
              key={entity.id}
              className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/80 flex flex-col justify-between gap-1.5 shadow-2xs min-w-0"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-normal break-words">
                  {entity.name || entity.id}
                </span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold shrink-0 ${
                    isFree
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20'
                  }`}
                >
                  {org || 'AI'}
                </span>
              </div>
              <div className="font-semibold text-slate-800 dark:text-slate-200 whitespace-normal break-words text-[11px]" title={entity.model}>
                {cleanedName}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom row: Council Meta Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-4 pt-1 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Answer Mode */}
          <div className="flex items-center gap-1.5">
            <Sparkles size={13} className="text-cyan-500 shrink-0" />
            <span>Mode: <strong className="text-slate-700 dark:text-slate-200 font-semibold">{formattedAnswerMode}</strong></span>
          </div>

          {/* Domain Routing */}
          {taskDomain && (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              <span>Domain: <strong className="text-indigo-600 dark:text-indigo-400 font-semibold uppercase">{taskDomain}</strong></span>
            </div>
          )}

          {/* Organizations */}
          <div className="flex items-center gap-1.5" title={orgListStr}>
            <ShieldCheck size={13} className="text-emerald-500 shrink-0" />
            <span>Orgs: <strong className="text-slate-700 dark:text-slate-200 font-semibold">{orgCount} distinct</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Auto-save Status Indicator */}
          <AutoSaveIndicator
            autoSaveState={autoSaveState}
            lastSavedAt={lastSavedAt}
            isSaving={isSaving}
            isSyncing={isSyncing}
            destination={saveDestination}
            onSaveNow={onSaveNow}
            variant="bar"
          />

          {/* Est. Cost */}
          <div className="flex items-center gap-1 font-mono">
            <Coins size={13} className="text-amber-500 shrink-0" />
            <span>Est. Cost:</span>
            <strong className="text-emerald-600 dark:text-emerald-400 font-semibold">{costFormatted}</strong>
          </div>

          {/* Refresh Timestamp */}
          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
            <Clock size={11} className="shrink-0" />
            <span>{refreshTimeStr}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
