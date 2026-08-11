import re

with open('src/components/SettingsPanel.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    "  setPanelTimeoutSeconds?: (val: number) => void;\n}",
    "  setPanelTimeoutSeconds?: (val: number) => void;\n  isProCompareEnabled?: boolean;\n  handleToggleProCompare?: () => void;\n  setIsAuditModalOpen?: (val: boolean) => void;\n}"
)

content = content.replace(
    "setSynthesisMaxTokens, panelTimeoutSeconds = 30, setPanelTimeoutSeconds\n}: SettingsPanelProps) {",
    "setSynthesisMaxTokens, panelTimeoutSeconds = 30, setPanelTimeoutSeconds,\n  isProCompareEnabled, handleToggleProCompare, setIsAuditModalOpen\n}: SettingsPanelProps) {"
)

with open('src/components/SettingsPanel.tsx', 'w') as f:
    f.write(content)

