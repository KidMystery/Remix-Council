import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  Volume2,
  VolumeX,
  RefreshCw,
  Layers,
  ShieldCheck,
  Users,
  CheckCircle2,
  Info
} from 'lucide-react';
import { CouncilRound, Persona, PersonaResponse } from '../types';
import { MessageMarkdown } from './MessageMarkdown';

interface SynthesizeConsensusPanelProps {
  round: CouncilRound;
  personas: Persona[];
  synthesizer?: Persona;
  isDeliberating?: boolean;
  onSynthesizeConsensus?: (roundId: string) => void;
  speak?: (text: string, id: string) => void;
  speakingId?: string | null;
  copiedId?: string | null;
  handleCopy?: (id: string, text: string) => void;
  basicMode?: boolean;
  className?: string;
}

/**
 * Helper to extract or condense text into a clean single paragraph
 */
export function formatSingleParagraphTakeaway(text: string): string {
  if (!text) return '';
  
  // Split into raw double-line-break paragraphs
  const rawParagraphs = text.split(/\n\s*\n/);
  
  // Find the first paragraph that contains substantial content (not just a short heading)
  for (const p of rawParagraphs) {
    const cleaned = p
      .replace(/^#+\s+/gm, '') // Remove headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold markers for smooth text flow
      .replace(/^\s*[-*•]\s+/gm, '') // Remove bullet points
      .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered lists
      .replace(/\n/g, ' ') // Replace line breaks with spaces
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim();
      
    if (cleaned.length > 30 && !cleaned.toLowerCase().startsWith('you are') && !cleaned.toLowerCase().startsWith('task:')) {
      return cleaned;
    }
  }

  // Fallback to cleaning the whole string into a single paragraph
  return text
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function SynthesizeConsensusPanel({
  round,
  personas,
  synthesizer,
  isDeliberating = false,
  onSynthesizeConsensus,
  speak,
  speakingId,
  copiedId,
  handleCopy,
  basicMode = false,
  className = '',
}: SynthesizeConsensusPanelProps) {
  // Collect final responses from all active personas
  const activePersonas = personas.filter((p) => p.enabled !== false);
  
  const personaFinalResponses: { persona: Persona; responseText: string }[] = [];
  
  activePersonas.forEach((p) => {
    const stage2Resp = round.deliberation?.stage2?.[p.id];
    if (stage2Resp?.status === 'completed' && stage2Resp.content?.trim()) {
      personaFinalResponses.push({ persona: p, responseText: stage2Resp.content });
      return;
    }
    const stage1Resp = round.deliberation?.stage1?.[p.id];
    if (stage1Resp?.status === 'completed' && stage1Resp.content?.trim()) {
      personaFinalResponses.push({ persona: p, responseText: stage1Resp.content });
    }
  });

  const hasPersonaResponses = personaFinalResponses.length > 0;
  const isStreaming = round.synthesis?.status === 'streaming';
  const rawSynthesisContent = round.synthesis?.content || '';
  const singleParagraphText = formatSingleParagraphTakeaway(rawSynthesisContent);

  const panelId = `${round.id}-consensus-summary`;
  const isSpeaking = speakingId === panelId;
  const isCopied = copiedId === panelId;

  return (
    <div
      className={`rounded-2xl border border-amber-300 dark:border-amber-500/30 bg-white dark:bg-slate-900 p-5 shadow-lg space-y-4 text-slate-800 dark:text-slate-100 ${className}`}
    >
      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/20 pb-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-tight text-amber-200">
                Synthesize Consensus
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
                Single-Paragraph Takeaways
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>Synthesizing perspectives from {personaFinalResponses.length} of {activePersonas.length} council members</span>
            </p>
          </div>
        </div>

        {/* Participating Persona Badges */}
        <div className="flex items-center gap-1.5">
          <div className="flex -space-x-1.5 overflow-hidden">
            {personaFinalResponses.map(({ persona }) => (
              <span
                key={persona.id}
                className="inline-flex items-center justify-center w-6 h-6 rounded-full ring-2 ring-slate-900 text-[10px] font-bold text-white bg-slate-800 border border-slate-700 shadow-xs"
                title={`${persona.name} (${persona.role})`}
              >
                {persona.avatar || persona.name.charAt(0)}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-slate-400 font-mono ml-1 hidden sm:inline">
            {personaFinalResponses.length} personas
          </span>
        </div>
      </div>

      {/* Body Content */}
      <div className="space-y-3">
        {isStreaming ? (
          <div className="flex items-center gap-3 py-4 px-4 rounded-xl bg-amber-950/30 border border-amber-500/20 text-amber-300 text-xs font-mono animate-pulse">
            <RefreshCw size={16} className="animate-spin shrink-0 text-amber-400" />
            <span>Synthesizing key takeaways across all persona outputs...</span>
          </div>
        ) : round.synthesis?.status === 'error' ? (
          <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/40 text-xs text-red-300 flex items-center justify-between gap-3">
            <span>⚠️ {round.synthesis.error || 'Failed to synthesize consensus takeaways.'}</span>
            {onSynthesizeConsensus && (
              <button
                type="button"
                disabled={isDeliberating}
                onClick={() => onSynthesizeConsensus(round.id)}
                className="px-3 py-1 rounded-lg bg-red-900 hover:bg-red-800 text-red-100 font-medium shrink-0 transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        ) : singleParagraphText ? (
          <div className="relative group">
            {/* Key Takeaways Single Paragraph Block */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-amber-500/20 text-slate-200 text-sm leading-relaxed font-sans shadow-inner selection:bg-amber-500/20">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-slate-100 font-normal">
                  {singleParagraphText}
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Empty / Pending State */
          <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 text-center space-y-3">
            <p className="text-xs text-slate-400">
              {hasPersonaResponses
                ? 'Final persona responses are ready. Click below to generate a single-paragraph consensus takeaway.'
                : 'Awaiting persona responses to synthesize consensus takeaways.'}
            </p>
            {hasPersonaResponses && onSynthesizeConsensus && (
              <button
                type="button"
                disabled={isDeliberating}
                onClick={() => onSynthesizeConsensus(round.id)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-cyan-600 hover:from-amber-500 hover:to-cyan-500 text-white font-semibold text-xs transition-all shadow-md hover:shadow-amber-500/20 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles size={14} />
                <span>Synthesize Consensus Now</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer Controls & Metadata */}
      {singleParagraphText && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-500/10 text-xs">
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
            <span>Unified Verdict from {personaFinalResponses.length} Personas</span>
          </div>

          <div className="flex items-center space-x-2">
            {/* Read Aloud Button */}
            {speak && (
              <button
                type="button"
                onClick={() => speak(singleParagraphText, panelId)}
                className={`p-1.5 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  isSpeaking
                    ? 'bg-amber-950/80 border-amber-500 text-amber-300 animate-pulse'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                }`}
                title={isSpeaking ? 'Stop speech' : 'Listen to key takeaways'}
              >
                {isSpeaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
                <span>{isSpeaking ? 'Stop' : 'Listen'}</span>
              </button>
            )}

            {/* Copy Button */}
            {handleCopy && (
              <button
                type="button"
                onClick={() => handleCopy(panelId, singleParagraphText)}
                className="p-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                title="Copy single-paragraph key takeaways"
              >
                {isCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{isCopied ? 'Copied' : 'Copy Takeaways'}</span>
              </button>
            )}

            {/* Re-synthesize Button */}
            {onSynthesizeConsensus && !isDeliberating && (
              <button
                type="button"
                onClick={() => onSynthesizeConsensus(round.id)}
                className="p-1.5 px-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                title="Re-generate single-paragraph consensus"
              >
                <RefreshCw size={13} />
                <span>Re-synthesize</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
