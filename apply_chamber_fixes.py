import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# 1. Fix theme state initialization
content = content.replace(
    "const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('light');",
    "const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {\n    return (localStorage.getItem('council-theme') as 'dark' | 'light' | 'system') || 'light';\n  });"
)

# 2. Add Send icon import if not imported
if ' Send,' not in content and ', Send' not in content and '{ Send ' not in content:
    content = content.replace('import {', 'import { Send, Eye,')

# 3. Fix Header Actions to include Basic Mode / Detailed Mode toggle button
header_actions_target = """          {/* Header Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => createNewSession()}
              className="p-2 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-600 transition-colors"
              title="New Deliberation"
            >
              <Plus size={16} />
            </button>
          </div>"""

header_actions_replacement = """          {/* Header Actions */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={toggleBasicMode}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all flex items-center gap-1.5 ${
                basicMode 
                  ? 'bg-cyan-50 dark:bg-cyan-950/50 border-cyan-300 dark:border-cyan-700 text-cyan-600 dark:text-cyan-300 shadow-sm' 
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title={basicMode ? "Basic Mode: Showing consensus only" : "Detailed Mode: Showing full debate proposals & peer review"}
            >
              <Eye size={14} className={basicMode ? "text-cyan-500" : "text-slate-400"} />
              <span>{basicMode ? 'Basic Mode' : 'Detailed Mode'}</span>
            </button>

            <button
              type="button"
              onClick={() => createNewSession()}
              className="p-2 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex items-center gap-1.5 text-xs font-medium"
              title="Start New Deliberation Thread"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">New Thread</span>
            </button>
          </div>"""

content = content.replace(header_actions_target, header_actions_replacement)

# 4. Fix Send button in input form
button_target = """            {isDeliberating ? (
              <button
                type="button"
                onClick={handleStop}
                className="px-5 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-sm flex items-center gap-2 transition-colors shadow-lg shadow-red-950/50 shrink-0"
              >
                <Square size={16} /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!query.trim() && attachedFiles.length === 0}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-medium text-sm flex items-center gap-2 transition-all shadow-lg shadow-cyan-950/50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <Play size={16} /> Deliberate
              </button>
            )}"""

button_replacement = """            {isDeliberating ? (
              <button
                type="button"
                onClick={handleStop}
                className="h-[48px] w-[48px] rounded-xl bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors shadow-md shrink-0"
                title="Stop Deliberation"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!query.trim() && attachedFiles.length === 0}
                className="h-[48px] w-[48px] rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white flex items-center justify-center transition-all shadow-md shadow-cyan-950/30 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 active:scale-95"
                title="Send Question"
              >
                <Send size={18} className="ml-0.5" />
              </button>
            )}"""

content = content.replace(button_target, button_replacement)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)

print("Applied chamber fixes")
