import React from 'react';
import { Globe, ExternalLink, Search } from 'lucide-react';
import { GroundingData } from '../types';

interface GroundingSourcesCardProps {
  grounding?: GroundingData;
  className?: string;
}

export const GroundingSourcesCard: React.FC<GroundingSourcesCardProps> = ({ grounding, className = '' }) => {
  if (!grounding) return null;
  const hasQueries = Boolean(grounding.queries && grounding.queries.length > 0);
  const hasSources = Boolean(grounding.sources && grounding.sources.length > 0);

  if (!hasQueries && !hasSources) return null;

  return (
    <div className={`mt-3 p-3 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 space-y-2 text-xs transition-all ${className}`}>
      <div className="flex items-center gap-1.5 font-bold text-emerald-900 dark:text-emerald-200">
        <Globe size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 animate-pulse" />
        <span>Google Search Grounding & Fact Checks</span>
      </div>

      {hasQueries && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-800/90 dark:text-emerald-300/90">
          <span className="font-semibold flex items-center gap-1">
            <Search size={10} className="shrink-0" /> Search queries:
          </span>
          {grounding.queries?.map((query, idx) => (
            <span
              key={idx}
              className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 font-mono text-[10px] text-emerald-900 dark:text-emerald-200 border border-emerald-200/60 dark:border-emerald-700/50"
            >
              "{query}"
            </span>
          ))}
        </div>
      )}

      {hasSources && (
        <div className="space-y-1.5 pt-1.5 border-t border-emerald-200/60 dark:border-emerald-800/50">
          <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 block">Verified Web Sources:</span>
          <div className="flex flex-wrap gap-1.5">
            {grounding.sources?.map((source, idx) => (
              <a
                key={idx}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700/60 text-[11px] font-medium text-emerald-900 dark:text-emerald-200 hover:text-emerald-700 dark:hover:text-emerald-100 hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors truncate max-w-[260px] shadow-xs"
                title={source.title || source.url}
              >
                <ExternalLink size={10} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate">{source.title || (source.url ? new URL(source.url).hostname : 'Source Link')}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
