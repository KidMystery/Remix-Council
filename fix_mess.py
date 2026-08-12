import re

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# Remove the {!basicMode && (
content = content.replace('{!basicMode && (\n                <div className="flex flex-col gap-3 md:gap-4', '<div className="flex flex-col gap-3 md:gap-4')

# Find the two extra )} at the very end of the file
# and remove them.
# I'll just remove the last two occurrences of `)}` if they are dangling.
# Wait, let's just strip everything after the final export or div, or let's use regex to remove the extra )} at EOF.

last_div_idx = content.rfind('</div>')
content = content[:last_div_idx+6] + '\n' + content[last_div_idx+6:].replace(')}', '')

with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)
