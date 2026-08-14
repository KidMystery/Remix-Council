import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// --- SECURITY FIX: Input Validation Schemas ---
const imagePartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({ url: z.string().url().max(2048, "Image URL too long") }),
});

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1, "Text content cannot be empty").max(150000, "Text content too long"),
});

const contentPartSchema = z.discriminatedUnion("type", [textPartSchema, imagePartSchema]);

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([
    z.string().min(1, "Message content cannot be empty").max(150000, "Message content too long"),
    z.array(contentPartSchema).min(1, "Message content array cannot be empty").max(10, "Too many content parts"),
  ]),
});

const llmRequestSchema = z.object({
  model: z.string().min(3, "Model ID too short").max(100, "Model ID too long"),
  messages: z.array(messageSchema).min(1, "Messages array cannot be empty").max(100, "Too many messages"),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().min(1).max(16384).optional(),
  stream: z.boolean().optional(),
  enableSearchGrounding: z.boolean().optional(),
});
// --- END Input Validation Schemas ---

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // 10MB limit as a pragmatic compromise for payload uploads
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  const requestWindow = new Map<string, { startedAt: number; count: number }>();

  function isRateLimited(req: express.Request): boolean {
    const key = req.ip || "unknown";
    const now = Date.now();
    const windowMs = 60_000;
    const maxRequests = 120;

    const current = requestWindow.get(key);
    if (!current || now - current.startedAt > windowMs) {
      requestWindow.set(key, { startedAt: now, count: 1 });
      return false;
    }
    current.count += 1;
    return current.count > maxRequests;
  }

  const KNOWN_MODEL_NAME_MAP: Record<string, string> = {
    "gemini 3.7 flash": "google/gemini-3.7-flash",
    "gemini-3.7-flash": "google/gemini-3.7-flash",
    "gemini 2.5 flash": "google/gemini-2.5-flash",
    "gemini 2.0 flash": "google/gemini-2.0-flash-001",
    "gemini 2.5 pro": "google/gemini-2.5-pro",
    "gemini 2.0 flash exp": "google/gemini-2.0-flash-exp:free",
    "claude 3.7 sonnet": "anthropic/claude-3.7-sonnet",
    "claude 3.5 sonnet": "anthropic/claude-3.5-sonnet",
    "claude 3.5 haiku": "anthropic/claude-3.5-haiku",
    "gpt-4o": "openai/gpt-4o",
    "gpt-4o mini": "openai/gpt-4o-mini",
    "o3-mini": "openai/o3-mini",
    "deepseek r1": "deepseek/deepseek-r1",
    "deepseek v3": "deepseek/deepseek-chat",
    "qwen 2.5 72b instruct": "qwen/qwen-2.5-72b-instruct",
    "llama 3.3 70b instruct": "meta-llama/llama-3.3-70b-instruct",
    "nemotron 3.5 content safety": "nvidia/nemotron-3.5-content-safety:free",
  };

  function sanitizeAndResolveModel(value: unknown): string {
    if (typeof value !== "string") return "google/gemini-3.7-flash";
    let trimmed = value.trim();
    if (!trimmed) return "google/gemini-3.7-flash";

    const lower = trimmed.toLowerCase();
    const withoutFree = lower.replace(/\s*\(free\)/g, "").replace(/\s*\(paid\)/g, "").trim();

    if (KNOWN_MODEL_NAME_MAP[withoutFree]) {
      return KNOWN_MODEL_NAME_MAP[withoutFree];
    }

    if (trimmed.includes("(free)") && !trimmed.endsWith(":free")) {
      trimmed = trimmed.replace(/\s*\(free\)/i, ":free");
    } else {
      trimmed = trimmed.replace(/\s*\(paid\)/i, "");
    }

    trimmed = trimmed.replace(/^["']|["']$/g, "").trim();

    if (/^[a-zA-Z0-9_.:/~@+-]+$/.test(trimmed)) {
      return trimmed;
    }

    const match = trimmed.match(/[a-zA-Z0-9_.:/~@+-]+/);
    if (match && match[0].length >= 3) {
      return match[0];
    }

    return "google/gemini-3.7-flash";
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/council", async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    // --- SECURITY FIX: Server-side input validation ---
    try {
      llmRequestSchema.parse(req.body);
    } catch (validationError: any) {
      if (validationError instanceof z.ZodError) {
        console.warn("Input validation failed:", validationError.issues);
        return res.status(400).json({
          error:
            "Invalid request payload: " +
            validationError.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
        });
      }
      return res.status(400).json({ error: "Invalid request payload." });
    }
    // --- END SECURITY FIX ---

    const { model: rawModel, messages, temperature, max_tokens, stream, enableSearchGrounding } = req.body;

    // --- SECURITY FIX: IGNORE CLIENT-SIDE API KEY OVERRIDE ---
    // API keys are now strictly loaded from environment variables
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || "";
    const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
    // --- END SECURITY FIX ---

    const actualModelUsed = sanitizeAndResolveModel(rawModel);

    // 1. Google Search Grounding flow using @google/genai with server-side GEMINI_API_KEY
    if (enableSearchGrounding) {
      if (!geminiKey) {
        return res.status(401).json({
          error: "Missing Gemini API Key: Google Search Grounding requires process.env.GEMINI_API_KEY to be configured.",
        });
      }

      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({
          apiKey: geminiKey,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });

        let targetModel = "gemini-3.7-flash";
        if (actualModelUsed && (actualModelUsed.includes("3.7-flash") || actualModelUsed.includes("3.7"))) {
          targetModel = "gemini-3.7-flash";
        } else if (actualModelUsed && (actualModelUsed.includes("2.5-flash") || actualModelUsed.includes("2.5"))) {
          targetModel = "gemini-2.5-flash";
        } else if (actualModelUsed && (actualModelUsed.startsWith("gemini-") || actualModelUsed.startsWith("google/gemini"))) {
          targetModel = actualModelUsed.replace("google/", "");
        }

        const systemMsg = messages?.find((m: any) => m.role === "system")?.content || "";
        const userMsgs = messages?.filter((m: any) => m.role !== "system") || [];
        const contentsStr = userMsgs
          .map((m: any) => {
            if (typeof m.content === "string") return m.content;
            if (Array.isArray(m.content)) {
              return m.content.map((part: any) => part.text || "").filter(Boolean).join("\n");
            }
            return JSON.stringify(m.content);
          })
          .join("\n\n");

        const config: any = {
          temperature: temperature !== undefined ? temperature : 0.7,
          tools: [{ googleSearch: {} }],
        };
        if (systemMsg) config.systemInstruction = systemMsg;
        if (max_tokens) config.maxOutputTokens = Math.min(max_tokens, 8192);

        if (stream) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          const streamResult = await ai.models.generateContentStream({
            model: targetModel,
            contents: contentsStr || "Hello",
            config,
          });

          let collectedGrounding: any = null;

          for await (const chunk of streamResult) {
            if (chunk.text) {
              const sseData = JSON.stringify({
                choices: [
                  {
                    delta: { content: chunk.text },
                    finish_reason: null,
                    index: 0,
                  },
                ],
                model: targetModel,
              });
              res.write(`data: ${sseData}\n\n`);
            }

            if (chunk.candidates?.[0]?.groundingMetadata) {
              const meta = chunk.candidates[0].groundingMetadata;
              collectedGrounding = {
                queries: meta.webSearchQueries || [],
                sources: (meta.groundingChunks || [])
                  .map((c: any) => ({
                    title: c.web?.title || "Web Source",
                    url: c.web?.uri || "",
                  }))
                  .filter((s: any) => s.url),
              };
            }
          }

          if (collectedGrounding) {
            const sseGrounding = JSON.stringify({
              choices: [
                {
                  delta: { content: "", grounding: collectedGrounding },
                  finish_reason: null,
                  index: 0,
                },
              ],
              model: targetModel,
            });
            res.write(`data: ${sseGrounding}\n\n`);
          }

          res.write("data: [DONE]\n\n");
          return res.end();
        } else {
          const result = await ai.models.generateContent({
            model: targetModel,
            contents: contentsStr || "Hello",
            config,
          });
          const text = result.text || "";
          const meta = result.candidates?.[0]?.groundingMetadata;
          const grounding = meta
            ? {
                queries: meta.webSearchQueries || [],
                sources: (meta.groundingChunks || [])
                  .map((c: any) => ({
                    title: c.web?.title || "Web Source",
                    url: c.web?.uri || "",
                  }))
                  .filter((s: any) => s.url),
              }
            : undefined;

          return res.json({
            choices: [
              {
                message: { role: "assistant", content: text },
                grounding,
              },
            ],
            model: targetModel,
          });
        }
      } catch (err: any) {
        console.error("[API Proxy] Search Grounding Error:", err);
        return res.status(500).json({ error: err.message || "Search Grounding failed." });
      }
    }

    let response: any = null;

    // 2. OpenRouter request using server-side OPENROUTER_API_KEY
    if (openrouterKey && openrouterKey.startsWith("sk-or-")) {
      try {
        const body: any = { model: actualModelUsed, messages, stream };
        if (temperature !== undefined) body.temperature = temperature;
        if (max_tokens !== undefined) body.max_tokens = max_tokens;

        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterKey}`,
            "HTTP-Referer": "https://ai.studio/build",
            "X-Title": "AI Council Chamber",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok && (response.status === 401 || response.status === 403 || response.status === 402)) {
          console.warn(`[API Proxy] OpenRouter returned HTTP ${response.status}. Falling back to Gemini API...`);
          response = null;
        }
      } catch (err) {
        console.warn("[API Proxy] OpenRouter request failed, falling back to Gemini API:", err);
        response = null;
      }
    }

    // 3. Fallback to Google Gemini API using server-side GEMINI_API_KEY
    if (!response) {
      if (!geminiKey) {
        return res.status(401).json({
          error: "Missing API Key: Server environment variables process.env.OPENROUTER_API_KEY or process.env.GEMINI_API_KEY must be configured.",
        });
      }

      try {
        const geminiTargetModel = "gemini-3.7-flash";
        const body: any = {
          model: geminiTargetModel,
          messages,
          stream,
        };
        if (temperature !== undefined) body.temperature = temperature;
        if (max_tokens !== undefined) body.max_tokens = Math.min(max_tokens, 8192);

        response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${geminiKey}`,
          },
          body: JSON.stringify(body),
        });

        // Fallback to gemini-2.5-flash if 3.7 returns 404 in current endpoint
        if (!response.ok && (response.status === 404 || response.status === 400)) {
          body.model = "gemini-2.5-flash";
          response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${geminiKey}`,
            },
            body: JSON.stringify(body),
          });
        }
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
      res.write("data: [DONE]\n\n");
      return res.end();
    } else {
      const data = await response.json();
      return res.json(data);
    }
  });

  app.get("/api/council/models", async (req, res) => {
    try {
      const response = await fetch(`https://openrouter.ai/api/v1/models`);
      const data = await response.json();
      if (data && Array.isArray(data.data)) {
        // Filter out unverified community user uploads (~), batch pricing endpoints (:batch), and placeholders
        data.data = data.data.filter((m: any) => {
          if (!m || !m.id) return false;
          const id = m.id.toLowerCase();
          if (id.startsWith("~") || id.includes("/~")) return false;
          if (id.includes(":batch")) return false;
          if (id === "openrouter/auto" || id === "openrouter/free") return false;
          return true;
        });
      }
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/council/account", async (req, res) => {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim() || "";

    if (!apiKey || !apiKey.startsWith("sk-or-")) {
      return res.json({
        data: {
          label: "Google Gemini API (Server Active)",
          limit: null,
          usage: 0,
          is_free_tier: true,
        },
      });
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (!response.ok) {
        return res.json({
          data: {
            label: "Google Gemini API (Server Active)",
            limit: null,
            usage: 0,
            is_free_tier: true,
          },
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
