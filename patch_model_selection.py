import re

with open('src/components/SettingsPanel.tsx', 'r') as f:
    content = f.read()

content = re.sub(
    r'(<div className="space-y-1">\s*<label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Model</label>\s*<input\s*list={`models-list-\${persona.id}`}[\s\S]*?</datalist>\s*</div>)',
    r"{activeTab === 'personas' && \1}",
    content
)

content = re.sub(
    r'(<div className="space-y-1">\s*<label className="text-xs font-semibold text-slate-500 dark:text-slate-400 block">Model</label>\s*<input\s*list="models-list-synth"[\s\S]*?</datalist>\s*</div>)',
    r"{activeTab === 'personas' && \1}",
    content
)

# Also conditionally hide the ModelDetailsCard inside Settings
content = re.sub(
    r'(\{persona\.model && \([\s\S]*?rawModelsCatalog={rawModelsCatalog}\s*/>\s*\)\})',
    r"{activeTab === 'personas' && \1}",
    content
)

content = re.sub(
    r'(\{synthesizer\.model && \([\s\S]*?rawModelsCatalog={rawModelsCatalog}\s*/>\s*\)\})',
    r"{activeTab === 'personas' && \1}",
    content
)


with open('src/components/SettingsPanel.tsx', 'w') as f:
    f.write(content)

