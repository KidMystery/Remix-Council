with open('src/lib/openrouter.ts', 'r') as f:
    content = f.read()

content = content.replace("fetch('/api/openrouter'", "fetch('/api/council'")

with open('src/lib/openrouter.ts', 'w') as f:
    f.write(content)
