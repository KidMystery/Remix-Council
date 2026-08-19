/* Round Feedback & Quality Rating System */
import React, { useState } from 'react';
import { Star, MessageSquare, Check, Sparkles, X, Tag } from 'lucide-react';
import { RoundRating } from '../types';

interface RoundRatingCardProps {
  roundId: string;
  currentRating?: RoundRating;
  onSaveRating?: (roundId: string, rating: RoundRating) => void;
  readOnly?: boolean;
}

const RATING_TAGS = [
  { label: '🎯 Accurate', value: 'accurate' },
  { label: '💡 Insightful', value: 'insightful' },
  { label: '⚡ Actionable', value: 'actionable' },
  { label: '⚖️ Well-Balanced', value: 'balanced' },
  { label: '🔬 Thorough', value: 'thorough' },
  { label: '📝 Too Verbose', value: 'verbose' },
  { label: '⚠️ Missed Nuance', value: 'missed_nuance' },
  { label: '🔄 Redundant', value: 'redundant' },
];

const SCORE_LABELS: Record<number, string> = {
  1: 'Needs Improvement',
  2: 'Fair / Subpar',
  3: 'Good / Solid',
  4: 'Very High Quality',
  5: 'Exceptional Verdict',
};

export const RoundRatingCard: React.FC<RoundRatingCardProps> = ({
  roundId,
  currentRating,
  onSaveRating,
  readOnly = false,
}) => {
  const [isEditing, setIsEditing] = useState(!currentRating);
  const [score, setScore] = useState<number>(currentRating?.score || 0);
  const [hoverScore, setHoverScore] = useState<number>(0);
  const [selectedTags, setSelectedTags] = useState<string[]>(currentRating?.tags || []);
  const [feedback, setFeedback] = useState<string>(currentRating?.feedback || '');
  const [showFeedbackInput, setShowFeedbackInput] = useState(!!currentRating?.feedback);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSave = () => {
    if (score === 0) return;
    const ratingObj: RoundRating = {
      score,
      tags: selectedTags,
      feedback: feedback.trim() || undefined,
      timestamp: Date.now(),
    };
    if (onSaveRating) {
      onSaveRating(roundId, ratingObj);
    }
    setIsEditing(false);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  // If already rated and not actively editing
  if (currentRating && !isEditing) {
    return (
      <div className="flex items-center justify-between gap-3 p-3 bg-slate-900/60 dark:bg-slate-950/70 border border-slate-700/50 rounded-xl text-xs flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-mono text-slate-400">Round Quality:</span>
            <div className="flex items-center text-amber-400">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  size={13}
                  className={star <= currentRating.score ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}
                />
              ))}
            </div>
            <span className="font-mono font-bold text-amber-300 ml-1">
              {currentRating.score}/5
            </span>
            <span className="text-[10px] text-slate-400 ml-1">
              ({SCORE_LABELS[currentRating.score] || 'Rated'})
            </span>
          </div>

          {currentRating.tags && currentRating.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {currentRating.tags.map((t) => {
                const tagObj = RATING_TAGS.find((tag) => tag.value === t);
                return (
                  <span
                    key={t}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60 font-mono"
                  >
                    {tagObj?.label || t}
                  </span>
                );
              })}
            </div>
          )}

          {currentRating.feedback && (
            <p className="text-[11px] text-slate-300 italic border-l-2 border-slate-700 pl-2">
              "{currentRating.feedback}"
            </p>
          )}
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="text-[11px] font-mono text-slate-400 hover:text-amber-300 underline cursor-pointer transition-colors"
          >
            Edit Rating
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-3.5 bg-slate-900/80 dark:bg-slate-950/90 border border-amber-500/25 rounded-xl space-y-3 shadow-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-amber-400" />
          <span className="text-xs font-semibold text-slate-200">
            Rate this Deliberation Round
          </span>
          {(hoverScore || score) > 0 && (
            <span className="text-[11px] font-mono text-amber-400">
              — {SCORE_LABELS[hoverScore || score]}
            </span>
          )}
        </div>

        {currentRating && (
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="text-slate-400 hover:text-slate-200 text-xs p-1"
            title="Cancel"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* 5-Star Interactive Rating */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = star <= (hoverScore || score);
          return (
            <button
              key={star}
              type="button"
              onMouseEnter={() => setHoverScore(star)}
              onMouseLeave={() => setHoverScore(0)}
              onClick={() => setScore(star)}
              className="p-1 rounded-md hover:bg-slate-800 transition-transform active:scale-90 cursor-pointer"
              title={`${star} Star - ${SCORE_LABELS[star]}`}
            >
              <Star
                size={18}
                className={
                  isFilled
                    ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]'
                    : 'text-slate-600 hover:text-slate-400'
                }
              />
            </button>
          );
        })}
        <span className="text-xs font-mono text-slate-400 ml-2">
          {score > 0 ? `${score} / 5` : 'Click to rate'}
        </span>
      </div>

      {/* Quick Feedback Tags */}
      {score > 0 && (
        <div className="space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
            <Tag size={11} />
            <span>Select descriptors (optional):</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RATING_TAGS.map((tag) => {
              const isSelected = selectedTags.includes(tag.value);
              return (
                <button
                  key={tag.value}
                  type="button"
                  onClick={() => handleToggleTag(tag.value)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-mono ${
                    isSelected
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-xs'
                      : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 border-slate-700/60'
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>

          {/* Optional Reflection / Feedback note */}
          {!showFeedbackInput ? (
            <button
              type="button"
              onClick={() => setShowFeedbackInput(true)}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-amber-300 pt-1 cursor-pointer"
            >
              <MessageSquare size={11} />
              <span>Add specific notes / reflection</span>
            </button>
          ) : (
            <div className="pt-1 space-y-1.5">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What worked well or what was missing in this round?"
                rows={2}
                className="w-full text-xs p-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
              />
            </div>
          )}

          {/* Save button */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={score === 0}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              {savedSuccess ? <Check size={12} /> : null}
              <span>{savedSuccess ? 'Saved!' : 'Submit Rating'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
