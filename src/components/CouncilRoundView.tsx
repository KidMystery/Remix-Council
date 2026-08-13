import React from 'react';
import { RefreshCw, Volume2, VolumeX, Check, Copy, Globe, Trash2 } from 'lucide-react';
import { CouncilRound, Persona, PersonaResponse, Settings } from '../types';
import { MessageMarkdown } from './MessageMarkdown';
import { GroundingSourcesCard } from './GroundingSourcesCard';
import { ThinkingIndicator } from './ThinkingIndicator';
import { SynthesisCard } from './SynthesisCard';
import { CompareProCard } from './CompareProCard';
import { SynthesizeConsensusPanel } from './SynthesizeConsensusPanel';

interface CouncilRoundViewProps {
  round: CouncilRound;
  index: number;
  personas: Persona[];
  synthesizer: Persona;
  isDeliberating: boolean;
  basicMode: boolean;
  speakingId: string | null;
  copiedId: string | null;
  settings: Settings;
  onDeleteRound: (roundId: string) => void;
  onRegeneratePersona: (roundId: string, personaId: string, stage: 1 | 2) => void;
  onResynthesize: (roundId: string) => void;
  onSpeak: (text: string, id: string) => void;
  onCopy: (id: string, text: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onReRunRound: (id: string) => void;
  onEditPrompt: (id: string) => void;
  onResumeRound?: (id: string) => void;
  incompleteStage?: { isIncomplete: boolean; stage: 1 | 2 | 3; description: string };
}

export const CouncilRoundView: React.FC<CouncilRoundViewProps> = ({
  round,
  index,
  personas,
  synthesizer,
  isDeliberating,
  basicMode,
  speakingId,
  copiedId,
  settings,
  onDeleteRound,
  onRegeneratePersona,
  onResynthesize,
  onSpeak,
  onCopy,
  isCollapsed,
  onToggleCollapse,
  onReRunRound,
  onEditPrompt,
  onResumeRound,
  incompleteStage,
}) => {
  return (
    <div className="space-y-6 pb-6 border-b border-slate-200 dark:border-slate-800/80">
      {/* User Query Banner */}
      <div 
        className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200/50 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 flex flex-col space-y-4 shadow-sm transition-colors cursor-pointer"
        onClick={() => onToggleCollapse(round.id)}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              Round #{index + 1}
            </span>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${
              round.resolvedMode === 'quick_panel'
                ? 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60'
                : 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60'
            }`}>
              {round.resolvedMode === 'quick_panel' ? '⚡ Quick Panel' : '🏛️ Deep Council'}
            </span>
            {index > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-800/50">
                <Globe size={10} /> Archivist Memory Active
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              {new Date(round.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
            {round.userQuery}
          </p>
          {round.attachedImages && round.attachedImages.length > 0 && (
            <div className="flex items-center gap-2 pt-2 flex-wrap">
              {round.attachedImages.map((img, i) => (
                <span key={i} className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded text-slate-600 dark:text-slate-300 font-mono">
                  📎 {img.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-200/50 dark:border-slate-700/50" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onCopy(`prompt-${round.id}`, round.userQuery)}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 transition-colors"
              title="Copy prompt"
            >
              {copiedId === `prompt-${round.id}` ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
              <span>Copy</span>
            </button>
            {incompleteStage && incompleteStage.isIncomplete && onResumeRound && (
              <button
                onClick={() => onResumeRound(round.id)}
                disabled={isDeliberating}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-200 bg-amber-950/90 hover:bg-amber-900/90 px-2 py-0.5 rounded border border-amber-600/80 transition-colors shadow-sm disabled:opacity-50"
              >
                <RefreshCw size={10} className={isDeliberating ? 'animate-spin text-amber-300' : 'text-amber-300'} />
                <span>Resume {incompleteStage.description}</span>
              </button>
            )}
            <button
              onClick={() => onReRunRound(round.id)}
              disabled={isDeliberating}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={10} />
              <span>Re-run All</span>
            </button>
            <button
              onClick={() => onEditPrompt(round.id)}
              disabled={isDeliberating}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 transition-colors disabled:opacity-50"
            >
              <Check size={10} className="hidden" />
              <span>Edit Prompt</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Delete this prompt attempt?')) onDeleteRound(round.id);
              }}
              disabled={isDeliberating}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/60 px-2 py-0.5 rounded border border-red-800/50 transition-colors disabled:opacity-50"
            >
              <Trash2 size={10} />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* Stage 1: Initial Persona Responses */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          Stage 1: Council Member Statements
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {personas.map((persona) => {
            const resp = round.deliberation?.stage1?.[persona.id];
            const copyKey = `${round.id}-stage1-${persona.id}`;
            return (
              <div
                key={`s1-${persona.id}`}
                className={`p-4 rounded-xl bg-white dark:bg-slate-900 border ${persona.color} flex flex-col justify-between space-y-4 shadow-sm min-w-0 break-words`}
              >
                <div className="space-y-3 min-w-0">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 gap-2">
                    <div className="flex items-center space-x-2 min-w-0 truncate">
                      <span className="text-xl shrink-0">{persona.avatar}</span>
                      <div className="min-w-0 truncate">
                        <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{persona.name}</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{persona.role}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        type="button"
                        disabled={isDeliberating}
                        onClick={() => onRegeneratePersona(round.id, persona.id, 1)}
                        className="text-slate-400 hover:text-cyan-400 transition-colors p-1 rounded disabled:opacity-30"
                        title="Regenerate persona response"
                      >
                        <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-cyan-400' : ''} />
                      </button>
                      {resp?.content && (
                        <>
                          <button
                            type="button"
                            onClick={() => onSpeak(resp.content, copyKey)}
                            className={`p-1 rounded transition-colors ${speakingId === copyKey ? 'text-cyan-400 bg-cyan-950/60' : 'text-slate-400 hover:text-slate-200'}`}
                          >
                            {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => onCopy(copyKey, resp.content)}
                            className="p-1 rounded text-slate-400 hover:text-slate-200 transition-colors"
                          >
                            {copiedId === copyKey ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {resp?.status === 'error' ? (
                    <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 min-w-0 break-words">
                      Error: {resp.error}
                    </div>
                  ) : resp?.content ? (
                    <div className="min-w-0 max-w-full overflow-x-auto break-words text-xs">
                      <MessageMarkdown content={resp.content} />
                      <GroundingSourcesCard grounding={resp.grounding} />
                    </div>
                  ) : (
                    <ThinkingIndicator
                      stageLabel="Stage 1 Response"
                      personaName={persona.name}
                      role={persona.role}
                      model={persona.model || settings.defaultModels[persona.id]}
                      accentColor="cyan"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}
      {!basicMode &&
        round.resolvedMode === 'deep_council' &&
        Object.keys(round.deliberation?.stage1 || {}).length > 1 &&
        round.deliberation?.stage2 &&
        Object.values(round.deliberation.stage2).some(
          (resp: PersonaResponse | any) => resp?.content || resp?.status === 'streaming'
        ) && (
          <div className="space-y-3 pt-2 min-w-0">
            <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              Stage 2: Peer Review & Cross-Examination
            </h3>

            <div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full">
              {personas
                .filter((persona) => round.deliberation?.stage2?.[persona.id])
                .map((persona) => {
                  const resp = round.deliberation?.stage2?.[persona.id];
                  const copyKey = `${round.id}-stage2-${persona.id}`;
                  if (!resp) return null;
                  return (
                    <div
                      key={`s2-${persona.id}`}
                      className={`p-4 sm:p-5 rounded-xl bg-white dark:bg-slate-900 border ${persona.color} flex flex-col justify-between space-y-4 shadow-sm min-w-0 break-words`}
                    >
                      <div className="space-y-3 min-w-0">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2 gap-2">
                          <div className="flex items-center space-x-2.5 min-w-0 truncate">
                            <span className="text-xl shrink-0">{persona.avatar}</span>
                            <div className="min-w-0 truncate">
                              <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{persona.name}</h4>
                              <p className="text-[11px] text-purple-300/80 truncate">Peer Review</p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1 shrink-0">
                            <button
                              type="button"
                              disabled={isDeliberating}
                              onClick={() => onRegeneratePersona(round.id, persona.id, 2)}
                              className="text-slate-400 hover:text-purple-300 disabled:opacity-30 p-1.5 rounded"
                            >
                              <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-purple-400' : ''} />
                            </button>
                            {resp?.content && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onSpeak(resp.content, copyKey)}
                                  className={`p-1.5 rounded ${speakingId === copyKey ? 'text-purple-400 bg-purple-950/60' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                  {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onCopy(copyKey, resp.content)}
                                  className="p-1.5 rounded text-slate-400 hover:text-slate-200"
                                >
                                  {copiedId === copyKey ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {resp?.status === 'error' ? (
                          <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 min-w-0 break-words">
                            Error: {resp.error}
                          </div>
                        ) : resp?.content ? (
                          <div className="min-w-0 max-w-full overflow-x-auto break-words text-xs">
                            <MessageMarkdown content={resp.content} />
                            <GroundingSourcesCard grounding={resp.grounding} />
                          </div>
                        ) : (
                          <ThinkingIndicator
                            stageLabel="Stage 2 Peer Review"
                            personaName={persona.name}
                            role="Peer Reviewer"
                            model={persona.model || settings.defaultModels[persona.id]}
                            accentColor="purple"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

      {/* Synthesize Consensus Summary Panel */}
      {Object.values(round.deliberation?.stage1 || {}).some(
        (resp: PersonaResponse | any) => resp?.status === 'completed' && resp?.content?.trim()
      ) && (
        <SynthesizeConsensusPanel
          round={round}
          personas={personas}
          synthesizer={synthesizer}
          isDeliberating={isDeliberating}
          onSynthesizeConsensus={onResynthesize}
          speak={onSpeak}
          speakingId={speakingId}
          copiedId={copiedId}
          handleCopy={onCopy}
          basicMode={basicMode}
        />
      )}

      {/* Stage 3: Synthesis Card */}
      <SynthesisCard
        round={round}
        synthesizer={synthesizer}
        isDeliberating={isDeliberating}
        speakingId={speakingId}
        copiedId={copiedId}
        onSpeak={onSpeak}
        onCopy={onCopy}
        onResynthesize={onResynthesize}
        defaultSynthModel={settings.defaultModels['synthesizer']}
      />

      {/* Pro Comparison Benchmark Card */}
      {!basicMode && round.proComparisonData && (
        <CompareProCard
          auditLogId={round.proComparisonData.auditLogId}
          userQuery={round.userQuery}
          proModelId={round.proComparisonData.proModelId}
          councilContent={round.synthesis.content}
          proContent={round.proComparisonData.proContent}
          councilLatencyMs={round.proComparisonData.councilLatencyMs}
          proLatencyMs={round.proComparisonData.proLatencyMs}
          councilCost={round.proComparisonData.councilCost}
          proCost={round.proComparisonData.proCost}
          answerAIsCouncil={round.proComparisonData.answerAIsCouncil}
        />
      )}
        </>
      )}
    </div>
  );
};
