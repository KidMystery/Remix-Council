import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# 1. Remove from Header
header_button = """            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-600 transition-colors relative"
              title="Open Settings"
            >
              <SettingsIcon size={16} />
            </button>"""
content = content.replace(header_button, "")

# 2. Add to chat box
input_area_pattern = """            <button
              type="button"
              disabled={isDeliberating}
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-cyan-400 transition-colors shrink-0 disabled:opacity-40"
              title="Upload context document or code file"
            >
              <Paperclip size={18} />
            </button>"""

chat_cog = """            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-3 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-cyan-400 transition-colors shrink-0"
              title="Open Settings"
            >
              <SettingsIcon size={18} />
            </button>"""

content = content.replace(input_area_pattern, chat_cog + "\n" + input_area_pattern)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)
