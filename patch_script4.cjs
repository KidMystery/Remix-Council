const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  /const body: any = \{\s*model: openrouterCandidate,\s*messages: webMessages,\s*stream,\s*safetySettings: disableSafety,\s*safety_settings: disableSafety,\s*provider: \{ require_parameters: true, safety_settings: disableSafety \},\s*plugins: \{ google_safety_settings: disableSafety \},\s*tools: \[/m,
  `const body: any = {
        model: openrouterCandidate,
        messages: webMessages,
        stream,
        tools: [`
);

content = content.replace(
  /const body: any = \{ model: actualModelUsed, messages, stream, safetySettings: disableSafety \};/,
  `const body: any = { model: actualModelUsed, messages, stream };`
);

fs.writeFileSync('server.ts', content);
