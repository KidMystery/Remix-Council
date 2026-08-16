const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  /const ALLOWED_MODEL_PATTERN =\s*\/.*\/i;/,
  `const ALLOWED_MODEL_PATTERN = /^([a-z0-9._-]+\\/[a-z0-9._-]+|[a-z0-9._-]+)(:[a-z0-9._-]+)?$/i;`
);

fs.writeFileSync('server.ts', content);
