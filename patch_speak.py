import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# Replace block 1 (around line 2607)
# <button
#   type="button"
#   onClick={() => speak(resp.content, copyKey)}
#   className={`transition-colors p-1.5 rounded hover:bg-slate-100/80 ${
#     speakingId === copyKey ? 'text-cyan-400 bg-cyan-950/60 animate-pulse' : 'text-slate-500 hover:text-slate-700'
#   }`}
#   title={speakingId === copyKey ? 'Stop reading' : 'Read response aloud'}
# >
#   {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}
# </button>

content = re.sub(
    r'(onClick=\{\(\) => speak\(resp\.content, copyKey\)\}\s*className={`transition-colors p-1\.5 rounded hover:bg-slate-100/80 \$\{)\s*(speakingId === copyKey \? \'[^\']*\' : \'[^\']*\')\s*(}`\}\s*title=\{speakingId === copyKey \? \'Stop reading\' : \'Read response aloud\'\}\s*>)\s*\{speakingId === copyKey \? <VolumeX size=\{13\} /> : <Volume2 size=\{13\} />\}\s*(</button>)',
    r'\1\n                                        \2\n                                      } flex items-center gap-1 font-medium text-[10px]\3\n                                      {speakingId === copyKey ? <VolumeX size={13} /> : <Volume2 size={13} />}\n                                      <span>{speakingId === copyKey ? \'Stop\' : \'Speak\'}</span>\n                                    \4',
    content
)

# Replace the Synthesis block "Read Aloud" to "Speak" as well for consistency
content = content.replace(
    "<span>{speakingId === `${round.id}-synthesis` ? 'Stop' : 'Read Aloud'}</span>",
    "<span>{speakingId === `${round.id}-synthesis` ? 'Stop' : 'Speak'}</span>"
)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)
