const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const safetyConfig = `
      const disableSafety = [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
      ];
`;

content = content.replace(
  /const body: any = {\n\s*model: openrouterCandidate,\n\s*messages: webMessages,\n\s*stream,\n\s*tools: \[/,
  safetyConfig + `
      const body: any = {
        model: openrouterCandidate,
        messages: webMessages,
        stream,
        safetySettings: disableSafety,
        safety_settings: disableSafety,
        provider: { require_parameters: true, safety_settings: disableSafety },
        plugins: { google_safety_settings: disableSafety },
        tools: [
`
);

fs.writeFileSync('server.ts', content);
