const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const safetyConfig = `
        const config: any = {
          temperature: temperature !== undefined ? temperature : 0.7,
          tools: [{ googleSearch: {} }],
          safetySettings: [
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
          ]
        };
`;

content = content.replace(
  /const config: any = {\n\s*temperature: temperature !== undefined \? temperature : 0\.7,\n\s*tools: \[\{ googleSearch: \{\} \}\],\n\s*};/,
  safetyConfig
);

fs.writeFileSync('server.ts', content);
