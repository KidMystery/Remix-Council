import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    text = f.read()

text = re.sub(
    r'\s*</div>\s*</div>\s*\)}\s*\{/\* Stage 2: Peer Review & Cross-Examination \(Deep Council mode only\) \*/\}\s*\{!basicMode && \(\s*\{round\.resolvedMode',
    '''\n              </div>\n              )}\n\n              {/* Stage 2: Peer Review & Cross-Examination (Deep Council mode only) */}\n              {!basicMode &&\n                round.resolvedMode''',
    text
)

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(text)

print("Regex replaced stage 2 segment")
