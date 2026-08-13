import re

with open('src/components/SettingsPanel.tsx', 'r') as f:
    content = f.read()

injection = """
                <div className="pt-3 space-y-3 border-t border-slate-200/60 dark:border-slate-800/60">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Features & Logs</h3>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Blind Pro Compare (Phase 2)
                    </label>
                    <button
                      type="button"
                      onClick={handleToggleProCompare}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                        isProCompareEnabled
                          ? 'bg-purple-600 text-white'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {isProCompareEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Telemetry & Audit Logs
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAuditModalOpen?.(true)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      View Logs
                    </button>
                  </div>
                </div>
"""

content = content.replace(
    "                {/* Quick Panel & Deliberation Mode Configs */}",
    injection + "\n                {/* Quick Panel & Deliberation Mode Configs */}"
)

with open('src/components/SettingsPanel.tsx', 'w') as f:
    f.write(content)

