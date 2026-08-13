import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

target = '<div className="flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out">'
replacement = '<div className={`flex flex-col gap-3 md:gap-4 min-w-0 w-full transition-all duration-300 ease-in-out ${basicMode ? "hidden" : ""}`}>'

content = content.replace(target, replacement)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)
