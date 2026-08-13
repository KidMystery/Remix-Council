const fs = require('fs');

const path = 'src/components/CouncilChamber.tsx';
let content = fs.readFileSync(path, 'utf8');

// Update CouncilRoundView usage
const oldProps = `                onResynthesize={runQuickPanelSynthesis}
                onSpeak={speak}
                onCopy={(id, text) => {
                  navigator.clipboard.writeText(text);
                  setCopiedId(id);
                  setTimeout(() => setCopiedId(null), 2000);
                }}
              />`;
              
const newProps = `                onResynthesize={runQuickPanelSynthesis}
                onSpeak={speak}
                onCopy={(id, text) => {
                  navigator.clipboard.writeText(text);
                  setCopiedId(id);
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                isCollapsed={collapsedRoundIds.has(round.id)}
                onToggleCollapse={toggleRoundCollapse}
                onReRunRound={reRunRoundDeliberation}
                onEditPrompt={handleEditPrompt}
                onResumeRound={resumeIncompleteRound}
                incompleteStage={(() => {
                  const activePersonas = personas.filter((p) => p.enabled !== false);
                  return getRoundIncompleteStage(round, activePersonas);
                })()}
              />`;

content = content.replace(oldProps, newProps);

const removeFunc = (fnTextStart) => {
  const idx = content.indexOf(fnTextStart);
  if (idx !== -1) {
    let braceCount = 0;
    let started = false;
    let i = idx;
    while (i < content.length) {
      if (content[i] === '{') {
        braceCount++;
        started = true;
      } else if (content[i] === '}') {
        braceCount--;
      }
      if (started && braceCount === 0) {
        content = content.substring(0, idx) + content.substring(i + 1);
        break;
      }
      i++;
    }
  }
};

removeFunc("const toggleTranscriptExpand");
removeFunc("const handleCopy = ");
removeFunc("const regenerateSynthesis = async");
removeFunc("const handleDeepenAnswer = async");

content = content.replace(/  const \[isSessionListOpen[\s\S]*?\n/, '');
content = content.replace(/  const \[expandedTranscriptIds[\s\S]*?\n/, '');
content = content.replace(/  const totalSessionTokens[\s\S]*?\n/, '');
content = content.replace(/  const dupInfo[\s\S]*?\n/, '');

fs.writeFileSync(path, content);
console.log("Fixed Chamber");
