import re

with open('index.html', 'r') as f:
    html = f.read()
html = html.replace('<title>My Google AI Studio App</title>', '<title>Council Chamber</title>')
with open('index.html', 'w') as f:
    f.write(html)

with open('src/components/CouncilChamber.tsx', 'r') as f:
    content = f.read()

# Fix 1: The theme button is broken / color contrast.
# The root div has hardcoded bg and text.
content = content.replace('className="flex h-screen bg-[#f5f5f0] text-slate-800', 'className="flex h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200')
content = content.replace('bg-white/95 backdrop-blur-md border-slate-200/80', 'bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-slate-200/80 dark:border-slate-800')
content = content.replace('bg-white border-t border-slate-200/80', 'bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800')
content = content.replace('bg-[#f5f5f0]', 'bg-slate-50 dark:bg-slate-900')
content = content.replace('bg-white/90', 'bg-white/90 dark:bg-slate-800/90')
content = content.replace('bg-white', 'bg-white dark:bg-slate-900')
content = content.replace('text-slate-800', 'text-slate-800 dark:text-slate-100')
content = content.replace('text-slate-700', 'text-slate-700 dark:text-slate-200')
content = content.replace('text-slate-500', 'text-slate-500 dark:text-slate-400')
content = content.replace('border-slate-200', 'border-slate-200 dark:border-slate-700')
content = content.replace('border-slate-100', 'border-slate-100 dark:border-slate-800')

# Fix 2: Submit button "Deliberate" -> Send icon (triangle/arrow)
send_button = """                  <button
                    type="submit"
                    disabled={(!query.trim() && attachedFiles.length === 0) || isDeliberating}
                    className={`shrink-0 h-[44px] w-[44px] flex items-center justify-center rounded-xl font-medium transition-all duration-200 ${
                      (!query.trim() && attachedFiles.length === 0) || isDeliberating
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md hover:shadow-lg active:scale-95'
                    }`}
                    title="Send"
                  >
                    {isDeliberating ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <Send size={20} className="ml-1" />
                    )}
                  </button>"""
# Find the button and replace it
btn_start = content.find('<button\n                    type="submit"')
if btn_start != -1:
    btn_end = content.find('</button>', btn_start) + 9
    content = content[:btn_start] + send_button + content[btn_end:]

# Add Send icon to imports
if 'Send,' not in content and ' Send ' not in content:
    content = content.replace('Loader2,', 'Loader2, Send,')


with open('src/components/CouncilChamber.tsx', 'w') as f:
    f.write(content)

