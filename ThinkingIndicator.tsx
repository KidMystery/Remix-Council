import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ThinkingIndicatorProps {
  stageLabel: string;
  personaName: string;
  role?: string;
  model?: string;
  accentColor?: 'cyan' | 'purple' | 'amber';
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  stageLabel,
  personaName,
  role,
  model,
  accentColor = 'cyan',
}) => {
  const colorMap = {
    cyan: {
      border: 'border-cyan-500/40',
      text: 'text-cyan-400',
      dot: 'bg-cyan-400',
    },
    purple: {
      border: 'border-purple-500/40',
      text: 'text-purple-400',
      dot: 'bg-purple-400',
    },
    amber: {
      border: 'border-amber-500/40',
      text: 'text-amber-400',
      dot: 'bg-amber-400',
    },
  }[accentColor];

  return (
    <div className={`p-4 rounded-xl bg-white dark:bg-slate-900/80 border ${colorMap.border} space-y-3 animate-pulse shadow-sm`}>
      <div className="flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center space-x-2">
          <Loader2 size={13} className={`animate-spin ${colorMap.text}`} />
          <span className={`font-semibold ${colorMap.text}`}>{stageLabel}</span>
        </div>
        {model && (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono whitespace-normal break-words max-w-full" title={model}>
            {model}
          </span>
        )}
      </div>
      <div className="flex items-center space-x-2 text-xs text-slate-600 dark:text-slate-400 italic">
        <span className="flex space-x-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${colorMap.dot} animate-bounce`} style={{ animationDuration: '0.8s' }} />
          <span className={`w-2 h-2 rounded-full ${colorMap.dot} animate-bounce`} style={{ animationDuration: '0.8s', animationDelay: '150ms' }} />
          <span className={`w-2 h-2 rounded-full ${colorMap.dot} animate-bounce`} style={{ animationDuration: '0.8s', animationDelay: '300ms' }} />
        </span>
        <span className="whitespace-normal break-words" title={`${personaName} ${role ? `(${role})` : ''} is formulating analysis...`}>
          {personaName} {role ? `(${role})` : ''} is formulating analysis...
        </span>
      </div>
    </div>
  );
};
