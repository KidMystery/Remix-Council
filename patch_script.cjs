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
  /const body: any = { model: actualModelUsed, messages, stream };/,
  safetyConfig + `
        const body: any = { model: actualModelUsed, messages, stream, safetySettings: disableSafety };
        if (actualModelUsed && (actualModelUsed.includes("gemini") || actualModelUsed.includes("google"))) {
          body.safety_settings = disableSafety;
          body.provider = { require_parameters: true, safety_settings: disableSafety };
          body.plugins = { google_safety_settings: disableSafety };
        }
`
);

content = content.replace(
  /const body: any = {\n\s*model: geminiTargetModel,\n\s*messages,\n\s*stream,\n\s*};/,
  safetyConfig + `
        const body: any = {
          model: geminiTargetModel,
          messages,
          stream,
          safetySettings: disableSafety,
          safety_settings: disableSafety
        };
`
);

fs.writeFileSync('server.ts', content);
