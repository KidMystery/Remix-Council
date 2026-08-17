import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { z } from "zod";
import JSZip from "jszip";
import { createExtractorFromData } from "node-unrar-js";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import config from "./firebase-applet-config.json";
import {
  isIgnoredArchiveEntry,
  isTextContent,
  isLikelyCode,
  buildCodebaseContext,
  MAX_EXTRACTED_FILES,
  MAX_FILE_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
} from "./src/lib/zipUtils";
import { validateAndParseGitHubUrl } from "./src/lib/githubValidator";

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
  query: z.string().optional(),
  disableFallback: z.boolean().optional(),
  apiKey: z.string().optional(),
  webSearch: z.boolean().optional(),
  tools: z.array(z.any()).optional(),
});

const ALLOWED_MODEL_PATTERN = /^([a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)(:[a-z0-9._-]+)?$/i;
// --- END Input Validation Schemas ---

/**
 * Safely parse and validate the server port.
 * Accepts numeric or string inputs from process.env.PORT (e.g. injected by Railway),
 * falling back to 3000 for local development.
 */
export function resolvePort(rawPort?: string | number | undefined): number {
  if (rawPort !== undefined && rawPort !== null && rawPort !== "") {
    const parsed = typeof rawPort === "number" ? rawPort : parseInt(String(rawPort).trim(), 10);
    if (!isNaN(parsed) && Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
    console.warn(`[Server] Invalid PORT value provided ("${rawPort}"). Falling back to port 3000.`);
  }
  return 3000;
}

export async function startServer(portOverride?: number) {
  if (!getApps().length) {
    const serverProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || config.projectId;
    initializeApp({
      projectId: serverProjectId,
    });
    console.log(`[Server] Firebase Admin initialized with Project ID: ${serverProjectId}`);
  }

  const app = express();
  const PORT = portOverride !== undefined ? resolvePort(portOverride) : resolvePort(process.env.PORT);

  // Public health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // 50MB limit for codebase archive uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const requireOwnerAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Railway acceptable alternative: fallback to a high-entropy secret if set
    const railwaySecret = process.env.COUNCIL_ACCESS_SECRET?.trim();
    const clientSecret = typeof req.headers["x-council-access-secret"] === "string" ? req.headers["x-council-access-secret"].trim() : "";
    if (railwaySecret && clientSecret && clientSecret === railwaySecret) {
      return next();
    }

    const authHeader = req.headers["x-firebase-token"];
    if (!authHeader || typeof authHeader !== "string") {
      return res.status(401).json({ error: "Unauthorized: Missing Firebase ID token or Access Secret" });
    }

    try {
      const decodedToken = await getAuth().verifyIdToken(authHeader);
      const ownerEmail = process.env.OWNER_EMAIL?.trim();
      const ownerUid = process.env.OWNER_UID?.trim();

      // Fail closed in production if neither owner UID nor owner email is configured
      if (!ownerEmail && !ownerUid) {
        if (process.env.NODE_ENV === "production") {
          return res.status(403).json({
            error: "Forbidden: Server owner identity is not configured. Please set OWNER_UID or OWNER_EMAIL in the server environment.",
          });
        }
      } else {
        if (ownerEmail && (!decodedToken.email || decodedToken.email.toLowerCase() !== ownerEmail.toLowerCase())) {
          return res.status(403).json({ error: "Forbidden: Not the configured owner email" });
        }
        if (ownerUid && decodedToken.uid !== ownerUid) {
          return res.status(403).json({ error: "Forbidden: Not the configured owner UID" });
        }
      }
      
      (req as any).user = decodedToken;
      next();
    } catch (error) {
      console.error("[Auth] Error verifying Firebase token:", error);
      return res.status(401).json({ error: "Unauthorized: Invalid Firebase ID token" });
    }
  };

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

  // Model catalog cache mapped by sort key
  const catalogCache = new Map<string, { timestamp: number; data: any }>();
  const CATALOG_TTL_MS = 10 * 60 * 1000;

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/council/import-github", requireOwnerAuth, async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Missing GitHub repository or file URL." });
    }

    const parsed = validateAndParseGitHubUrl(url);
    if (!parsed.isValid) {
      return res.status(400).json({ error: parsed.error || "Invalid GitHub URL." });
    }

    try {
      if (parsed.isRawFile && parsed.apiUrl) {
        // Fetch raw file from GitHub
        const rawRes = await fetch(parsed.apiUrl, {
          headers: {
            "Accept": "application/vnd.github.v3.raw",
            "User-Agent": "AI-Council-Chamber",
          },
        });

        if (!rawRes.ok) {
          return res.status(rawRes.status).json({
            error: `Failed to fetch GitHub file (${rawRes.status}): ${rawRes.statusText}`,
          });
        }

        const content = await rawRes.text();
        return res.json({
          isRawFile: true,
          owner: parsed.owner,
          repo: parsed.repo,
          ref: parsed.ref,
          path: parsed.path,
          content,
          size: content.length,
        });
      }

      // Fetch repository archive
      const zipUrl = parsed.downloadArchiveUrl || `https://codeload.github.com/${parsed.owner}/${parsed.repo}/zip/refs/heads/${parsed.ref || "main"}`;
      const archiveRes = await fetch(zipUrl, {
        headers: { "User-Agent": "AI-Council-Chamber" },
      });

      if (!archiveRes.ok) {
        return res.status(archiveRes.status).json({
          error: `Failed to download GitHub repository archive (${archiveRes.status}): ${archiveRes.statusText}`,
        });
      }

      const arrayBuffer = await archiveRes.arrayBuffer();
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(arrayBuffer);

      const extractedFiles: any[] = [];
      const fileTree: string[] = [];
      const manifest: any[] = [];
      const omittedFiles: string[] = [];
      const warnings: string[] = [];
      let totalExtractedChars = 0;
      let fileCount = 0;
      let isPartial = false;

      const entries = Object.keys(loadedZip.files).filter((p) => !loadedZip.files[p].dir);

      for (const relativePath of entries) {
        // Remove top-level archive directory prefix (e.g. repo-main/)
        const cleanPath = relativePath.replace(/^[^/]+\//, "");
        fileTree.push(cleanPath);

        const entry = loadedZip.files[relativePath];
        const fname = cleanPath.split("/").pop() || cleanPath;
        const ext = fname.split(".").pop()?.toLowerCase() || "";
        const entrySize = (entry as any)?._data?.uncompressedSize || 0;

        if (isIgnoredArchiveEntry(cleanPath)) {
          manifest.push({
            path: cleanPath,
            size: entrySize,
            type: ext,
            status: "ignored",
            reason: "Build artifact, package lockfile, or ignored pattern",
            extractedChars: 0,
          });
          continue;
        }

        if (fileCount >= MAX_EXTRACTED_FILES || totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS) {
          isPartial = true;
          omittedFiles.push(cleanPath);
          manifest.push({
            path: cleanPath,
            size: entrySize,
            type: ext,
            status: "omitted",
            reason: "Context ceiling reached",
            extractedChars: 0,
          });
          continue;
        }

        try {
          let text = await entry.async("string");
          if (!isTextContent(text)) {
            manifest.push({
              path: cleanPath,
              size: entrySize,
              type: ext,
              status: "binary",
              reason: "Binary content",
              extractedChars: 0,
            });
            continue;
          }

          let isTruncated = false;
          if (text.length > MAX_FILE_CHARS) {
            text = text.slice(0, MAX_FILE_CHARS) + `\n\n... [FILE TRUNCATED]`;
            isTruncated = true;
            isPartial = true;
          }

          if (totalExtractedChars + text.length > MAX_TOTAL_CONTEXT_CHARS) {
            const rem = MAX_TOTAL_CONTEXT_CHARS - totalExtractedChars;
            if (rem > 200) {
              text = text.slice(0, rem) + `\n\n... [TOTAL CONTEXT CEILING REACHED]`;
              extractedFiles.push({
                path: cleanPath,
                name: fname,
                size: text.length,
                content: text,
                isCode: isLikelyCode(fname, text),
                truncated: true,
              });
              totalExtractedChars += text.length;
              manifest.push({
                path: cleanPath,
                size: entrySize,
                type: ext,
                status: "truncated",
                reason: "Context ceiling reached",
                extractedChars: text.length,
              });
            } else {
              omittedFiles.push(cleanPath);
              manifest.push({
                path: cleanPath,
                size: entrySize,
                type: ext,
                status: "omitted",
                reason: "Context ceiling reached",
                extractedChars: 0,
              });
            }
            isPartial = true;
            continue;
          }

          extractedFiles.push({
            path: cleanPath,
            name: fname,
            size: text.length,
            content: text,
            isCode: isLikelyCode(fname, text),
            truncated: isTruncated,
          });

          manifest.push({
            path: cleanPath,
            size: entrySize,
            type: ext,
            status: isTruncated ? "truncated" : "included",
            extractedChars: text.length,
          });

          totalExtractedChars += text.length;
          fileCount++;
        } catch (err: any) {
          manifest.push({
            path: cleanPath,
            size: entrySize,
            type: ext,
            status: "skipped",
            reason: err.message || "Read error",
            extractedChars: 0,
          });
        }
      }

      const formattedContext = buildCodebaseContext(
        `${parsed.owner}/${parsed.repo}`,
        fileTree,
        extractedFiles,
        manifest,
        warnings,
        isPartial,
        omittedFiles,
        totalExtractedChars,
        "zip"
      );

      return res.json({
        filename: `${parsed.owner}/${parsed.repo}`,
        archiveType: "zip",
        totalFiles: entries.length,
        extractedCodeFilesCount: extractedFiles.length,
        fileTree,
        manifest,
        files: extractedFiles,
        formattedContext,
        warnings,
        isPartial,
        totalExtractedChars,
        contextCeiling: MAX_TOTAL_CONTEXT_CHARS,
        omittedFiles,
      });
    } catch (err: any) {
      console.error("[import-github] Error:", err);
      return res.status(500).json({ error: err.message || "Failed to import GitHub repository." });
    }
  });

  app.post("/api/council/extract-archive", requireOwnerAuth, async (req, res) => {
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

      const extractedFiles: any[] = [];
      const fileTree: string[] = [];
      const manifest: any[] = [];
      const omittedFiles: string[] = [];
      const warnings: string[] = [];
      let wasTruncated = false;
      let isPartial = false;
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

          if (fileCount >= MAX_EXTRACTED_FILES || totalExtractedChars >= MAX_TOTAL_CONTEXT_CHARS) {
            isPartial = true;
            omittedFiles.push(relativePath);
            continue;
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
                isPartial = true;
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
                isPartial = true;
                continue;
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
      }

      const formattedContext = buildCodebaseContext(
        filename,
        fileTree,
        extractedFiles,
        manifest,
        warnings,
        isPartial,
        omittedFiles,
        totalExtractedChars,
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
        isPartial,
      });
    } catch (error: any) {
      console.error("[extract-archive] Error extracting archive:", error);
      res.status(500).json({ error: error.message || "Failed to extract archive" });
    }
  });

  app.post("/api/council", requireOwnerAuth, async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }

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
      query: rawQuery,
      disableFallback,
      apiKey: clientApiKey,
      webSearch,
      tools,
    } = req.body;

    const headerAuth = (req.headers.authorization?.replace(/^Bearer\s+/i, "") || "").trim();
    const rawClientKey = typeof clientApiKey === "string" ? clientApiKey.trim() : "";
    const providedKey = (headerAuth || rawClientKey).replace(/^["']|["']$/g, "").trim();

    let openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || "";
    let geminiKey = process.env.GEMINI_API_KEY?.trim() || "";

    if (providedKey) {
      if (providedKey.startsWith("AIza")) {
        geminiKey = providedKey;
      } else {
        openrouterKey = providedKey;
      }
    }

    const isNoFallback = Boolean(
      disableFallback ||
      req.headers["x-disable-fallback"] === "true" ||
      budget === "free"
    );

    const actualModelUsed = normalizeModelName(rawModel);

    // Validate model pattern
    if (!ALLOWED_MODEL_PATTERN.test(actualModelUsed)) {
      return res.status(400).json({ error: `Unsupported model identifier: ${rawModel}` });
    }

    // Free budget constraint: require OpenRouter key and strictly forbid paid/unknown models & Gemini fallback
    if (budget === "free") {
      if (!openrouterKey || openrouterKey.length < 6) {
        return res.status(503).json({
          error: "Free mode requires an OpenRouter key configured in environment or settings.",
        });
      }

      if (webSearch) {
        return res.status(400).json({
          error: "Web search grounding is not available under Strict Free budget.",
        });
      }
    }

    let response: any = null;

    // OpenRouter request using server-side OPENROUTER_API_KEY
    if (openrouterKey && openrouterKey.length >= 6) {
      try {
        const body: any = {
          model: actualModelUsed,
          messages,
          stream,
        };

        if (stream) {
          body.stream_options = { include_usage: true };
        }

        if (temperature !== undefined) body.temperature = temperature;
        if (max_tokens !== undefined) body.max_tokens = max_tokens;

        if (webSearch && budget !== "free") {
          body.tools = tools || [
            {
              type: "openrouter:web_search",
              parameters: {
                max_results: 5,
                max_uses: 2,
                max_total_results: 10,
                search_context_size: "medium",
              },
            },
          ];
        }

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
          console.warn(`[API Proxy] OpenRouter returned HTTP ${response.status}. Falling back to Gemini API...`);
          response = null;
        }
      } catch (err: any) {
        if (isNoFallback) {
          return res.status(502).json({ error: `OpenRouter connection failed: ${err.message || "Unknown network error"}` });
        }
        console.warn("[API Proxy] OpenRouter request failed, falling back to Gemini API:", err);
        response = null;
      }
    }

    // Fallback to Google Gemini API using server-side GEMINI_API_KEY (for quality/paid budget only)
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
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "Too many requests. Please try again in a moment." });
    }

    const sortParam = typeof req.query.sort === "string" ? req.query.sort.trim() : "";
    const cacheKey = sortParam ? `sort_${sortParam}` : "default";
    const now = Date.now();

    const cached = catalogCache.get(cacheKey);
    if (cached && now - cached.timestamp < CATALOG_TTL_MS) {
      return res.json(cached.data);
    }

    try {
      const url = sortParam
        ? `https://openrouter.ai/api/v1/models?sort=${encodeURIComponent(sortParam)}`
        : `https://openrouter.ai/api/v1/models`;

      const response = await fetch(url);
      const data = await response.json();
      if (data && Array.isArray(data.data)) {
        data.data = data.data.filter((m: any) => {
          if (!m || !m.id) return false;
          const id = m.id.toLowerCase();
          if (id.startsWith("~") || id.includes("/~")) return false;
          if (id.includes(":batch")) return false;
          if (id === "openrouter/auto" || id === "openrouter/free") return false;
          return true;
        });
      }
      catalogCache.set(cacheKey, { timestamp: now, data });
      res.json(data);
    } catch (err: any) {
      if (cached) {
        return res.json(cached.data);
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/council/account", requireOwnerAuth, async (req, res) => {
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

  return new Promise<import("http").Server>((resolve) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT} (PORT=${PORT}, process.env.PORT=${process.env.PORT || "undefined"})`);
      resolve(server);
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
