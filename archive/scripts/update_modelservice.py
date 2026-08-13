import re

with open('src/lib/modelService.ts', 'r') as f:
    content = f.read()

content = content.replace("fetch('https://openrouter.ai/api/v1/models", "fetch('/api/council/models")

with open('src/lib/modelService.ts', 'w') as f:
    f.write(content)
