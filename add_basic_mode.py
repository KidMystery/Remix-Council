import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# Add state
state_code = """  const [basicMode, setBasicMode] = useState(() => {
    return localStorage.getItem('council_basic_mode') === 'true';
  });

  const toggleBasicMode = () => {
    const next = !basicMode;
    setBasicMode(next);
    localStorage.setItem('council_basic_mode', next.toString());
  };
"""

content = content.replace("  const [isSettingsOpen, setIsSettingsOpen] = useState(false);", "  const [isSettingsOpen, setIsSettingsOpen] = useState(false);\n" + state_code)

# Add toggle to header
header_toggle = """            <button
              onClick={toggleBasicMode}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                basicMode 
                  ? 'bg-cyan-50 dark:bg-cyan-900/30 border-cyan-200 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400' 
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50'
              }`}
              title="Toggle Basic Mode (Focus on Consensus)"
            >
              {basicMode ? 'Basic Mode' : 'Detailed Mode'}
            </button>
            <button
              onClick={() => setIsSessionListOpen(true)}"""
content = content.replace("""            <button
              onClick={() => setIsSessionListOpen(true)}""", header_toggle)

# Hide contents of Stage 1 and 2 if basicMode
# Find Stage 1 contents
stage1_start = content.find('{personas\n                    .filter((persona) => round.deliberation?.stage1?.[persona.id] || persona.enabled !== false)')
content = content[:stage1_start] + '{!basicMode && ' + content[stage1_start:]

# We have to close the {!basicMode && ( <div>...</div> )} properly.
# The map ends at:
#                     ))}
#                   </div>
stage1_end = content.find(')}', content.find('</div>', content.find('))} \n                    </div>', stage1_start)))
# Actually, the div wraps the map:
#                 <div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">
#                   {personas.map(...)}
#                 </div>

content = content.replace('<div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">\n                  {personas\n                    .filter((persona)', '{!basicMode && (<div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">\n                  {personas\n                    .filter((persona)')
content = content.replace('))} \n                    </div>\n                  )}', '))} \n                    </div>\n                  )}\n                  )}') # wait this replace might be brittle.

with open('fix_stages.py', 'w') as f:
    f.write("import re\n")

