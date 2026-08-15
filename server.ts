import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { z } from "zod";
import JSZip from "jszip";
import { createExtractorFromData } from "node-unrar-js";
import { decideWebUse, buildWebGroundingSystemPrompt } from "./src/lib/webPolicy";
import { resolveOpenRouterCandidate, isLocalOnlyModel, OPENROUTER_MODEL_ALIASES } from "./src/shared/modelCandidates";
import { parseWebMode, WebMode } from "./src/shared/webGrounding";
import {
  isIgnoredArchiveEntry,
  isTextContent,
  isLikelyCode,
  buildCodebaseContext,
  MAX_EXTRACTED_FILES,
  MAX_FILE_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
} from "./src/lib/zipReader";

dotenv.config();

// --- Input Validation Schemas ---
const imagePartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({ url: z.string().max(10000000, "Image URL too long") }),
});

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1, "Text content cannot be empty").max(3000000, "Text content too long"),
});

const contentPartSchema = z.discriminatedUnion("type", [textPartSchema, imagePartSchema]);

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([
    z.string().min(1, "Message content cannot be empty").max(3000000, "Message content too long"),
    z.array(contentPartSchema).min(1, "Message content array cannot be empty").max(50, "Too many content parts"),
  ]),
});

const llmRequestSchema = z.object({
  model: z.string().min(2, "Model ID too short").max(120, "Model ID too long"),
  messages: z.array(messageSchema).min(1, "Messages array cannot be empty").max(100, "Too many messages"),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().min(1).max(32768).optional(),
  stream: z.boolean().optional(),
  budget: z.enum(["free", "cheap", "quality"]).optional(),
  webMode: z.enum(["off", "auto", "always"]).optional(),
  enableWebGrounding: z.boolean().optional(),
  enableSearchGrounding: z.boolean().optional(),
  query: z.string().optional(),
  disableFallback: z.boolean().optional(),
  apiKey: z.string().optional(),
});

const ALLOWED_MODEL_PATTERN =
  /^(google\/[a-z0-9.-]+|anthropic\/[a-z0-9.-]+|openai\/[a-z0-9.-]+|deepseek\/[a-z0-9.-]+|meta-llama\/[a-z0-9.-]+|nvidia\/[a-z0-9.-]+|qwen\/[a-z0-9.-]+|mistralai\/[a-z0-9.-]+|poolside\/[a-z0-9.-]+|inclusionai\/[a-z0-9.-]+|[a-z0-9.-]+)(:[a-z0-9._-]+)?$/i;
// --- END Input Validation Schemas ---

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // 50MB limit for codebase archive uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

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
    "gemini": "google/gemini-2.5-flash",
    "gemini flash": "google/gemini-2.5-flash",
    "gemini-flash": "google/gemini-2.5-flash",
    "gemini pro": "google/gemini-2.5-pro",
    "gemini-pro": "google/gemini-2.5-pro",
    "claude sonnet": "anthropic/claude-3.7-sonnet",
    "claude-sonnet": "anthropic/claude-3.7-sonnet",
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

  function normalizeModelName(value: string): string {
    let trimmed = value.trim();
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

    return trimmed.replace(/^["']|["']$/g, "").trim();
  }

  // Model catalog cache
  let cachedCatalog: { timestamp: number; data: any } | null = null;
  const CATALOG_TTL_MS = 10 * 60 * 1000;

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/council/extract-archive", async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    try {
      const { filename, dataBase64 } = req.body;
      if (!filename || !dataBase64) {
        return res.status(400).json({ error: "Missing filename or dataBase64 payload." });
      }

      const buffer = Buffer.from(dataBase64, "base64");
      if (buffer.length > 50_000_000) {
        return res.status(400).json({ error: "Archive exceeds the 50MB safety ceiling." });
      }

      const lowerName = filename.toLowerCase();
      const isRar = lowerName.endsWith(".rar");

      const extractedFiles: {
        path: string;
        name: string;
        size: number;
        content: string;
        isCode: boolean;
        truncated?: boolean;
      }[] = [];
      const fileTree: string[] = [];
      const warnings: string[] = [];
      let wasTruncated = false;
      let totalExtractedChars = 0;
      let fileCount = 0;

      if (isRar) {
        const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const extractor = await createExtractorFromData({ data: arrayBuf });
        const extracted = extractor.extract();

        for (const item of extracted.files) {
          const header = item.fileHeader;
          const relativePath = header.name;
          if (header.flags.directory || isIgnoredArchiveEntry(relativePath)) {
            continue;
          }

          fileTree.push(relativePath);

          if (fileCount >= MAX_EXTRACTED_FILES) {
            warnings.push(`Extraction capped at ${MAX_EXTRACTED_FILES} files limit.`);
            wasTruncated = true;
            break;
          }

          if (totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS) {
            warnings.push(`Total context limit of ${MAX_TOTAL_CONTEXT_CHARS.toLocaleString()} characters reached.`);
            wasTruncated = true;
            break;
          }

          const fname = relativePath.split(/[/\\]/).pop() || relativePath;
          const ext = fname.split(".").pop()?.toLowerCase() || "";

          if (item.extraction) {
            let content = Buffer.from(item.extraction).toString("utf-8");
            if (isTextContent(content)) {
              let isFileTruncated = false;
              if (content.length > MAX_FILE_CHARS) {
                content = content.slice(0, MAX_FILE_CHARS) + `\n\n... [FILE TRUNCATED AFTER ${MAX_FILE_CHARS.toLocaleString()} CHARS]`;
                isFileTruncated = true;
                wasTruncated = true;
                warnings.push(`File ${relativePath} truncated at ${MAX_FILE_CHARS.toLocaleString()} chars.`);
              }

              if (totalExtractedChars + content.length > MAX_TOTAL_CONTEXT_CHARS) {
                const remaining = MAX_TOTAL_CONTEXT_CHARS - totalExtractedChars;
                if (remaining > 200) {
                  content = content.slice(0, remaining) + `\n\n... [TOTAL CONTEXT LIMIT REACHED]`;
                  extractedFiles.push({
                    path: relativePath,
                    name: fname,
                    size: content.length,
                    content,
                    isCode: isLikelyCode(fname, content),
                    truncated: true,
                  });
                  totalExtractedChars += content.length;
                }
                wasTruncated = true;
                warnings.push(`Total context limit reached at ${relativePath}.`);
                break;
              }

              extractedFiles.push({
                path: relativePath,
                name: fname,
                size: content.length,
                content,
                isCode: isLikelyCode(fname, content),
                truncated: isFileTruncated,
              });

              totalExtractedChars += content.length;
              fileCount++;
            }
          }
        }
      } else {
        // ZIP extraction
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(buffer);
        const entries = Object.keys(loadedZip.files);

        for (const relativePath of entries) {
          const entry = loadedZip.files[relativePath];
          if (entry.dir || isIgnoredArchiveEntry(relativePath)) {
            continue;
          }

          fileTree.push(relativePath);

          if (fileCount >= MAX_EXTRACTED_FILES) {
            warnings.push(`Extraction capped at ${MAX_EXTRACTED_FILES} files limit.`);
            wasTruncated = true;
            break;
          }

          if (totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS) {
            warnings.push(`Total context limit of ${MAX_TOTAL_CONTEXT_CHARS.toLocaleString()} characters reached.`);
            wasTruncated = true;
            break;
          }

          const fname = relativePath.split(/[/\\]/).pop() || relativePath;

          try {
            let content = await entry.async("string");
            if (isTextContent(content)) {
              let isFileTruncated = false;
              if (content.length > MAX_FILE_CHARS) {
                content = content.slice(0, MAX_FILE_CHARS) + `\n\n... [FILE TRUNCATED AFTER ${MAX_FILE_CHARS.toLocaleString()} CHARS]`;
                isFileTruncated = true;
                wasTruncated = true;
                warnings.push(`File ${relativePath} truncated at ${MAX_FILE_CHARS.toLocaleString()} chars.`);
              }

              if (totalExtractedChars + content.length > MAX_TOTAL_CONTEXT_CHARS) {
                const remaining = MAX_TOTAL_CONTEXT_CHARS - totalExtractedChars;
                if (remaining > 200) {
                  content = content.slice(0, remaining) + `\n\n... [TOTAL CONTEXT LIMIT REACHED]`;
                  extractedFiles.push({
                    path: relativePath,
                    name: fname,
                    size: content.length,
                    content,
                    isCode: isLikelyCode(fname, content),
                    truncated: true,
                  });
                  totalExtractedChars += content.length;
                }
                wasTruncated = true;
                warnings.push(`Total context limit reached at ${relativePath}.`);
                break;
              }

              extractedFiles.push({
                path: relativePath,
                name: fname,
                size: content.length,
                content,
                isCode: isLikelyCode(fname, content),
                truncated: isFileTruncated,
              });

              totalExtractedChars += content.length;
              fileCount++;
            }
          } catch (err) {
            console.warn(`Could not read file ${relativePath}:`, err);
          }
        }
      }

      const formattedContext = buildCodebaseContext(
        filename,
        fileTree,
        extractedFiles,
        warnings,
        isRar ? "rar" : "zip"
      );

      res.json({
        filename,
        archiveType: isRar ? "rar" : "zip",
        totalFiles: fileTree.length,
        extractedCodeFilesCount: extractedFiles.length,
        fileTree,
        files: extractedFiles,
        formattedContext,
        warnings,
        wasTruncated,
      });
    } catch (error: any) {
      console.error("[extract-archive] Error extracting archive:", error);
      res.status(500).json({ error: error.message || "Failed to extract archive" });
    }
  });

  app.post("/api/council", async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    // Server-side input validation
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

    const {
      model: rawModel,
      messages,
      temperature,
      max_tokens,
      stream,
      budget,
      webMode,
      enableWebGrounding,
      enableSearchGrounding,
      query: rawQuery,
      disableFallback,
      apiKey: clientApiKey,
    } = req.body;

    const rawOpenRouterKey =
      (req.headers.authorization?.replace(/^Bearer\s+/i, "") || "").trim() ||
      (typeof clientApiKey === "string" ? clientApiKey.trim() : "") ||
      process.env.OPENROUTER_API_KEY?.trim() ||
      "";
    const openrouterKey = rawOpenRouterKey.replace(/^["']|["']$/g, "").trim();

    const rawGeminiKey = process.env.GEMINI_API_KEY?.trim() || "";
    const geminiKey = rawGeminiKey.replace(/^["']|["']$/g, "").trim();

    const isNoFallback = Boolean(
      disableFallback ||
      req.headers["x-disable-fallback"] === "true" ||
      budget === "free"
    );

    const userQueryText =
      rawQuery ||
      (messages.slice().reverse().find((m: any) => m.role === "user")?.content as string) ||
      "";
    const userQueryStr = typeof userQueryText === "string" ? userQueryText : JSON.stringify(userQueryText);

    // Determine Web Grounding Policy
    const effectiveMode: WebMode = parseWebMode(
      webMode,
      enableWebGrounding !== undefined
        ? enableWebGrounding
          ? "always"
          : "off"
        : enableSearchGrounding
        ? "always"
        : "auto"
    );

    const webDecision = decideWebUse({ mode: effectiveMode, query: userQueryStr });
    const isWebActive = webDecision.enabled;

    // --- Branch A: OpenRouter Web Grounding Flow ---
    if (isWebActive) {
      if (isLocalOnlyModel(rawModel)) {
        return res.status(400).json({
          error: "WEB_GROUNDING_UNAVAILABLE: Local-only models cannot access OpenRouter web grounding.",
        });
      }

      const openrouterCandidate = resolveOpenRouterCandidate(rawModel) || normalizeModelName(rawModel);
      if (!openrouterCandidate || isLocalOnlyModel(openrouterCandidate)) {
        return res.status(400).json({
          error: `WEB_GROUNDING_UNAVAILABLE: Model '${rawModel}' has no production OpenRouter candidate for web grounding.`,
        });
      }

      if (!openrouterKey || openrouterKey.length < 6) {
        return res.status(503).json({
          error:
            "WEB_GROUNDING_UNAVAILABLE: Web grounding requires an OpenRouter API key (OPENROUTER_API_KEY) configured in the server environment or passed in settings.",
        });
      }

      // Inject current UTC date, untrusted web data rules, and citation requirements
      const webInstruction = buildWebGroundingSystemPrompt(webDecision.currentDate, true);
      const webMessages = messages.map((m: any) => ({ ...m }));
      const sysIdx = webMessages.findIndex((m: any) => m.role === "system");
      if (sysIdx >= 0) {
        const prev = typeof webMessages[sysIdx].content === "string" ? webMessages[sysIdx].content : "";
        webMessages[sysIdx].content = `${prev}${webInstruction}`;
      } else {
        webMessages.unshift({
          role: "system",
          content: `You are a thoughtful council deliberator.${webInstruction}`,
        });
      }

      const body: any = {
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
      if (temperature !== undefined) body.temperature = temperature;
      if (max_tokens !== undefined) body.max_tokens = max_tokens;

      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterKey}`,
            "HTTP-Referer": "https://ai.studio/build",
            "X-Title": "AI Council Chamber Web Grounding",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text();
          // DO NOT silently fall back to non-web direct APIs
          return res.status(response.status).json({
            error: `OpenRouter Web Grounding Error (${response.status}): ${errText}`,
          });
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
            } catch (streamErr) {
              console.error("[API Proxy] Web grounding stream error:", streamErr);
            }
          }
          res.write("data: [DONE]\n\n");
          return res.end();
        } else {
          const data = await response.json();
          return res.json(data);
        }
      } catch (networkErr: any) {
        return res.status(502).json({
          error: `OpenRouter Web Grounding Network Error: ${networkErr.message || "Failed to reach OpenRouter"}`,
        });
      }
    }

    const actualModelUsed = normalizeModelName(rawModel);

    // Validate model pattern
    if (!ALLOWED_MODEL_PATTERN.test(actualModelUsed)) {
      return res.status(400).json({ error: `Unsupported model identifier: ${rawModel}` });
    }

    // Free budget constraint: require OpenRouter key and do not silently fall back to Gemini
    if (budget === "free") {
      if (!openrouterKey || openrouterKey.length < 6) {
        return res.status(503).json({
          error: "Free mode requires an OpenRouter key configured in environment or settings.",
        });
      }
    }

    // --- Branch B: Standard Direct Google Search Grounding (if explicitly opted for Google native) ---
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
    if (openrouterKey && openrouterKey.length >= 6) {
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

        if (!response.ok) {
          if (isNoFallback) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: `OpenRouter API Error (${response.status}): ${errorText}` });
          }
          if (response.status === 401 || response.status === 403 || response.status === 402) {
            console.warn(`[API Proxy] OpenRouter returned HTTP ${response.status}. Falling back to Gemini API...`);
            response = null;
          }
        }
      } catch (err: any) {
        if (isNoFallback) {
          return res.status(502).json({ error: `OpenRouter connection failed: ${err.message || "Unknown network error"}` });
        }
        console.warn("[API Proxy] OpenRouter request failed, falling back to Gemini API:", err);
        response = null;
      }
    }

    // 3. Fallback to Google Gemini API using server-side GEMINI_API_KEY (for quality/paid budget only)
    if (!response) {
      if (isNoFallback) {
        return res.status(503).json({
          error: "No fallback allowed: Primary model failed or no valid OpenRouter key configured.",
        });
      }

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
    const now = Date.now();
    if (cachedCatalog && now - cachedCatalog.timestamp < CATALOG_TTL_MS) {
      return res.json(cachedCatalog.data);
    }

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
      cachedCatalog = { timestamp: now, data };
      res.json(data);
    } catch (err: any) {
      if (cachedCatalog) {
        return res.json(cachedCatalog.data);
      }
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

  // Smoke test endpoint verifying real OpenRouter web-plugin connectivity
  app.all("/api/council/smoke-test-web", async (req, res) => {
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || "";
    if (!openrouterKey || !openrouterKey.startsWith("sk-or-")) {
      return res.status(503).json({
        success: false,
        error: "WEB_GROUNDING_UNAVAILABLE: Server OPENROUTER_API_KEY is not configured.",
      });
    }

    try {
      const now = new Date();
      const currentDate = now.toISOString().slice(0, 10);
      const testPrompt = buildWebGroundingSystemPrompt(currentDate, true);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterKey}`,
          "HTTP-Referer": "https://ai.studio/build",
          "X-Title": "AI Council Web Grounding Smoke Test",
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-001",
          messages: [
            {
              role: "system",
              content: `You are a helpful council assistant.${testPrompt}`,
            },
            {
              role: "user",
              content: "What is today's date in UTC and what is an active major world technology event this week? Search the web and cite sources.",
            },
          ],
          tools: [
            {
              type: "openrouter:web_search",
              parameters: {
                max_results: 3,
              },
            },
          ],
          max_tokens: 350,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: `OpenRouter returned HTTP ${response.status}: ${errText}`,
        });
      }

      const data = await response.json();
      return res.json({
        success: true,
        modelUsed: data.model || "google/gemini-2.0-flash-001",
        content: data.choices?.[0]?.message?.content,
        toolsUsed: [{ type: "openrouter:web_search", max_results: 3 }],
        currentDate,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to execute smoke test",
      });
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
