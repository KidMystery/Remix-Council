import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Middleware to parse JSON bodies
  app.use(express.json({ limit: "75mb" }));
  app.use(express.urlencoded({ limit: "75mb", extended: true }));

    app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/council", async (req, res) => {
    const { model, messages, temperature, max_tokens, stream, enableSearchGrounding } = req.body;
    const reqApiKey = ((req.headers['x-api-key-override'] as string) || '').trim();

    // 1. If Google Search Grounding is requested OR model is Gemini with grounding enabled:
    if (enableSearchGrounding) {
      const geminiKey = reqApiKey.startsWith('AIza')
        ? reqApiKey
        : (process.env.GEMINI_API_KEY || '');

      if (!geminiKey) {
        return res.status(401).json({
          error: "Missing Gemini API Key: Google Search Grounding requires a valid Gemini API key."
        });
      }

      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({
          apiKey: geminiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });

        let targetModel = 'gemini-2.5-flash';
        if (model && (model.includes('3.5-flash') || model.includes('3.5'))) {
          targetModel = 'gemini-3.5-flash';
        } else if (model && (model.includes('3.6-flash') || model.includes('3.6'))) {
          targetModel = 'gemini-3.6-flash';
        } else if (model && model.includes('2.5-flash')) {
          targetModel = 'gemini-2.5-flash';
        } else if (model && (model.startsWith('gemini-') || model.startsWith('google/gemini'))) {
          targetModel = model.replace('google/', '');
        }

        // Parse system prompt and user contents
        const systemMsg = messages?.find((m: any) => m.role === 'system')?.content || '';
        const userMsgs = messages?.filter((m: any) => m.role !== 'system') || [];
        const contentsStr = userMsgs.map((m: any) => {
          if (typeof m.content === 'string') return m.content;
          if (Array.isArray(m.content)) {
            return m.content.map((part: any) => part.text || '').filter(Boolean).join('\n');
          }
          return JSON.stringify(m.content);
        }).join('\n\n');

        const config: any = {
          temperature: temperature !== undefined ? temperature : 0.7,
          tools: [{ googleSearch: {} }]
        };
        if (systemMsg) config.systemInstruction = systemMsg;
        if (max_tokens) config.maxOutputTokens = max_tokens;

        if (stream) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          const streamResult = await ai.models.generateContentStream({
            model: targetModel,
            contents: contentsStr || 'Hello',
            config
          });

          let collectedGrounding: any = null;

          for await (const chunk of streamResult) {
            if (chunk.text) {
              const sseData = JSON.stringify({
                choices: [{
                  delta: { content: chunk.text },
                  finish_reason: null,
                  index: 0
                }],
                model: targetModel
              });
              res.write(`data: ${sseData}\n\n`);
            }

            if (chunk.candidates?.[0]?.groundingMetadata) {
              const meta = chunk.candidates[0].groundingMetadata;
              collectedGrounding = {
                queries: meta.webSearchQueries || [],
                sources: (meta.groundingChunks || []).map((c: any) => ({
                  title: c.web?.title || 'Web Source',
                  url: c.web?.uri || ''
                })).filter((s: any) => s.url)
              };
            }
          }

          if (collectedGrounding) {
            const sseGrounding = JSON.stringify({
              choices: [{
                delta: { content: '', grounding: collectedGrounding },
                finish_reason: null,
                index: 0
              }],
              model: targetModel
            });
            res.write(`data: ${sseGrounding}\n\n`);
          }

          res.write("data: [DONE]\n\n");
          return res.end();
        } else {
          const result = await ai.models.generateContent({
            model: targetModel,
            contents: contentsStr || 'Hello',
            config
          });
          const text = result.text || '';
          const meta = result.candidates?.[0]?.groundingMetadata;
          const grounding = meta ? {
            queries: meta.webSearchQueries || [],
            sources: (meta.groundingChunks || []).map((c: any) => ({
              title: c.web?.title || 'Web Source',
              url: c.web?.uri || ''
            })).filter((s: any) => s.url)
          } : undefined;

          return res.json({
            choices: [{
              message: { role: 'assistant', content: text },
              grounding
            }]
          });
        }
      } catch (err: any) {
        console.error("[API Proxy] Search Grounding Error:", err);
        return res.status(500).json({ error: err.message || "Search Grounding failed." });
      }
    }

    let openrouterKey = '';
    if (reqApiKey.startsWith('sk-or-')) {
      openrouterKey = reqApiKey;
    } else if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().startsWith('sk-or-')) {
      openrouterKey = process.env.OPENROUTER_API_KEY.trim();
    }

    let response: any = null;

    // 1. Try OpenRouter if a valid OpenRouter API key exists
    if (openrouterKey) {
      try {
        const body: any = { model, messages, stream };
        if (temperature !== undefined) body.temperature = temperature;
        if (max_tokens !== undefined) body.max_tokens = max_tokens;

        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openrouterKey}`,
            "HTTP-Referer": "https://ai.studio/build",
            "X-Title": "AI Council Chamber"
          },
          body: JSON.stringify(body)
        });

        // If OpenRouter responds with HTTP 401/403/402 (authentication/quota errors), log warning and fall back to Gemini
        if (!response.ok && (response.status === 401 || response.status === 403 || response.status === 402)) {
          console.warn(`[API Proxy] OpenRouter returned HTTP ${response.status}. Falling back to Gemini API...`);
          response = null;
        }
      } catch (err) {
        console.warn("[API Proxy] OpenRouter request failed, falling back to Gemini API:", err);
        response = null;
      }
    }

    // 2. Fallback to Google Gemini API
    if (!response) {
      const geminiKey = reqApiKey.startsWith('AIza')
        ? reqApiKey
        : (process.env.GEMINI_API_KEY || '');

      if (!geminiKey) {
        return res.status(401).json({
          error: "Missing API Key: Please configure a valid OpenRouter key (sk-or-...) or Gemini API key."
        });
      }

      try {
        const targetModel = 'gemini-2.5-flash';
        const body: any = {
          model: targetModel,
          messages,
          stream
        };
        if (temperature !== undefined) body.temperature = temperature;

        response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${geminiKey}`
          },
          body: JSON.stringify(body)
        });
      } catch (err: any) {
        console.error("[API Proxy] Gemini API Error:", err);
        return res.status(500).json({ error: err.message || "Failed to contact Gemini API." });
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch (err) {
          console.error("[API Proxy] Stream error:", err);
        }
      }
      res.end();
    } else {
      const data = await response.json();
      res.json(data);
    }
  });

  app.get("/api/council/models", async (req, res) => {
    try {
      const sort = req.query.sort || 'newest';
      const response = await fetch(`https://openrouter.ai/api/v1/models?sort=${sort}`);
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/council/account", async (req, res) => {
    const reqApiKey = ((req.headers['x-api-key-override'] as string) || '').trim();
    let apiKey = '';
    if (reqApiKey.startsWith('sk-or-')) {
      apiKey = reqApiKey;
    } else if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().startsWith('sk-or-')) {
      apiKey = process.env.OPENROUTER_API_KEY.trim();
    }

    if (!apiKey) {
      return res.json({
        data: {
          label: "Google Gemini API (Active)",
          limit: null,
          usage: 0,
          is_free_tier: true,
        }
      });
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      });
      if (!response.ok) {
        return res.json({
          data: {
            label: "Google Gemini API (Active)",
            limit: null,
            usage: 0,
            is_free_tier: true,
          }
        });
      }
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
