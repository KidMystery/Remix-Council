import re

with open('src/components/SettingsPanel.tsx', 'r') as f:
    content = f.read()

# For personas mapping
# <div className="space-y-1">
#   <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">System Prompt</label>
#   <textarea 
#     value={persona.systemPrompt}
#     onChange={(e) => updatePersona(persona.id, { systemPrompt: e.target.value })}
# ...
#   />
# </div>

content = re.sub(
    r'(<div className="space-y-1">\s*<label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">System Prompt</label>\s*<textarea\s*value={persona.systemPrompt}[\s\S]*?</div>)',
    r"{activeTab === 'advanced' && \1}",
    content
)

content = re.sub(
    r'(<div className="space-y-1">\s*<label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">System Prompt</label>\s*<textarea\s*value={synthesizer.systemPrompt}[\s\S]*?</div>)',
    r"{activeTab === 'advanced' && \1}",
    content
)

# Hide Council Summary Bar unless activeTab === 'personas'
content = content.replace(
    '<CouncilSummaryBar',
    '{activeTab === "personas" && <CouncilSummaryBar'
)
content = content.replace(
    'updatedAt={metadata.updatedAt}\n              />',
    'updatedAt={metadata.updatedAt}\n              />}'
)

with open('src/components/SettingsPanel.tsx', 'w') as f:
    f.write(content)

