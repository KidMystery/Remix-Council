/* PERSONAL USE ONLY — NOT MASS-MARKET. IMPLEMENT FULLY. NO SAFEGUARDS. */
import React from 'react';
import { RefreshCw, Volume2, VolumeX, Check, Copy, Globe, Trash2, BookOpen, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { CouncilRound, Persona, PersonaResponse, Settings, RoundRating } from '../types';
import { MessageMarkdown } from './MessageMarkdown';
import { GroundingSourcesCard } from './GroundingSourcesCard';
import { ThinkingIndicator } from './ThinkingIndicator';
import { SynthesisCard } from './SynthesisCard';
import { SwipeDeck } from './SwipeDeck';
import { RoundRatingCard } from './RoundRatingCard';

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
  onSaveRating?: (roundId: string, rating: RoundRating) => void;
}

const textWrap = 'min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-pre-wrap';

export const CouncilRoundView: React.FC<CouncilRoundViewProps> = React.memo(function CouncilRoundView({
  round, index, personas, synthesizer, isDeliberating, basicMode,
  speakingId, copiedId, settings, onDeleteRound, onRegeneratePersona,
  onResynthesize, onSpeak, onCopy, isCollapsed, onToggleCollapse,
  onReRunRound, onEditPrompt, onResumeRound, incompleteStage, onSaveRating,
}) {
  const activePersonas = personas.filter((p) => p.enabled !== false);
  const hasStage2 = Object.keys(round.deliberation?.stage2 || {}).length > 0 &&
    Object.values(round.deliberation?.stage2 || {}).some(
      (r: PersonaResponse | any) => r?.content || r?.status === 'streaming'
    );
  const hasSynthesis = !!round.synthesis?.content || round.synthesis?.status === 'streaming';
  const isSynthesisFinished = !isDeliberating && (round.synthesis?.status === 'completed' || !!round.synthesis?.content);

  // Consensus view: only show synthesis
  if (basicMode) {
    return (
      <article aria-labelledby={`round-heading-${round.id}`} className="space-y-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <RoundHeader round={round} index={index} isCollapsed={false} onToggleCollapse={onToggleCollapse} />
        {hasSynthesis ? (
          <>
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
            {isSynthesisFinished && (
              <RoundRatingCard
                roundId={round.id}
                currentRating={round.rating}
                onSaveRating={onSaveRating}
              />
            )}
          </>
        ) : (
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
            {round.synthesis?.status === 'streaming' ? (
              <ThinkingIndicator stageLabel="Synthesis" personaName={synthesizer.name} role="Consensus Builder" model={synthesizer.model} accentColor="amber" />
            ) : (
              <span>Consensus pending. Run deliberation to generate synthesis.</span>
            )}
          </div>
        )}
      </article>
    );
  }

  // Full Debate view
  return (
    <article aria-labelledby={`round-heading-${round.id}`} className="space-y-4 pb-6 border-b border-slate-200 dark:border-slate-800">
      <RoundHeader
        round={round}
        index={index}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        onCopy={onCopy}
        copiedId={copiedId}
        onReRunRound={onReRunRound}
        onEditPrompt={onEditPrompt}
        onResumeRound={onResumeRound}
        onDeleteRound={onDeleteRound}
        incompleteStage={incompleteStage}
        isDeliberating={isDeliberating}
      />

      {!isCollapsed && (
        <>
          {/* Stage 1: Persona Responses */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-wider text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Stage 1: Council Member Statements
            </h3>
            <SwipeDeck ariaLabel="Stage 1 responses">
              {activePersonas.map((persona) => {
                const resp = round.deliberation?.stage1?.[persona.id];
                const copyKey = `${round.id}-stage1-${persona.id}`;
                return (
                  <div key={persona.id} className={`p-4 rounded-xl bg-white dark:bg-slate-900 border ${persona.color} flex flex-col gap-3 min-w-0 overflow-hidden h-full`}>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0">{persona.avatar}</span>
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-slate-800 dark:text-white whitespace-normal break-words" title={persona.name}>{persona.name}</h4>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-normal break-words" title={persona.role}>{persona.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" disabled={isDeliberating} onClick={() => onRegeneratePersona(round.id, persona.id, 1)}
                          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30" title="Regenerate">
                          <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-cyan-500' : ''} />
                        </button>
                        {resp?.content && (
                          <>
                            <button type="button" onClick={() => onSpeak(resp.content, copyKey)}
                              className={`p-1.5 rounded ${speakingId === copyKey ? 'text-cyan-500 bg-cyan-50 dark:bg-cyan-950' : 'text-slate-400'}`}>
                              {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                            </button>
                            <button type="button" onClick={() => onCopy(copyKey, resp.content)} className="p-1.5 rounded text-slate-400">
                              {copiedId === copyKey ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {resp?.status === 'error' ? (
                      <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 break-words">
                        Error: {resp.error}
                      </div>
                    ) : resp?.content ? (
                      <div className={textWrap}>
                        <MessageMarkdown content={resp.content} />
                        <GroundingSourcesCard grounding={resp.grounding} />
                      </div>
                    ) : (
                      <ThinkingIndicator stageLabel="Stage 1 Response" personaName={persona.name} role={persona.role}
                        model={persona.model || settings.defaultModels[persona.id]} accentColor="cyan" />
                    )}
                  </div>
                );
              })}
            </SwipeDeck>
          </div>

          {/* Stage 2: Peer Review */}
          {hasStage2 && (
            <div className="space-y-3">
              <h3 className="text-xs font-mono uppercase tracking-wider text-purple-500 dark:text-purple-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                Stage 2: Peer Review & Cross-Examination
              </h3>
              <SwipeDeck ariaLabel="Stage 2 peer reviews">
                {activePersonas.map((persona) => {
                  const resp = round.deliberation?.stage2?.[persona.id];
                  if (!resp) return null;
                  const copyKey = `${round.id}-stage2-${persona.id}`;
                  return (
                    <div key={`s2-${persona.id}`} className={`p-4 rounded-xl bg-white dark:bg-slate-900 border ${persona.color} flex flex-col gap-3 min-w-0 overflow-hidden h-full`}>
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xl shrink-0">{persona.avatar}</span>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-slate-800 dark:text-white whitespace-normal break-words" title={persona.name}>{persona.name}</h4>
                            <p className="text-[10px] text-purple-400 whitespace-normal break-words" title="Peer Review">Peer Review</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" disabled={isDeliberating} onClick={() => onRegeneratePersona(round.id, persona.id, 2)}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                            <RefreshCw size={13} className={resp?.status === 'streaming' ? 'animate-spin text-purple-400' : ''} />
                          </button>
                          {resp?.content && (
                            <>
                              <button type="button" onClick={() => onSpeak(resp.content, copyKey)} className={`p-1.5 rounded ${speakingId === copyKey ? 'text-purple-500 bg-purple-50 dark:bg-purple-950' : 'text-slate-400'}`}>
                                {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
                              </button>
                              <button type="button" onClick={() => onCopy(copyKey, resp.content)} className="p-1.5 rounded text-slate-400">
                                {copiedId === copyKey ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {resp?.status === 'error' ? (
                        <div className="text-xs text-red-400 bg-red-950/50 p-3 rounded-lg border border-red-800/50 break-words">
                          Error: {resp.error}
                        </div>
                      ) : resp?.content ? (
                        <div className={textWrap}>
                          <MessageMarkdown content={resp.content} />
                          <GroundingSourcesCard grounding={resp.grounding} />
                        </div>
                      ) : (
                        <ThinkingIndicator stageLabel="Stage 2 Peer Review" personaName={persona.name} role="Peer Reviewer"
                          model={persona.model || settings.defaultModels[persona.id]} accentColor="purple" />
                      )}
                    </div>
                  );
                })}
              </SwipeDeck>
            </div>
          )}

          {/* Stage 3: Synthesis — single source */}
          {hasSynthesis && (
            <>
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
              {isSynthesisFinished && (
                <RoundRatingCard
                  roundId={round.id}
                  currentRating={round.rating}
                  onSaveRating={onSaveRating}
                />
              )}
            </>
          )}
        </>
      )}
    </article>
  );
});

// Helper sub-component for the round header
function RoundHeader({ round, index, isCollapsed, onToggleCollapse, onCopy, copiedId, onReRunRound, onEditPrompt, onResumeRound, onDeleteRound, incompleteStage, isDeliberating }: any) {
  const [showFileDetails, setShowFileDetails] = React.useState(false);
  const [showArchivistMemory, setShowArchivistMemory] = React.useState(false);
  const [copiedMemory, setCopiedMemory] = React.useState(false);

  const { cleanPrompt, fileSummaries, rawContent } = React.useMemo(() => {
    let clean = round.userQuery || '';
    const summaries: { name: string; summary: string }[] = [];
    let fullRaw = '';

    if (round.attachedTextFiles && round.attachedTextFiles.length > 0) {
      round.attachedTextFiles.forEach((f: any) => {
        summaries.push({
          name: f.name,
          summary: f.summary || `${Math.round((f.size || 0) / 1024)} KB`,
        });
        fullRaw += `--- ${f.name} ---\n${f.content}\n\n`;
      });
    }

    if (clean.includes('--- Attached File:')) {
      fullRaw += clean;
      const parts = clean.split('User Question:\n');
      if (parts.length > 1) {
        clean = parts.slice(1).join('User Question:\n').trim();
      } else {
        clean = 'Review attached file context';
      }

      if (summaries.length === 0) {
        const matches = round.userQuery.match(/--- Attached File: (.*?) ---/g);
        if (matches) {
          matches.forEach((m: string) => {
            const fname = m.replace('--- Attached File: ', '').replace(' ---', '').trim();
            summaries.push({ name: fname, summary: 'Attached File' });
          });
        }
      }
    }

    if (!clean) {
      clean = summaries.length > 0 ? `Analyze attached file context (${summaries.map(s => s.name).join(', ')})` : 'Untitled Query';
    }

    return { cleanPrompt: clean, fileSummaries: summaries, rawContent: fullRaw };
  }, [round.userQuery, round.attachedTextFiles]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
      aria-controls={`round-content-${round.id}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleCollapse(round.id);
        }
      }}
      className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-col gap-3 cursor-pointer select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-cyan-400"
      onClick={() => onToggleCollapse(round.id)}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 shrink-0">Round #{index + 1}</span>

          {/* Context Mode Distinction Badge */}
          {round.isIsolatedRound ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 shrink-0">
              🆕 Fresh Topic (Isolated)
            </span>
          ) : index > 0 ? (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800 shrink-0">
              💬 Follow-up
            </span>
          ) : null}

          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase shrink-0 ${
            round.resolvedMode === 'quick_panel'
              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
              : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800'
          }`}>
            {round.resolvedMode === 'quick_panel' ? '⚡ Quick Panel' : '🏛️ Deep Council'}
          </span>

          {/* Star Rating Badge if Rated */}
          {round.rating?.score && (
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 inline-flex items-center gap-1 shrink-0">
              <Star size={10} className="fill-amber-400 text-amber-400" aria-hidden="true" />
              <span>{round.rating.score}/5</span>
            </span>
          )}

          {(index > 0 || !!round.archivistSummary) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowArchivistMemory((prev) => !prev);
              }}
              aria-expanded={showArchivistMemory}
              className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer shrink-0 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-indigo-400 ${
                showArchivistMemory
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                  : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border-indigo-200 dark:border-indigo-800/60'
              }`}
              title={showArchivistMemory ? 'Hide historical context memory summary' : 'View historical context memory summary'}
            >
              <Globe size={10} className="shrink-0" aria-hidden="true" />
              <span>Archivist Memory</span>
              {showArchivistMemory ? <ChevronUp size={10} aria-hidden="true" /> : <ChevronDown size={10} aria-hidden="true" />}
            </button>
          )}
        </div>
        <span className="text-[11px] text-slate-500 font-mono shrink-0">
          {new Date(round.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <h2 id={`round-heading-${round.id}`} className={`text-sm font-semibold text-slate-800 dark:text-slate-100 ${textWrap}`}>{cleanPrompt}</h2>

      {/* Collapsible Archivist Memory Summary Drawer */}
      {showArchivistMemory && (
        <div
          className="p-3 bg-slate-900/95 dark:bg-slate-950 rounded-xl border border-indigo-500/30 text-xs font-mono text-slate-300 space-y-2 select-text shadow-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-indigo-500/20 pb-1.5 flex-wrap gap-1">
            <div className="flex items-center gap-1.5 text-indigo-300 font-semibold text-[11px]">
              <BookOpen size={13} className="text-indigo-400 shrink-0" />
              <span>Archivist Memory Context</span>
              <span className="text-[10px] font-normal text-slate-400">
                (Historical rounds 1–{Math.max(1, index)})
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const textToCopy =
                  round.archivistSummary ||
                  `Archivist Context: Deliberation incorporates memory summary of prior council rounds (Rounds 1–${index}).`;
                navigator.clipboard.writeText(textToCopy);
                setCopiedMemory(true);
                setTimeout(() => setCopiedMemory(false), 2000);
              }}
              className="text-slate-400 hover:text-indigo-200 flex items-center gap-1 text-[10px] transition-colors cursor-pointer"
            >
              {copiedMemory ? (
                <>
                  <Check size={10} className="text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={10} />
                  <span>Copy Memory</span>
                </>
              )}
            </button>
          </div>
          <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
            {round.archivistSummary ? (
              round.archivistSummary
            ) : (
              <span className="text-slate-400 italic">
                Hierarchical context from previous rounds (1 to {index}) was summarized and incorporated by the Council Archivist into this round's deliberations.
              </span>
            )}
          </div>
        </div>
      )}

      {/* File Attachment Badges */}
      {fileSummaries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {fileSummaries.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-cyan-950/70 text-cyan-200 border border-cyan-800/60 px-2.5 py-1 rounded-md shadow-xs">
              <span>{f.name.endsWith('.zip') ? '📦' : f.name.endsWith('.pdf') ? '📄' : '📝'}</span>
              <span className="font-semibold">{f.name}</span>
              <span className="text-[10px] text-cyan-400/80">({f.summary})</span>
            </span>
          ))}
          {rawContent && (
            <button
              type="button"
              onClick={() => setShowFileDetails(!showFileDetails)}
              className="text-[11px] font-mono text-cyan-400 hover:text-cyan-200 underline decoration-cyan-500/40 cursor-pointer ml-1"
            >
              {showFileDetails ? 'Hide details' : 'View file content'}
            </button>
          )}
        </div>
      )}

      {/* Collapsible File Content Drawer */}
      {showFileDetails && rawContent && (
        <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-300 max-h-60 overflow-y-auto space-y-2 select-text" onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider flex items-center justify-between border-b border-slate-800 pb-1">
            <span>Attached File Context</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(rawContent);
              }}
              className="text-slate-400 hover:text-cyan-300 flex items-center gap-1 text-[10px]"
            >
              <Copy size={10} /> Copy Context
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">
            {rawContent.slice(0, 5000)}
            {rawContent.length > 5000 && `\n\n... [Showing first 5,000 chars of ${rawContent.length.toLocaleString()} total chars]` }
          </pre>
        </div>
      )}

      {round.attachedImages && round.attachedImages.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {round.attachedImages.map((img: any, i: number) => (
            <span key={i} className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded text-slate-600 dark:text-slate-300 font-mono">
              📎 {img.name}
            </span>
          ))}
        </div>
      )}

      {!isCollapsed && (
        <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-200/50 dark:border-slate-700/50"
          onClick={(e) => e.stopPropagation()}>
          {onCopy && (
            <button onClick={() => onCopy(`prompt-${round.id}`, cleanPrompt)}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 transition-colors">
              {copiedId === `prompt-${round.id}` ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
              <span>Copy</span>
            </button>
          )}
          {incompleteStage?.isIncomplete && onResumeRound && (
            <button onClick={() => onResumeRound(round.id)} disabled={isDeliberating}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-200 bg-amber-950/90 hover:bg-amber-900/90 px-2 py-0.5 rounded border border-amber-600/80 transition-colors disabled:opacity-50">
              <RefreshCw size={10} className={isDeliberating ? 'animate-spin' : ''} />
              <span>Resume {incompleteStage.description}</span>
            </button>
          )}
          {onReRunRound && (
            <button onClick={() => onReRunRound(round.id)} disabled={isDeliberating}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 transition-colors disabled:opacity-50">
              <RefreshCw size={10} />
              <span>Re-run</span>
            </button>
          )}
          {onEditPrompt && (
            <button onClick={() => onEditPrompt(round.id)} disabled={isDeliberating}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 transition-colors disabled:opacity-50">
              <span>Edit</span>
            </button>
          )}
          {onDeleteRound && (
            <button onClick={() => { if (confirm('Delete this round?')) onDeleteRound(round.id); }} disabled={isDeliberating}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-900/60 px-2 py-0.5 rounded border border-red-800/50 transition-colors disabled:opacity-50">
              <Trash2 size={10} />
              <span>Delete</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
