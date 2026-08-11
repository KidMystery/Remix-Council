import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# Replace hardcoded dark mode colors with light theme cream/charcoal colors
replacements = [
    (r'bg-slate-950/80', r'bg-white/80'),
    (r'bg-slate-950/60', r'bg-white/60'),
    (r'bg-slate-950/40', r'bg-[#f5f5f0]/40'),
    (r'bg-slate-950', r'bg-[#f5f5f0]'),
    
    (r'bg-slate-900/90', r'bg-white/90'),
    (r'bg-slate-900/50', r'bg-white/50'),
    (r'bg-slate-900', r'bg-white'),
    
    (r'bg-slate-800/80', r'bg-slate-100/80'),
    (r'bg-slate-800/60', r'bg-slate-100/60'),
    (r'bg-slate-800/50', r'bg-slate-100/50'),
    (r'bg-slate-800', r'bg-slate-100'),
    
    (r'text-slate-100', r'text-slate-800'),
    (r'text-slate-200', r'text-slate-700'),
    (r'text-slate-300', r'text-slate-600'),
    (r'text-slate-400', r'text-slate-500'),
    
    (r'border-slate-800/80', r'border-slate-200/80'),
    (r'border-slate-800/60', r'border-slate-200/60'),
    (r'border-slate-800/40', r'border-slate-200/40'),
    (r'border-slate-800', r'border-slate-200'),
    (r'border-slate-700', r'border-slate-200'),
]

for old, new in replacements:
    content = re.sub(old, new, content)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)

