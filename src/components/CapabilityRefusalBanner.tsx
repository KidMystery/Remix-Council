/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
import React from 'react';
import { AlertOctagon, Sparkles, RefreshCw, Cpu, Settings as SettingsIcon } from 'lucide-react';
import { CapabilityFailure, Persona } from '../types';
import { HIGH_CAPABILITY_CODING_MODELS } from '../lib/capabilityGuard';

interface CapabilityRefusalBannerProps {
  failure: CapabilityFailure;
  roundId: string;
  isDeliberating: boolean;
  onUpgradeAndReRun: (roundId: string) => void;
  onSwitchToGeminiFlash: (roundId: string) => void;
  onOpenSettings: () => void;
}

export const CapabilityRefusalBanner: React.FC<CapabilityRefusalBannerProps> = ({
  failure,
  roundId,
  isDeliberating,
  onUpgradeAndReRun,
  onSwitchToGeminiFlash,
  onOpenSettings,
}) => {
  return (
    <div
      role="alert"
      className="p-4 rounded-xl bg-amber-500/10 dark:bg-amber-950/40 border-2 border-amber-500/50 dark:border-amber-500/60 shadow-lg flex flex-col gap-3 my-2"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5">
          <AlertOctagon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-amber-800 dark:text-amber-200">
              Deliberation Halted: Model Incapability Reported
            </h4>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-200/60 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-semibold border border-amber-300 dark:border-amber-700">
              Stage {failure.stage} · {failure.personaName} ({failure.model})
            </span>
          </div>

          <p className="text-xs text-amber-900/90 dark:text-amber-300/90 mt-1 leading-relaxed">
            The assigned model stated it is not able to read or inspect the uploaded code archive. Deliberation was stopped immediately to prevent incomplete or hallucinated consensus.
          </p>

          {failure.detectedSnippet && (
            <div className="mt-2 p-2 rounded bg-amber-900/10 dark:bg-black/40 border border-amber-500/30 text-[11px] font-mono text-amber-950 dark:text-amber-200 italic">
              "{failure.detectedSnippet}"
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-amber-500/20">
        <button
          type="button"
          disabled={isDeliberating}
          onClick={() => onUpgradeAndReRun(roundId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
        >
          <Sparkles size={13} />
          <span>Switch to High-Capability Coding Models & Re-run</span>
        </button>

        <button
          type="button"
          disabled={isDeliberating}
          onClick={() => onSwitchToGeminiFlash(roundId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
        >
          <Cpu size={13} />
          <span>Use Gemini 3.7 Flash (1M+ Context)</span>
        </button>

        <button
          type="button"
          disabled={isDeliberating}
          onClick={onOpenSettings}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-500/10 border border-amber-400/40 dark:border-amber-700 transition-colors cursor-pointer disabled:opacity-50"
        >
          <SettingsIcon size={13} />
          <span>Configure Models in Settings</span>
        </button>
      </div>
    </div>
  );
};
