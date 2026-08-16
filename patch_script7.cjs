const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  /const disableSafety = \[\s*\{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" \},\s*\{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" \},\s*\{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" \},\s*\{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" \}\s*\];\s*const disableSafety = \[\s*\{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" \},\s*\{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" \},\s*\{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" \},\s*\{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" \}\s*\];/,
  `const disableSafety = [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
      ];`
);

fs.writeFileSync('server.ts', content);
