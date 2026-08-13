const fs = require('fs');
const content = fs.readFileSync('src/components/CouncilChamber.tsx', 'utf8');

const startStr = "{rounds.map((round, idx) => {";
const startIdx = content.indexOf(startStr);

if (startIdx === -1) {
  console.log("Start not found");
  process.exit(1);
}

// Find the corresponding closing brackets for rounds.map
// We'll search for the end of the map block:
const endStr = "          );\n        })}\n        </div>\n        )}\n        <div ref={messagesEndRef} className=\"h-4\" />";
const endIdx = content.indexOf(endStr);

if (endIdx === -1) {
  console.log("End not found");
  process.exit(1);
}

const replacement = `{rounds.map((round, idx) => (
              <CouncilRoundView
                key={round.id}
                round={round}
                index={idx}
                personas={personas}
                synthesizer={synthesizer}
                isDeliberating={isDeliberating}
                basicMode={basicMode}
                speakingId={speakingId}
                copiedId={copiedId}
                settings={settings}
                onDeleteRound={handleDeleteRound}
                onRegeneratePersona={handleRegeneratePersona}
                onResynthesize={runQuickPanelSynthesis}
                onSpeak={speak}
                onCopy={(id, text) => {
                  navigator.clipboard.writeText(text);
                  setCopiedId(id);
                  setTimeout(() => setCopiedId(null), 2000);
                }}
              />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} className="h-4" />`;

const newContent = content.substring(0, startIdx) + replacement + content.substring(endIdx + endStr.length);
fs.writeFileSync('src/components/CouncilChamber.tsx', newContent);
console.log("Patched successfully!");
