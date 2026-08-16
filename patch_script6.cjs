const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  /const body: any = \{\s*model: openrouterCandidate,\s*messages: webMessages,\s*stream,\s*tools: \[\s*\{\s*type: "openrouter:web_search",\s*parameters: \{\s*max_results: 5,\s*\},\s*\},\s*\],\s*\};/,
  `const body: any = {
        model: openrouterCandidate,
        messages: webMessages,
        stream,
        tools: [
          {
            type: "openrouter:web_search",
            parameters: {
              max_results: 5,
            },
          },
        ],
      };
      if (openrouterCandidate && (openrouterCandidate.includes("gemini") || openrouterCandidate.includes("google"))) {
        body.provider = { require_parameters: true, safety_settings: disableSafety };
        body.plugins = { google_safety_settings: disableSafety };
      }`
);

fs.writeFileSync('server.ts', content);
