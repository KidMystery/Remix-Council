import re

with open('src/components/SettingsPanel.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    "{dupOrgInfo.hasDuplicates && !dupInfo.hasDuplicates && (",
    "{activeTab === 'personas' && dupOrgInfo.hasDuplicates && !dupInfo.hasDuplicates && ("
)

content = content.replace(
    "{presetWarnings.length > 0 && (",
    "{activeTab === 'personas' && presetWarnings.length > 0 && ("
)

content = content.replace(
    '<section className="space-y-3 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">',
    "{activeTab === 'personas' && (<section className=\"space-y-3 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800\">"
)

# close it
content = content.replace(
    "                </div>\n              </section>\n\n              {/* Council Summary Bar */}",
    "                </div>\n              </section>)}\n\n              {/* Council Summary Bar */}"
)

with open('src/components/SettingsPanel.tsx', 'w') as f:
    f.write(content)

