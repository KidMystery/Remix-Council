const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

// Fix 1: Fix Web Grounding OpenRouter Body
content = content.replace(
  /const body: any = \{\s*model: openrouterCandidate,\s*messages: webMessages,\s*stream,\s*tools: \[\s*\{\s*type: "openrouter:web_search"/m,
  `const disableSafety = [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
      ];

      const body: any = {
        model: openrouterCandidate,
        messages: webMessages,
        stream,
        tools: [
          {
            type: "openrouter:web_search"`
);

// Fix 2: Remove root safety settings from actualModelUsed body
content = content.replace(
  /if \(actualModelUsed && \(actualModelUsed\.includes\("gemini"\) \|\| actualModelUsed\.includes\("google"\)\)\) \{\s*body\.safety_settings = disableSafety;\s*body\.provider = \{ require_parameters: true, safety_settings: disableSafety \};\s*body\.plugins = \{ google_safety_settings: disableSafety \};\s*\}/,
  `if (actualModelUsed && (actualModelUsed.includes("gemini") || actualModelUsed.includes("google"))) {
          body.provider = { require_parameters: true, safety_settings: disableSafety };
          body.plugins = { google_safety_settings: disableSafety };
        }`
);

// Fix 3: Remove safetySettings from Google fallback
content = content.replace(
  /const body: any = \{\s*model: geminiTargetModel,\s*messages,\s*stream,\s*safetySettings: disableSafety,\s*safety_settings: disableSafety\s*\};/,
  `const body: any = {
          model: geminiTargetModel,
          messages,
          stream
        };`
);

fs.writeFileSync('server.ts', content);
