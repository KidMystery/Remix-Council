import React from 'react';
import { RefreshCw, Volume2, VolumeX, Check, Copy, Globe } from 'lucide-react';
import { CouncilRound, Persona } from '../types';
import { MessageMarkdown } from './MessageMarkdown';
import { GroundingSourcesCard } from './GroundingSourcesCard';
import { ThinkingIndicator } from './ThinkingIndicator';
import { LATEST_GEMINI_FLASH } from '../config/modelCatalog';

interface SynthesisCardProps {
  round: CouncilRound;
  synthesizer: Persona;
  isDeliberating: boolean;
  speakingId: string | null;
  copiedId: string | null;
  onSpeak: (text: string, id: string) => void;
  onCopy: (id: string, text: string) => void;
  onResynthesize: (roundId: string) => void;
  defaultSynthModel?: string;
}

export const SynthesisCard: React.FC<SynthesisCardProps> = ({
  round,
  synthesizer,
  isDeliberating,
  speakingId,
  copiedId,
  onSpeak,
  onCopy,
  onResynthesize,
  defaultSynthModel = LATEST_GEMINI_FLASH,
}) => {
  if (!round.synthesis?.content && round.synthesis?.status !== 'streaming') {
    return null;
  }

  const activeModel = round.synthesis?.model || synthesizer.model || defaultSynthModel;

  return (
    <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border-2 border-amber-400/60 dark:border-amber-500/40 shadow-xl space-y-4 text-slate-800 dark:text-slate-100 min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-amber-200 dark:border-amber-500/20 pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h3 className="text-base font-bold text-amber-900 dark:text-amber-300 flex items-center gap-2 whitespace-normal break-words">
            <span className="text-lg shrink-0">⚖️</span>
            <span>
              {round.resolvedMode === 'quick_panel'
                ? 'Quick Panel Synthesis'
                : Object.keys(round.deliberation?.stage1 || {}).length === 1
                ? 'Council Member Response'
                : 'Stage 3: Council Verdict & Synthesis'}
            </span>
          </h3>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded border inline-flex items-center gap-1 shrink-0 ${
              round.synthesis?.grounding
                ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700/70'
                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700/60'
            }`}
            title={`Synthesis Model: ${activeModel}`}
          >
            {round.synthesis?.grounding && <Globe size={10} className="text-emerald-600 dark:text-emerald-400 shrink-0" />}
            <span className="whitespace-normal break-words">{activeModel}</span>
          </span>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          {!isDeliberating && (
            <button
              type="button"
              onClick={() => onResynthesize(round.id)}
              className="text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              title="Re-run synthesis using current stage outputs"
            >
              <RefreshCw size={13} />
              <span>Re-synthesize</span>
            </button>
          )}

          {round.synthesis.content && (
            <>
              <button
                type="button"
                onClick={() => onSpeak(round.synthesis.content, `${round.id}-synthesis`)}
                className={`transition-colors p-1.5 rounded text-xs font-medium flex items-center gap-1 cursor-pointer ${
                  speakingId === `${round.id}-synthesis`
                    ? 'text-amber-900 dark:text-amber-200 bg-amber-200/80 dark:bg-amber-950/80 animate-pulse'
                    : 'text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                }`}
                title={speakingId === `${round.id}-synthesis` ? 'Stop reading' : 'Read synthesis aloud'}
              >
                {speakingId === `${round.id}-synthesis` ? <VolumeX size={13} /> : <Volume2 size={13} />}
                <span>{speakingId === `${round.id}-synthesis` ? 'Stop' : 'Listen'}</span>
              </button>

              <button
                type="button"
                onClick={() => onCopy(`${round.id}-synthesis`, round.synthesis.content)}
                className="text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copiedId === `${round.id}-synthesis` ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={14} />}
                <span>{copiedId === `${round.id}-synthesis` ? 'Copied' : 'Copy Consensus'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {round.synthesis.status === 'error' ? (
        <div className="mt-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 p-4 rounded-lg border border-red-300 dark:border-red-900/50 flex flex-col gap-3">
          <span className="font-bold">⚠️ Synthesis Phase Error</span>
          <span className="font-mono text-xs whitespace-normal break-words">{round.synthesis.error}</span>
          <button
            type="button"
            onClick={() => onResynthesize(round.id)}
            disabled={isDeliberating}
            className="self-start text-xs font-semibold px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} /> Retry Synthesis
          </button>
        </div>
      ) : round.synthesis.content ? (
        <div className="space-y-3 min-w-0 max-w-full overflow-hidden">
          <div className="text-slate-900 dark:text-slate-100 whitespace-normal break-words [overflow-wrap:anywhere]">
            <MessageMarkdown content={round.synthesis.content} />
          </div>
          <GroundingSourcesCard grounding={round.synthesis.grounding} />
        </div>
      ) : (
        <ThinkingIndicator
          stageLabel="Synthesis Phase"
          personaName={synthesizer.name}
          role="Consensus Builder"
          model={activeModel}
          accentColor="amber"
        />
      )}
    </div>
  );
};
