import React from 'react';
import { ShieldCheck, Coins, Zap, Clock, Layers, Sparkles } from 'lucide-react';
import { Persona } from '../types';
import { RawOpenRouterModel } from '../lib/presets';
import { getAuthorOrganization, estimatedCost } from '../lib/modelMapper';
import { formatUpdateTime } from '../lib/modelCache';

interface CouncilSummaryBarProps {
  presetId?: string;
  answerMode?: string;
  taskDomain?: string;
  personas: Persona[];
  synthesizer?: Persona;
  rawModels?: RawOpenRouterModel[] | null;
  updatedAt?: number;
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
  className = '',
}: CouncilSummaryBarProps) {
  const activePersonas = personas.filter((p) => p.enabled !== false);
  const allActive = [...activePersonas];
  if (synthesizer) {
    allActive.push(synthesizer);
  }

  // 1. Selected Preset
  const presetLabels: Record<string, string> = {
    fast_and_free: 'Fast & Free ($0)',
    fast_and_cheap: 'Fast & Cheap',
    best_value: 'Best Value',
    highest_quality: 'Highest Quality',
    custom: 'Custom Council',
  };
  const presetLabel = presetLabels[presetId] || 'Custom Council';

  // 2. Answer Mode
  const formattedAnswerMode = answerMode
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());

  // 3. Four Organizations Represented
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

  // 4. Estimated API call count per deliberation round
  const estimatedCallCount = activePersonas.length + (synthesizer ? 1 : 0);

  // 5. Estimated total cost per deliberation round
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

  // 6. Last refresh timestamp
  const refreshTimeStr = formatUpdateTime(updatedAt);

  return (
    <div
      className={`bg-slate-900/90 backdrop-blur border border-slate-800/90 rounded-xl p-3.5 text-xs text-slate-300 shadow-lg font-sans ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
        {/* Metric 1: Preset */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Zap size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Preset</div>
            <div className="font-semibold text-slate-100">{presetLabel}</div>
          </div>
        </div>

        {/* Metric 2: Answer Mode */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Sparkles size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Answer Mode</div>
            <div className="font-semibold text-slate-100">{formattedAnswerMode}</div>
          </div>
        </div>

        {/* Metric 2.5: Smart Domain */}
        {taskDomain && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Sparkles size={14} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Domain Routing</div>
              <div className="font-semibold text-indigo-300 uppercase">{taskDomain}</div>
            </div>
          </div>
        )}

        {/* Metric 3: Organizations Represented */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <ShieldCheck size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
              Organizations ({orgCount})
            </div>
            <div className="font-semibold text-slate-100 max-w-[180px] truncate" title={orgListStr}>
              {orgListStr || 'None selected'}
            </div>
          </div>
        </div>

        {/* Metric 4: API Calls */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <Layers size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">API Calls / Round</div>
            <div className="font-semibold text-slate-100 font-mono">{estimatedCallCount} calls</div>
          </div>
        </div>

        {/* Metric 5: Estimated Cost */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Coins size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Est. Cost</div>
            <div className="font-semibold text-emerald-400 font-mono">{costFormatted}</div>
          </div>
        </div>

        {/* Metric 6: Refresh Timestamp */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400">
            <Clock size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Recommendations</div>
            <div className="font-semibold text-slate-300 font-mono">{refreshTimeStr}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
