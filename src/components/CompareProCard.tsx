import React, { useState } from 'react';
import { Award, CheckCircle2, Clock, Coins, Sparkles, HelpCircle, Eye, RefreshCw } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown';
import { updateAuditLogVote } from '../lib/auditLogger';

interface CompareProCardProps {
  auditLogId: string;
  userQuery: string;
  proModelId: string;
  councilContent: string;
  proContent: string;
  councilLatencyMs: number;
  proLatencyMs: number;
  councilCost: number;
  proCost: number;
  answerAIsCouncil: boolean; // Random assignment
  onVoteSubmitted?: (vote: 'answer_a' | 'answer_b' | 'tie') => void;
  className?: string;
}

export function CompareProCard({
  auditLogId,
  userQuery,
  proModelId,
  councilContent,
  proContent,
  councilLatencyMs,
  proLatencyMs,
  councilCost,
  proCost,
  answerAIsCouncil,
  onVoteSubmitted,
  className = '',
}: CompareProCardProps) {
  const [vote, setVote] = useState<'answer_a' | 'answer_b' | 'tie' | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Content A & B assignment based on answerAIsCouncil
  const contentA = answerAIsCouncil ? councilContent : proContent;
  const contentB = answerAIsCouncil ? proContent : councilContent;

  const handleVote = (selectedVote: 'answer_a' | 'answer_b' | 'tie') => {
    setVote(selectedVote);
    setRevealed(true);
    updateAuditLogVote(auditLogId, selectedVote);
    if (onVoteSubmitted) {
      onVoteSubmitted(selectedVote);
    }
  };

  const getWinnerLabel = () => {
    if (!vote || !revealed) return null;
    if (vote === 'tie') return 'Result: It was a Tie!';
    const userSelectedCouncil = (vote === 'answer_a' && answerAIsCouncil) || (vote === 'answer_b' && !answerAIsCouncil);
    if (userSelectedCouncil) {
      return '🎉 You preferred the AI Council Consensus!';
    } else {
      return '⭐ You preferred the Single Pro Model!';
    }
  };

  return (
    <div className={`bg-slate-900 border border-indigo-500/40 rounded-2xl p-5 shadow-xl space-y-4 font-sans ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
              Blind Pro Comparison (Phase 2)
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-mono">
                Blind Side-by-Side
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Compare the Council Consensus against a single premier model ({proModelId}) without bias.
            </p>
          </div>
        </div>

        {revealed && (
          <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
            {getWinnerLabel()}
          </div>
        )}
      </div>

      {/* Side-by-Side Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Answer A */}
        <div className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all ${
          revealed
            ? answerAIsCouncil
              ? 'bg-indigo-950/30 border-indigo-500/50'
              : 'bg-purple-950/30 border-purple-500/50'
            : 'bg-slate-950/80 border-slate-800'
        }`}>
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <span className="font-bold text-indigo-300 text-sm flex items-center gap-1.5">
                <HelpCircle size={15} />
                <span>Answer A</span>
              </span>

              {revealed && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono ${
                  answerAIsCouncil
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                }`}>
                  {answerAIsCouncil ? 'AI Council' : `Single Pro (${proModelId.split('/')[1] || proModelId})`}
                </span>
              )}
            </div>

            <div className="text-xs text-slate-200 leading-relaxed max-h-80 overflow-y-auto pr-1">
              <div className="markdown-body">
                <MessageMarkdown content={contentA} />
              </div>
            </div>
          </div>

          {/* Reveal stats if revealed */}
          {revealed && (
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
              <div>
                <span>Latency: </span>
                <span className="text-cyan-300 font-bold">
                  {answerAIsCouncil ? councilLatencyMs : proLatencyMs} ms
                </span>
              </div>
              <div>
                <span>Est Cost: </span>
                <span className="text-amber-300 font-bold">
                  ${(answerAIsCouncil ? councilCost : proCost).toFixed(5)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Answer B */}
        <div className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all ${
          revealed
            ? !answerAIsCouncil
              ? 'bg-indigo-950/30 border-indigo-500/50'
              : 'bg-purple-950/30 border-purple-500/50'
            : 'bg-slate-950/80 border-slate-800'
        }`}>
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <span className="font-bold text-purple-300 text-sm flex items-center gap-1.5">
                <HelpCircle size={15} />
                <span>Answer B</span>
              </span>

              {revealed && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono ${
                  !answerAIsCouncil
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                }`}>
                  {!answerAIsCouncil ? 'AI Council' : `Single Pro (${proModelId.split('/')[1] || proModelId})`}
                </span>
              )}
            </div>

            <div className="text-xs text-slate-200 leading-relaxed max-h-80 overflow-y-auto pr-1">
              <div className="markdown-body">
                <MessageMarkdown content={contentB} />
              </div>
            </div>
          </div>

          {/* Reveal stats if revealed */}
          {revealed && (
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
              <div>
                <span>Latency: </span>
                <span className="text-cyan-300 font-bold">
                  {!answerAIsCouncil ? councilLatencyMs : proLatencyMs} ms
                </span>
              </div>
              <div>
                <span>Est Cost: </span>
                <span className="text-amber-300 font-bold">
                  ${(!answerAIsCouncil ? councilCost : proCost).toFixed(5)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Voting Bar */}
      {!revealed ? (
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-300 font-medium">
            Which answer provided higher quality, accuracy, and depth?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleVote('answer_a')}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              Answer A is Better
            </button>
            <button
              type="button"
              onClick={() => handleVote('answer_b')}
              className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              Answer B is Better
            </button>
            <button
              type="button"
              onClick={() => handleVote('tie')}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              Equal / Tie
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-center justify-between">
          <span>Vote Recorded! The blind model identities and execution stats are revealed above.</span>
          <button
            type="button"
            onClick={() => setRevealed(false)}
            className="text-indigo-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
          >
            <Eye size={12} /> Hide Reveal
          </button>
        </div>
      )}
    </div>
  );
}
