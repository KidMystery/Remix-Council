with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

content = content.replace("<span>{speakingId === copyKey ? \\'Stop\\' : \\'Speak\\'}</span>", "<span>{speakingId === copyKey ? 'Stop' : 'Speak'}</span>")

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)
