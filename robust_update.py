import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# 1. Add basic mode state
if "const [basicMode" not in content:
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

# 2. Add header toggle button next to Session list
header_btn_target = """            <button
              onClick={() => setIsSessionListOpen(true)}"""
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
              onClick={() => setIsSessionListOpen(true)}"""
if "toggleBasicMode" not in content[content.find(header_btn_target)-200 : content.find(header_btn_target)+200]:
    content = content.replace(header_btn_target, header_toggle)

# 3. Hide Stage 1 and Stage 2 contents when basicMode is true
# We can just wrap the content inside the Stage 1 and Stage 2 divs
# Search for Stage 1:
# {/* Stage 1: Initial Proposals / Quick Panel Answers */}
# ...
# <div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">
#   {personas
#     .filter...
#   }
# </div>

stage1_marker = '{/* Stage 1: Initial Proposals / Quick Panel Answers */}'
if stage1_marker in content:
    idx = content.find('<div className="flex flex-col gap-3 md:gap-4', content.find(stage1_marker))
    if idx != -1:
        # insert {!basicMode && ( before <div
        content = content[:idx] + '{!basicMode && (\n                ' + content[idx:]
        
        # Now find the end of this div.
        # It's followed by: {/* Stage 2: Peer Review & Cross-Examination */}
        stage2_marker = '{/* Stage 2: Peer Review & Cross-Examination */}'
        idx2 = content.find(stage2_marker, idx)
        
        # find the closing </div> before stage2_marker
        idx_end_stage1 = content.rfind('</div>', idx, idx2)
        # insert )} after </div>
        content = content[:idx_end_stage1 + 6] + '\n              )}' + content[idx_end_stage1 + 6:]

        # Now do Stage 2
        idx3 = content.find('<div className="flex flex-col gap-3 md:gap-4', idx2)
        if idx3 != -1:
            content = content[:idx3] + '{!basicMode && (\n                ' + content[idx3:]
            
            # Followed by {/* Stage 3: Synthesis & Consensus */}
            stage3_marker = '{/* Stage 3: Synthesis & Consensus */}'
            idx4 = content.find(stage3_marker, idx3)
            
            idx_end_stage2 = content.rfind('</div>', idx3, idx4)
            content = content[:idx_end_stage2 + 6] + '\n              )}' + content[idx_end_stage2 + 6:]

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)
