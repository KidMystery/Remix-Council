import React, { useState, useRef, useEffect } from 'react';
import {
  RefreshCw,
  Play,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Users,
  GitBranch,
  Volume2,
  VolumeX,
  Copy,
  Check,
  RotateCw,
  AlertTriangle,
  Trash2,
  Loader2,
} from 'lucide-react';
import type { CouncilRound, Persona } from '../types';
import { useSpeech } from '../hooks/useSpeech';
import { copyToClipboard } from '../lib/clipboard';
import { countRoundCost, formatCost } from '../lib/archivist';
import { MessageMarkdown } from './MessageMarkdown';
import { SynthesisCard } from './SynthesisCard';
import { ConfirmButton } from './ConfirmButton';

export interface CouncilRoundViewProps {
  round: CouncilRound;
  personas: Persona[];
  synthesizer: Persona;
  basicMode?: boolean;
  incompleteStage?: { isIncomplete: boolean; description: string };
  onResumeRound?: (roundId: string) => void;
  onReRunRound?: (roundId: string) => void;
  onReSynthesize?: (round: CouncilRound, personas: Persona[]) => void;
  onRegeneratePersona?: (personaId: string, roundId: string) => void;
  onForkBranch?: (branchName: string) => void;
  onDeleteRound?: (roundId: string) => void;
  isDeliberating?: boolean;
  showConsensusVisualizer?: boolean;
}

interface CardHeaderProps {
  persona: Persona;
  status?: string;
  preview?: string;
  content?: string;
  isExpanded: boolean;
  canCollapse: boolean;
  onToggle: () => void;
  onCopy: (id: string, text: string) => void;
  onSpeak: (text: string, id: string) => void;
  onRegenerate?: () => void;
  copiedId: string | null;
  speakingId: string | null;
  loadingId?: string | null;
  isDeliberating: boolean;
}

const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  if (status === 'streaming') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-300 bg-cyan-950/80 border border-cyan-700/50 px-2 py-0.5 rounded-full">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
        Streaming
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-red-300 bg-red-950/80 border border-red-700/50 px-2 py-0.5 rounded-full">
        <AlertTriangle size={10} />
        Error
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-300 bg-emerald-950/80 border border-emerald-700/50 px-2 py-0.5 rounded-full">
        <Check size={10} />
        Complete
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 bg-slate-800/80 border border-slate-700/50 px-2 py-0.5 rounded-full">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
      Pending
    </span>
  );
};

const PersonaCardHeader: React.FC<CardHeaderProps> = ({
  persona,
  status,
  preview,
  content,
  isExpanded,
  canCollapse,
  onToggle,
  onCopy,
  onSpeak,
  onRegenerate,
  copiedId,
  speakingId,
  loadingId,
  isDeliberating,
}) => {
  const copyId = `copy-${persona.id}`;
  const speakId = `speak-${persona.id}`;
  const isSpeaking = speakingId === speakId;
  const isLoadingAudio = loadingId === speakId;
  const isCopied = copiedId === copyId;

  return (
    <div className="flex items-center gap-2.5 w-full min-w-0">
      {/* Clickable toggle area (avatar, identity, status, chevron, preview) */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (canCollapse) onToggle(); }}
        disabled={!canCollapse}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default"
        title={!canCollapse ? 'Locked open while streaming' : isExpanded ? 'Collapse' : 'Expand'}
        aria-expanded={isExpanded}
      >
        {/* Avatar */}
        <span className="text-lg shrink-0" aria-hidden="true">{persona.avatar}</span>

        {/* Name + Role + Model */}
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-100 text-xs truncate max-w-[150px]" title={persona.name}>
              {persona.name}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider border hidden sm:inline ${persona.color}`}>
              {persona.role}
            </span>
          </span>
          <span className="text-[10px] text-cyan-400/80 font-mono truncate max-w-[180px] block" title={persona.model}>
            {persona.model.split('/').pop()}
          </span>
        </span>

        {/* Status Badge */}
        <StatusBadge status={status} />

        {/* Muted one-line preview when collapsed */}
        {!isExpanded && preview && (
          <span className="hidden lg:block text-[10px] text-slate-500 italic truncate max-w-[220px] pl-1 border-l border-slate-800">
            {preview}
          </span>
        )}

        {/* Expand / Collapse Chevron */}
        <span className={`shrink-0 ${isExpanded ? 'text-slate-300' : 'text-slate-500'}`}>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Action buttons (always visible, never nested inside the toggle) */}
      <div className="flex items-center gap-0.5 shrink-0">
        {onRegenerate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
            disabled={isDeliberating}
            className="p-1.5 rounded-md text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
            title="Regenerate this panelist's proposal"
          >
            <RotateCw size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSpeak(content || '', speakId); }}
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            isSpeaking
              ? 'text-cyan-300 bg-cyan-950 animate-pulse'
              : isLoadingAudio
              ? 'text-amber-400 bg-amber-950/50'
              : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800'
          }`}
          title={isSpeaking ? 'Stop reading' : isLoadingAudio ? 'Generating neural audio...' : 'Read aloud (Google AI Voice)'}
        >
          {isLoadingAudio ? <Loader2 size={13} className="animate-spin text-amber-400" /> : isSpeaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCopy(copyId, content || ''); }}
          className="p-1.5 rounded-md text-slate-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors cursor-pointer"
          title="Copy response"
        >
          {isCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
};

export const CouncilRoundView: React.FC<CouncilRoundViewProps> = ({
  round,
  personas,
  synthesizer,
  basicMode = false,
  incompleteStage,
  onResumeRound,
  onReRunRound,
  onReSynthesize,
  onRegeneratePersona,
  onForkBranch,
  onDeleteRound,
  isDeliberating = false,
  showConsensusVisualizer = false,
}) => {
  const activePersonas = personas.filter((p) => p.enabled !== false);
  const stage1 = round.deliberation?.stage1 || {};
  const stage2 = round.deliberation?.stage2 || {};
  const stage3 = round.deliberation?.stage3 || round.synthesis;

  const { speak, stop, speakingId, loadingId } = useSpeech();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [forkBranchName, setForkBranchName] = useState('');
  const [stage1Expanded, setStage1Expanded] = useState(true);
  const [stage2Expanded, setStage2Expanded] = useState(true);

  // Per-card collapse state (Stage 1 & Stage 2).
  const [expandedPersonas, setExpandedPersonas] = useState<Set<string>>(new Set());

  const togglePersona = (id: string) => {
    setExpandedPersonas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Auto-collapse a card when its streaming completes.
  const prevStatusesRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const collect = (record: Record<string, any>): Record<string, string> => {
      const out: Record<string, string> = {};
      activePersonas.forEach((p) => {
        out[p.id] = record[p.id]?.status || 'pending';
      });
      return out;
    };

    const current: Record<string, string> = {
      ...collect(stage1),
      ...collect(stage2),
    };

    const prev = prevStatusesRef.current;
    const toCollapse: string[] = [];
    Object.keys(current).forEach((id) => {
      if (prev[id] === 'streaming' && current[id] === 'completed') {
        toCollapse.push(id);
      }
    });

    if (toCollapse.length > 0) {
      setExpandedPersonas((prevSet) => {
        const next = new Set(prevSet);
        toCollapse.forEach((id) => next.delete(id));
        return next;
      });
    }

    prevStatusesRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage1, stage2]);

  const hasStage2 =
    Object.keys(stage2).length > 0 &&
    Object.values(stage2).some((r: any) => r?.content || r?.status === 'streaming');

  const stage1Completed = activePersonas.filter((p) => stage1[p.id]?.status === 'completed').length;
  const stage2Completed = activePersonas.filter((p) => stage2[p.id]?.status === 'completed').length;
  const roundCost = countRoundCost(round).totalCost;

  const handleCopy = (id: string, text: string) => {
    copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSpeak = (text: string, id: string) => {
    if (!text) {
      stop();
      return;
    }
    speak(text, id);
  };

  const handleCreateFork = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forkBranchName.trim() || !onForkBranch) return;
    onForkBranch(forkBranchName.trim());
    setIsForking(false);
    setForkBranchName('');
  };

  const renderPersonaCard = (p: Persona, response: any, stageKey: 'stage1' | 'stage2') => {
    const isStreaming = response?.status === 'streaming';
    const isCompleted = response?.status === 'completed';
    const isError = response?.status === 'error';
    const isExpanded = isStreaming || expandedPersonas.has(p.id);
    const canCollapse = !isStreaming;

    const content = response?.content || '';
    const preview = content.length > 120 ? `${content.slice(0, 120)}…` : content;

    const cardKey = `${stageKey}-${p.id}`;

    return (
      <div
        key={p.id}
        className={`p-3.5 bg-slate-900/90 border rounded-xl text-xs flex flex-col transition-colors ${
          isError
            ? 'border-red-700/50'
            : isStreaming
            ? 'border-cyan-600/50 shadow-lg shadow-cyan-950/30'
            : 'border-slate-800/90 hover:border-slate-700'
        }`}
      >
        {/* Card header — clickable to expand/collapse (locked open while streaming) */}
        <PersonaCardHeader
          persona={p}
          status={response?.status}
          preview={preview}
          content={content}
          isExpanded={isExpanded}
          canCollapse={canCollapse}
          onToggle={() => togglePersona(p.id)}
          onCopy={(id) => handleCopy(id, content)}
          onSpeak={(text, id) => handleSpeak(text, id)}
          onRegenerate={
            onRegeneratePersona && stageKey === 'stage1'
              ? () => onRegeneratePersona(p.id, round.id)
              : undefined
          }
          copiedId={copiedId}
          speakingId={speakingId}
          loadingId={loadingId}
          isDeliberating={isDeliberating}
        />

        {/* Expanded body */}
        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-slate-800/80 min-w-0">
            {content ? (
              <MessageMarkdown content={content} />
            ) : (
              <div className="flex items-center gap-2 text-slate-500 italic py-3">
                <span className="flex h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                <span>{stageKey === 'stage1' ? 'Awaiting analysis...' : 'Synthesizing peer critique...'}</span>
              </div>
            )}
            {isError && response?.error && (
              <div className="mt-2 text-[10px] font-mono text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg p-2 break-words">
                {response.error}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <article className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-2xl backdrop-blur-sm transition-all mb-6">
      {/* Sticky Round Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-800/80 sticky top-12 bg-slate-900/95 py-2 z-20 backdrop-blur">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2">
            {round.parentRoundId ? (
              <GitBranch size={15} className="text-purple-400 shrink-0" />
            ) : (
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 shrink-0" />
            )}
            <h3 className="text-sm sm:text-base font-semibold text-slate-100 line-clamp-1">
              {round.userQuery}
            </h3>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 mt-1 flex-wrap">
            <span>
              {new Date(round.timestamp || round.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span>•</span>
            <span className="text-cyan-400 font-sans">{activePersonas.length} Panelists</span>
            <span>•</span>
            <span className="text-emerald-400 font-sans" title="Estimated round cost">{formatCost(roundCost)}</span>
            {round.branchName && (
              <>
                <span>•</span>
                <span className="text-purple-300 font-sans bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800">
                  Branch: {round.branchName}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {incompleteStage?.isIncomplete && onResumeRound ? (
            <button
              onClick={() => onResumeRound(round.id)}
              disabled={isDeliberating}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-200 bg-amber-950/90 hover:bg-amber-900 px-3 py-1.5 rounded-lg border border-amber-600/80 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              title="Resume incomplete stage"
            >
              <RefreshCw size={12} className={isDeliberating ? 'animate-spin' : ''} />
              <span>Resume {incompleteStage.description}</span>
            </button>
          ) : (
            <>
              {onForkBranch && (
                <button
                  onClick={() => setIsForking(!isForking)}
                  disabled={isDeliberating}
                  className="inline-flex items-center gap-1 text-xs font-mono text-purple-300 bg-purple-950/70 hover:bg-purple-900 px-2.5 py-1.5 rounded-lg border border-purple-700/60 transition-colors disabled:opacity-50 cursor-pointer"
                  title="Fork into Sub-Council Branch"
                >
                  <GitBranch size={12} />
                  <span className="hidden sm:inline">Fork Branch</span>
                </button>
              )}
              {onReRunRound && (
                <button
                  onClick={() => onReRunRound(round.id)}
                  disabled={isDeliberating}
                  className="inline-flex items-center gap-1 text-xs font-mono text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                  title="Re-run deliberation"
                >
                  <RefreshCw size={11} />
                  <span>Re-run</span>
                </button>
              )}
              {onDeleteRound && (
                <ConfirmButton
                  onConfirm={() => onDeleteRound(round.id)}
                  disabled={isDeliberating}
                  className="inline-flex items-center gap-1 text-xs font-mono text-slate-400 hover:text-red-300 bg-slate-800 hover:bg-slate-700 p-1.5 rounded-lg border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                  title="Delete round"
                  confirmPrompt={<Trash2 size={12} />}
                  idleChildren={<Trash2 size={12} />}
                />
              )}
            </>
          )}
        </div>
      </header>

      {/* Sub-Council Fork Prompt Popup */}
      {isForking && (
        <form onSubmit={handleCreateFork} className="mb-4 p-3 bg-purple-950/40 border border-purple-700/60 rounded-xl flex items-center gap-2">
          <input
            type="text"
            value={forkBranchName}
            onChange={(e) => setForkBranchName(e.target.value)}
            placeholder="Branch Name (e.g., Strict Zero-Trust Counter-Thesis)..."
            className="flex-1 bg-slate-950 text-slate-100 text-xs px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-purple-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={!forkBranchName.trim()}
            className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            Launch Branch
          </button>
          <button
            type="button"
            onClick={() => setIsForking(false)}
            className="px-2.5 py-2 text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Consensus View (Basic Mode) */}
      {basicMode ? (
        <div className="space-y-4">
          {stage3?.content ? (
            <section className="p-5 bg-slate-950/80 border border-cyan-500/40 rounded-xl shadow-inner">
              <div className="flex items-center gap-2 mb-3 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                <Play size={13} />
                <span>Executive Synthesis & Consensus</span>
              </div>
              <MessageMarkdown content={stage3.content} />
            </section>
          ) : (
            <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl text-xs font-mono text-slate-400 flex items-center justify-between">
              <span>Deliberating: Stage 1 ({stage1Completed}/{activePersonas.length}) · Stage 2 ({stage2Completed}/{activePersonas.length})</span>
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
            </div>
          )}
        </div>
      ) : (
        /* Full Stackable Debate View */
        <div className="space-y-5">
          {/* Stage 1: Collapsible Independent Proposals */}
          <section className="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950/40">
            <button
              type="button"
              onClick={() => setStage1Expanded(!stage1Expanded)}
              className="w-full flex items-center justify-between p-3.5 bg-slate-950/70 hover:bg-slate-950 text-slate-300 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Users size={14} className="text-cyan-400" />
                <span>Stage 1: Proposals ({stage1Completed}/{activePersonas.length})</span>
              </div>
              {stage1Expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {stage1Expanded && (
              <div className="p-4 pt-2 grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {activePersonas.map((p) => renderPersonaCard(p, stage1[p.id], 'stage1'))}
              </div>
            )}
          </section>

          {/* Stage 2: Collapsible Peer Review */}
          {hasStage2 && (
            <section className="border border-slate-800/80 rounded-xl overflow-hidden bg-slate-950/40">
              <button
                type="button"
                onClick={() => setStage2Expanded(!stage2Expanded)}
                className="w-full flex items-center justify-between p-3.5 bg-slate-950/70 hover:bg-slate-950 text-slate-300 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-purple-400" />
                  <span>Stage 2: Peer Review & Critique ({stage2Completed}/{activePersonas.length})</span>
                </div>
                {stage2Expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {stage2Expanded && (
                <div className="p-4 pt-2 grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {activePersonas.map((p) => renderPersonaCard(p, stage2[p.id], 'stage2'))}
                </div>
              )}
            </section>
          )}

          {/* Stage 3: Authoritative Synthesis Card (always expanded, cannot collapse) */}
          {(stage3?.content || stage3?.status === 'streaming' || stage3?.status === 'error') && (
            <SynthesisCard
              round={round}
              synthesizer={synthesizer}
              isDeliberating={isDeliberating}
              speakingId={speakingId}
              loadingId={loadingId}
              copiedId={copiedId}
              onSpeak={handleSpeak}
              onCopy={handleCopy}
              onResynthesize={(roundId) => {
                if (onReSynthesize) onReSynthesize(round, activePersonas);
              }}
              showConsensusVisualizer={showConsensusVisualizer}
            />
          )}
        </div>
      )}
    </article>
  );
};
