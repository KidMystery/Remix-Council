import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

target = """            <button
              onClick={() => createNewSession()}
              className="p-2 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-600 transition-colors"
              title="New Discussion"
            >"""

header_toggle = """            <button
              onClick={toggleBasicMode}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                basicMode 
                  ? 'bg-cyan-50 dark:bg-cyan-900/30 border-cyan-200 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400' 
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="Toggle Basic Mode (Focus on Consensus)"
            >
              {basicMode ? 'Basic Mode' : 'Detailed Mode'}
            </button>
            <button
              onClick={() => createNewSession()}
              className="p-2 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-600 transition-colors"
              title="New Discussion"
            >"""

if "toggleBasicMode" not in content[content.find("createNewSession")-200:content.find("createNewSession")+200]:
    content = content.replace(target, header_toggle)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)

