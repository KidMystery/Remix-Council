import re

with open('src/components/SettingsPanel.tsx', 'r') as f:
    content = f.read()

# 1. Add advanced to tabs
content = content.replace("useState<'personas' | 'theme' | 'notifications' | 'account'>('personas')", "useState<'personas' | 'advanced' | 'theme' | 'notifications' | 'account'>('personas')")

content = content.replace(
    "const tabs = [",
    "const tabs = [\n    { id: 'advanced', label: 'Advanced', icon: Zap },"
)

# 2. Extract Token Limits and Execution Mode to advanced tab
# The Token Limits section starts around line 120 and goes until the dupInfo warnings.
# I'll just change the activeTab conditions directly in the file.
