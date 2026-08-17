import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

const importTarget = `import { LATEST_GEMINI_FLASH } from "./src/config/modelCatalog";`;
const importReplacement = `import { LATEST_GEMINI_FLASH } from "./src/config/modelCatalog";
import { fetchNormalizedArenaStats } from "./src/lib/arena.js";`;

if (code.includes(importTarget)) {
    code = code.replace(importTarget, importReplacement);
} else {
    code = `import { fetchNormalizedArenaStats } from "./src/lib/arena.js";\n` + code;
}

const routeTarget = `app.post("/api/council", requireOwnerAuth, async (req, res) => {`;
const routeReplacement = `  // Priority 1: Arena.ai integration via HuggingFace dataset with normalization layer
  app.post("/api/arena/normalize", requireOwnerAuth, async (req, res) => {
    try {
      const { models } = req.body;
      const normalizedStats = await fetchNormalizedArenaStats(models);
      return res.json({ status: "success", data: normalizedStats });
    } catch (err: any) {
      console.error("[Arena] Error:", err);
      return res.status(500).json({ error: "Failed to fetch and normalize Arena stats" });
    }
  });

  // Priority 2: Self-replacing mini-council for meta-reflection / prompt rewriting
  app.post("/api/meta", requireOwnerAuth, async (req, res) => {
    try {
      const { query, originalModel, apiKey } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Query is required for meta-reflection" });
      }

      // Mini-council roles
      const systemPrompt = \`You are part of a self-replacing mini-council. Your job is to improve and rewrite the user's prompt to be maximally effective for the target LLM. Return ONLY the rewritten prompt.\`;
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${apiKey || process.env.OPENROUTER_API_KEY}\`
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: \`Original query: \${query}\nTarget model: \${originalModel || 'unknown'}\n\nRewrite this prompt:\` }
          ],
          max_tokens: 1000
        })
      });

      if (!response.ok) {
         throw new Error("Failed OpenRouter request in mini-council");
      }

      const data = await response.json();
      const rewrittenPrompt = data.choices?.[0]?.message?.content || query;

      return res.json({ status: "success", original: query, rewritten: rewrittenPrompt.trim() });
    } catch (err: any) {
      console.error("[Meta Council] Error:", err);
      return res.status(500).json({ error: "Failed to execute mini-council reflection" });
    }
  });

  app.post("/api/council", requireOwnerAuth, async (req, res) => {`;

if (code.includes(routeTarget)) {
    code = code.replace(routeTarget, routeReplacement);
    fs.writeFileSync('server.ts', code);
    console.log("server.ts updated successfully with new routes.");
} else {
    console.log("Target route not found in server.ts.");
}
