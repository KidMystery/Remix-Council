const fs = require('fs');

const path = 'src/components/CouncilRoundView.tsx';
let content = fs.readFileSync(path, 'utf8');

const propAdditions = `
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onReRunRound: (id: string) => void;
  onEditPrompt: (id: string) => void;
  onResumeRound?: (id: string) => void;
  incompleteStage?: { isIncomplete: boolean; stage: 1 | 2 | 3; description: string };
`;

// Insert into CouncilRoundViewProps
content = content.replace('onCopy: (id: string, text: string) => void;\n}', 'onCopy: (id: string, text: string) => void;' + propAdditions + '}');

const funcAdditions = `
  isCollapsed,
  onToggleCollapse,
  onReRunRound,
  onEditPrompt,
  onResumeRound,
  incompleteStage,
`;

content = content.replace('onCopy,\n}) => {', 'onCopy,' + funcAdditions + '}) => {');

// Update the rendering logic of the banner
const oldBannerStart = `{/* User Question Prompt Banner */}`;
const oldBannerEnd = `        )}
      </div>

      {/* Stage 1: Initial Persona Responses */}`;

const oldBannerSection = content.substring(content.indexOf(oldBannerStart), content.indexOf(oldBannerEnd) + oldBannerEnd.length);

const newBannerSection = `{/* User Query Banner */}
      <div 
        className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200/50 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 flex flex-col space-y-4 shadow-sm transition-colors cursor-pointer"
        onClick={() => onToggleCollapse(round.id)}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              Round #{index + 1}
            </span>
            <span className={\`text-[10px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider \${
              round.resolvedMode === 'quick_panel'
                ? 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60'
                : 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60'
            }\`}>
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
              onClick={() => onCopy(\`prompt-\${round.id}\`, round.userQuery)}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 transition-colors"
              title="Copy prompt"
            >
              {copiedId === \`prompt-\${round.id}\` ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
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
          {/* Stage 1: Initial Persona Responses */}`;

content = content.replace(oldBannerSection, newBannerSection);

const oldEnd = `        </>
      )}
    </div>
  );
};
`;

const newEnd = `        </>
      )}
        </>
      )}
    </div>
  );
};
`;
content = content.replace(`    </div>\n  );\n};\n`, `        </>\n      )}\n    </div>\n  );\n};\n`);
fs.writeFileSync(path, content);
console.log("Patched CouncilRoundView");
