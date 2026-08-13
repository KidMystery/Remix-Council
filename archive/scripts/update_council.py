with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

content = content.replace("(import.meta as any).env.VITE_OPENROUTER_API_KEY ||", "")

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)
