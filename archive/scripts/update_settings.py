with open('src/components/SettingsPanel.tsx', 'r') as f:
    content = f.read()

content = content.replace("fetch('/api/openrouter/account'", "fetch('/api/council/account'")

with open('src/components/SettingsPanel.tsx', 'w') as f:
    f.write(content)
