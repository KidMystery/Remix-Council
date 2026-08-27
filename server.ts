import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { GoogleGenAI, Modality } from '@google/genai';
import { allocateCouncilSeats } from './src/lib/serverModelAllocator';
import { isOpenRouterRouterId, pickBestFromCatalog, type ModelTier } from './src/lib/modelScoring';
import { extractRoutedModelFromSSE } from './src/lib/autoRouter';
import { RoundCostLedger, modelRatesUSD, usageCostUSD, extractUsageFromSSEChunk } from './src/lib/costGovernor';
import {
  AgentLoopRunner,
  sanitizeAgentSpec,
  newAgentJobId,
  redactAgentJob,
  DEFAULT_MAX_JOB_COST_USD,
  type AgentJob,
} from './src/server/agentLoop';

// Works under both ESM (tsx dev) and the CJS production bundle (esbuild).
const __filename =
  typeof __dirname !== 'undefined'
    ? path.join(__dirname, 'server.ts')
    : fileURLToPath(import.meta.url);
const serverDirname = path.dirname(__filename);

export function resolvePort(raw?: string | number): number {
  const p = typeof raw === 'number' ? raw : parseInt(String(raw || ''), 10);
  return !isNaN(p) && p > 0 && p <= 65535 ? p : 3000;
}

const PORT = resolvePort(process.env.PORT);

// Lazy Gemini GenAI client initialization
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY is not configured on the server.');
    }
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

// Packages raw 16-bit linear PCM audio into a standard 44-byte WAV container
function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

const TtsRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  voice: z.enum(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']).optional(),
});

// Model validation pattern: allows standard provider/model(:variant) formats
const ALLOWED_MODEL_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)?$/;

// Deliberation payload schema
const CouncilRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.string(),
      // content may be a plain string or a multimodal content-part array
      // (e.g. [{ type: 'text', text }, { type: 'image_url', image_url }]).
      content: z.union([z.string(), z.array(z.any())]),
    })
  ),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  budget: z.enum(['free', 'cheap', 'quality']).optional(),
  stream: z.boolean().optional(),
  tools: z.array(z.any()).optional(),
  // Cost governor: when the client sends both, the server enforces the
  // per-round ceiling using REAL usage, independent of the client bundle.
  roundKey: z.string().max(160).optional(),
  costCeilingUSD: z.number().positive().max(1000).optional(),
  /** OpenRouter Auto: family filters + cost band. Ignored for concrete models. */
  plugins: z.array(z.any()).optional(),
  session_id: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// In-memory per-IP rate limiter (fixed window). Personal-use scale: enough to
// stop casual abuse of the money route without external infra.
// ---------------------------------------------------------------------------
interface RateBucket {
  windowStart: number;
  count: number;
}
const rateBuckets = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT = 60; // requests / minute / IP

function getRateLimit(): number {
  const raw = parseInt(String(process.env.RATE_LIMIT_PER_MINUTE || ''), 10);
  return !isNaN(raw) && raw > 0 ? raw : DEFAULT_RATE_LIMIT;
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count++;
  // Periodically prune stale buckets to bound memory.
  if (rateBuckets.size > 10_000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.windowStart >= RATE_WINDOW_MS) rateBuckets.delete(k);
    }
  }
  return bucket.count > getRateLimit();
}

// In-memory catalog cache (10 minute TTL)
let cachedCatalog: any[] | null = null;
let lastCatalogFetchTime = 0;

// Server-side cost governor ledger: real per-round spend, independent of the
// client bundle. Enforced in the /api/council route when a roundKey + ceiling arrive.
const roundCostLedger = new RoundCostLedger();
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Owner gate: when OWNER_EMAIL is set, only a verified Google identity may hit
// the money route. Verification is cached in-memory (5 min) per token.
// ---------------------------------------------------------------------------
interface OwnerVerifyCacheEntry {
  email: string;
  expiresAt: number;
}
const ownerVerifyCache = new Map<string, OwnerVerifyCacheEntry>();
const OWNER_VERIFY_TTL_MS = 5 * 60 * 1000;

async function resolveTokenEmail(token: string): Promise<string | null> {
  const cached = ownerVerifyCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.email;

  // 1. Try googleapis userinfo endpoint
  try {
    const resp = await fetch(
      `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${encodeURIComponent(token)}`
    );
    if (resp.ok) {
      const data = await resp.json();
      const email = (data?.email as string) || null;
      if (email) {
        ownerVerifyCache.set(token, { email, expiresAt: Date.now() + OWNER_VERIFY_TTL_MS });
        return email;
      }
    }
  } catch {
    // Continue to Drive endpoint fallback
  }

  // 2. Try Google Drive about endpoint (succeeds when token holds Drive permissions)
  try {
    const driveResp = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (driveResp.ok) {
      const driveData = await driveResp.json();
      const email = (driveData?.user?.emailAddress as string) || null;
      if (email) {
        ownerVerifyCache.set(token, { email, expiresAt: Date.now() + OWNER_VERIFY_TTL_MS });
        return email;
      }
    }
  } catch {
    // Both endpoints failed
  }

  return null;
}

export async function startServer(portOverride?: number) {
  const app = express();
  const activePort = resolvePort(portOverride ?? process.env.PORT);

  // 1. Health check route (unauthenticated, vital for Railway deployment readiness)
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // 2. Council access key gate (applies to every /api/council route, not /api/health)
  const COUNCIL_ACCESS_KEY = (process.env.COUNCIL_ACCESS_KEY || process.env.COUNCIL_ACCESS_SECRET)?.trim() || '';

  const requireCouncilAuth = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (COUNCIL_ACCESS_KEY) {
      const clientKey = req.header('x-council-key') || '';
      if (clientKey !== COUNCIL_ACCESS_KEY) {
        return res.status(401).json({ error: 'Invalid council access key.' });
      }
      return next();
    }
    // No key configured — allow (public development mode).
    return next();
  };

  // 2b. Rate limiter middleware for the money route + catalog.
  const requireRateLimit = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    return next();
  };

  // 2c. Owner gate middleware — when OWNER_EMAIL is configured, verify the
  // caller's Google identity token before allowing access to the money route.
  const configuredOwnerEmails = (process.env.OWNER_EMAIL || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const allowedOwnerEmails = new Set<string>([
    ...configuredOwnerEmails,
    'kamau.asphall@gmail.com',
    'kda11deuce@gmail.com',
  ]);

  const requireOwnerGate = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    // If a valid shared council key is provided, bypass owner token requirement
    if (COUNCIL_ACCESS_KEY) {
      const clientKey = req.header('x-council-key') || '';
      if (clientKey && clientKey === COUNCIL_ACCESS_KEY) {
        return next();
      }
    }

    if (allowedOwnerEmails.size === 0) {
      // Not configured — fall through to the shared-key gate (or open dev mode).
      return requireCouncilAuth(req, res, next);
    }

    const token = req.header('x-owner-token') || '';
    if (!token) {
      // If council key was set, require either key or owner token
      if (COUNCIL_ACCESS_KEY) {
        return res.status(401).json({ error: 'Sign in required (owner gate).' });
      }
      return next();
    }

    const email = await resolveTokenEmail(token);
    const normalizedEmail = (email || '').toLowerCase().trim();
    if (!normalizedEmail || !allowedOwnerEmails.has(normalizedEmail)) {
      return res.status(403).json({ error: 'This deployment is restricted to its owner.' });
    }
    return next();
  };

  // 3. Models catalog route with 10-minute in-memory cache + stale fallback
  app.get('/api/council/models', requireRateLimit, async (_req, res) => {
    const now = Date.now();
    if (cachedCatalog && now - lastCatalogFetchTime < CATALOG_CACHE_TTL_MS) {
      return res.json({ data: cachedCatalog, cached: true });
    }
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/models');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      cachedCatalog = data.data || [];
      lastCatalogFetchTime = now;
      return res.json({ data: cachedCatalog, cached: false });
    } catch (err: any) {
      // Return stale cache on upstream failure with a warning field.
      if (cachedCatalog) {
        return res.json({ data: cachedCatalog, cached: true, warning: 'Stale catalog returned' });
      }
      return res.status(502).json({ error: 'Failed to fetch OpenRouter models catalog' });
    }
  });

  // 3b. Model Allocation Endpoint
  app.post('/api/council/allocate', requireRateLimit, async (req, res) => {
    try {
      const AllocationRequestSchema = z.object({
        domain: z.enum(['code', 'math', 'finance', 'creative', 'general']).default('general'),
        budgetTier: z.enum(['free', 'cheap', 'quality']).default('cheap'),
        personas: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), model: z.string().optional() })),
        synthesizer: z.object({ id: z.string(), name: z.string(), role: z.string(), model: z.string().optional() }),
        humanOverrides: z.record(z.string(), z.string()).optional(),
        visionRequired: z.boolean().optional().default(false),
      });

      const parsed = AllocationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid allocation parameters', details: parsed.error.issues });
      }

      // Refresh catalog if needed; a failed refresh falls back to the last
      // cached snapshot (stale-but-working beats a hard 500).
      const now = Date.now();
      if (!cachedCatalog || now - lastCatalogFetchTime > CATALOG_CACHE_TTL_MS) {
        try {
          const resp = await fetch('https://openrouter.ai/api/v1/models');
          if (resp.ok) {
            const data = await resp.json();
            cachedCatalog = data.data || [];
            lastCatalogFetchTime = now;
          }
        } catch (e) {
          console.warn('[council] Catalog refresh failed; using last cached snapshot:', (e as any)?.message);
        }
      }

      const plan = allocateCouncilSeats({
        ...parsed.data,
        catalog: cachedCatalog || [],
      });

      return res.json({ data: plan });
    } catch (err: any) {
      return res.status(500).json({ error: 'Allocation failed', message: err.message });
    }
  });

  // 4. Account balance route
  app.get('/api/council/account', async (_req, res) => {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey || !openrouterKey.startsWith('sk-or-')) {
      return res.json({ data: { limit: null, usage: 0, isDirectKey: true } });
    }

    try {
      // /api/v1/credits reports purchased credit + spend to date. The previous
      // /auth/key endpoint's "limit" is a key spend cap (usually unset), which
      // made the UI display amount *spent* as "remaining". Normalize to plain
      // numbers here so the client can never misparse string values.
      const resp = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${openrouterKey}` },
      });
      if (!resp.ok) {
        return res.status(502).json({ error: `OpenRouter credits fetch failed (${resp.status})` });
      }
      const data = await resp.json();
      const inner = data?.data || {};
      const toNum = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
        return Number.isFinite(n) ? n : null;
      };
      const totalCredits = toNum(inner.total_credits);
      const totalUsage = toNum(inner.total_usage) ?? 0;
      const remaining = totalCredits !== null ? Math.max(0, totalCredits - totalUsage) : null;
      return res.json({
        data: {
          limit: totalCredits,
          usage: totalUsage,
          remaining,
          isDirectKey: false,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch OpenRouter account' });
    }
  });

  // 4b. Studio-Grade Google Neural Text-to-Speech (Gemini Flash TTS)
  app.post('/api/tts', requireRateLimit, async (req, res) => {
    const parseResult = TtsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid TTS request payload', details: parseResult.error.issues });
    }

    const { text, voice = 'Kore' } = parseResult.data;

    // Clean text: strip markdown fences, links, headings, citations, formatting
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' Code snippet omitted. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/^[#*>\-\s]+/gm, '')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) {
      return res.status(400).json({ error: 'No readable speech text provided.' });
    }

    // Limit text to ~2000 characters for high-speed, instant neural generation
    const textToSpeak = cleanText.length > 2000 ? cleanText.substring(0, 2000) + '...' : cleanText;

    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: textToSpeak }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      const base64Audio = part?.inlineData?.data;

      if (!base64Audio) {
        throw new Error('No audio returned from Gemini TTS model.');
      }

      const rawBuffer = Buffer.from(base64Audio, 'base64');
      let wavBase64 = base64Audio;
      // If raw linear PCM, wrap in standard WAV container header
      if (rawBuffer.length < 4 || rawBuffer.toString('utf8', 0, 4) !== 'RIFF') {
        const wavBuffer = pcmToWav(rawBuffer, 24000, 1, 16);
        wavBase64 = wavBuffer.toString('base64');
      }

      return res.json({
        audio: `data:audio/wav;base64,${wavBase64}`,
        voice,
        format: 'audio/wav',
        model: 'gemini-3.1-flash-tts-preview',
      });
    } catch (err: any) {
      console.warn('[Gemini TTS generation error]', err);
      return res.status(500).json({
        error: err?.message || 'Failed to generate speech with Gemini TTS',
        fallbackToWebSpeech: true,
      });
    }
  });

  // 5. Deliberation stream route
  app.post('/api/council', requireRateLimit, requireOwnerGate, async (req, res) => {
    const parseResult = CouncilRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request payload',
        details: parseResult.error.issues,
      });
    }

    const {
      model: rawModel,
      messages,
      temperature,
      max_tokens,
      budget,
      stream,
      tools,
      roundKey,
      costCeilingUSD,
      plugins,
      session_id,
    } = parseResult.data;

    // Input caps: bound message count and total payload size to prevent runaway
    // prompt costs via the proxy.
    if (messages.length > 80) {
      return res.status(400).json({ error: 'Too many messages in the request.' });
    }
    const totalContentChars = messages.reduce((acc, m) => {
      const c = m.content;
      if (typeof c === 'string') return acc + c.length;
      if (Array.isArray(c)) {
        return acc + c.reduce((a, part) => a + (typeof part?.text === 'string' ? part.text.length : 0), 0);
      }
      return acc;
    }, 0);
    if (totalContentChars > 300_000) {
      return res.status(400).json({ error: 'Request content exceeds the 300k character limit.' });
    }

    if (!ALLOWED_MODEL_PATTERN.test(rawModel)) {
      return res.status(400).json({ error: `Unsupported model identifier: ${rawModel}` });
    }

    // Server-side liveness guard: the client validates models against the
    // live catalog, but hand-entered or stale ids can still arrive. When we
    // hold a catalog and the requested model has vanished from OpenRouter,
    // resolve the best live substitute instead of burning the request on a
    // guaranteed 404. Free mode may only be substituted with free models.
    let resolvedModel = rawModel;
    // Router slugs are not catalog endpoints. Substituting them would silently
    // kill Auto and seat a random Flash. Never rewrite them.
    if (cachedCatalog && cachedCatalog.length > 0 && !isOpenRouterRouterId(rawModel)) {
      const liveIds = new Set(cachedCatalog.map((m: any) => String(m?.id || '').toLowerCase()));
      if (!liveIds.has(rawModel.toLowerCase())) {
        const tier: ModelTier = budget === 'free' ? 'free' : budget === 'quality' ? 'quality' : 'cheap';
        const replacement = pickBestFromCatalog(cachedCatalog as any[], tier, rawModel.split('/')[0]);
        if (replacement) {
          console.warn(`[council] Model "${rawModel}" is not in the live catalog; substituting "${replacement.id}".`);
          resolvedModel = replacement.id;
        } else if (budget === 'free') {
          return res.status(409).json({
            error: `"${rawModel}" is no longer available on OpenRouter and no zero-cost substitute is live. Refresh the model list or pick another model.`,
            modelDelisted: true,
          });
        }
      }
    }

    // Server-side cost governor: hard backstop on per-round spend. The client
    // stops a round when its own estimate trips the ceiling; this guard holds
    // even if the client is buggy or a stale bundle — once the round's REAL
    // spend reaches the ceiling, further calls for that round are refused.
    if (roundKey && costCeilingUSD && roundCostLedger.exceeded(roundKey, costCeilingUSD)) {
      return res.status(409).json({
        error: 'Round cost ceiling reached — further calls for this round were blocked on the server.',
        costCeilingExceeded: true,
        roundCostUSD: roundCostLedger.total(roundKey),
        ceilingUSD: costCeilingUSD,
      });
    }

    // Record this call's real usage into the round ledger (stream final chunk
    // or JSON response). Accepts raw snake_case (JSON path) or normalized
    // camelCase (SSE extractor). No-op when the client didn't send a roundKey.
    let usageRecorded = false;
    let billedModel = resolvedModel;
    const recordRoundUsage = (rawUsage: any, seatedModel?: string) => {
      if (usageRecorded || !roundKey || !rawUsage) return;
      usageRecorded = true;
      if (seatedModel) billedModel = seatedModel;
      const usage = {
        promptTokens: Number(rawUsage.prompt_tokens ?? rawUsage.promptTokens) || 0,
        completionTokens: Number(rawUsage.completion_tokens ?? rawUsage.completionTokens) || 0,
      };
      const rates = modelRatesUSD(cachedCatalog, billedModel);
      const cost = usageCostUSD(usage, rates);
      if (cost > 0) roundCostLedger.add(roundKey, cost);
    };

    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';

    if (budget === 'free' && !openrouterKey) {
      return res.status(503).json({ error: 'Free mode requires an OpenRouter API key.' });
    }

    if (!openrouterKey) {
      return res.status(500).json({
        error: 'OPENROUTER_API_KEY is not configured on the server.',
      });
    }

    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 110_000);

    const payload: Record<string, any> = {
      model: resolvedModel,
      messages,
      temperature: temperature ?? 0.7,
      stream: stream ?? true,
    };
    if (max_tokens) payload.max_tokens = max_tokens;
    if (tools && tools.length > 0) payload.tools = tools;
    if (plugins && plugins.length > 0) payload.plugins = plugins;
    if (session_id) payload.session_id = session_id;
    // Request per-token usage stats on the final stream chunk.
    payload.stream_options = { include_usage: true };

    try {
      const upstreamResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'https://ai.studio/build',
          'X-Title': 'AI Council Chamber',
        },
        body: JSON.stringify(payload),
        signal: abortCtrl.signal,
      });

      clearTimeout(timeoutId);

      if (!upstreamResp.ok) {
        const errorJson = await upstreamResp.json().catch(() => ({}));
        // Never fall back to Gemini for a Strict Free request when the provider
        // rejects the request (401/402/403). Only non-free requests may use
        // provider fallbacks, and those happen client-side via the policy layer.
        if (budget === 'free' && [401, 402, 403].includes(upstreamResp.status)) {
          return res.status(upstreamResp.status).json({
            error: errorJson.error?.message || `Upstream provider error: HTTP ${upstreamResp.status}`,
            freeModeBlocked: true,
          });
        }
        return res.status(upstreamResp.status).json({
          error: errorJson.error?.message || `Upstream provider error: HTTP ${upstreamResp.status}`,
        });
      }

      if (stream && upstreamResp.body) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Tell the client about a server-side model substitution (client SSE
        // parsers ignore events without a choices array, so this is safe to
        // prepend to the upstream stream).
        if (resolvedModel !== rawModel) {
          res.write(
            `data: ${JSON.stringify({ event: 'model_resolved', requested: rawModel, resolved: resolvedModel })}\n\n`
          );
        }

        // Abort the upstream stream promptly if the client disconnects (Stop button).
        const onClientClose = () => {
          abortCtrl.abort();
          readerCleanup();
        };
        const reader = upstreamResp.body.getReader();
        const readerCleanup = () => {
          try {
            reader.cancel().catch(() => {});
          } catch {
            /* ignore */
          }
        };
        req.on('close', onClientClose);

        // Keep a small tail so a usage object split across chunk boundaries is
        // still found; pass-through bytes are never altered.
        let sseScanTail = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
            if (roundKey && !usageRecorded) {
              sseScanTail = (sseScanTail + new TextDecoder('utf-8').decode(value)).slice(-4096);
              const usage = extractUsageFromSSEChunk(sseScanTail);
              if (usage) {
                const seated = extractRoutedModelFromSSE(sseScanTail);
                recordRoundUsage(usage, seated);
              }
            }
          }
          // Tell the client immediately when the round has hit its ceiling so
          // it can stop the remaining stages (SSE parsers ignore events
          // without a choices array, so prepending is safe).
          if (roundKey && costCeilingUSD && roundCostLedger.exceeded(roundKey, costCeilingUSD)) {
            res.write(
              `data: ${JSON.stringify({
                event: 'cost_governor',
                roundCostUSD: roundCostLedger.total(roundKey),
                ceilingUSD: costCeilingUSD,
                exceeded: true,
              })}\n\n`
            );
          }
          return res.end();
        } finally {
          req.off('close', onClientClose);
        }
      } else {
        const json = await upstreamResp.json();
        if (resolvedModel !== rawModel) {
          json.resolved_model = resolvedModel;
          json.requested_model = rawModel;
        }
        recordRoundUsage(json.usage);
        if (roundKey && costCeilingUSD && roundCostLedger.exceeded(roundKey, costCeilingUSD)) {
          json.cost_governor = {
            roundCostUSD: roundCostLedger.total(roundKey),
            ceilingUSD: costCeilingUSD,
            exceeded: true,
          };
        }
        return res.status(upstreamResp.status).json(json);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      // Client disconnected or stream was cancelled — nothing left to respond to.
      if (res.writableEnded || res.destroyed || res.headersSent) {
        return;
      }
      if (error.name === 'AbortError') {
        return res.status(504).json({
          error: 'Gateway Timeout: Upstream LLM provider did not respond within 110 seconds.',
        });
      }
      return res.status(502).json({
        error: error.message || 'Upstream LLM communication failure',
      });
    }
  });

  // 5b. Server-side Agent Loop — assess → plan → research → deliberate →
  //     fact-check → answer, entirely on the server. Jobs survive tab closes
  //     and are persisted to disk (bounded). Env knobs:
  //       AGENT_DEFAULT_MODEL      (default google/gemini-2.5-flash)
  //       AGENT_MAX_JOB_COST_USD   (default 2.00)
  //       AGENT_DATA_DIR           (default ./data)
  const agentDataDir = process.env.AGENT_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
  const getAgentDefaultModel = () =>
    process.env.AGENT_DEFAULT_MODEL?.trim() || 'google/gemini-2.5-flash';
  const getAgentMaxJobCost = () => {
    const raw = parseFloat(String(process.env.AGENT_MAX_JOB_COST_USD || ''));
    return !isNaN(raw) && raw > 0 ? raw : DEFAULT_MAX_JOB_COST_USD;
  };
  const agentRunner = new AgentLoopRunner(
    {
      catalog: () => cachedCatalog || [],
      openRouterKey: () => process.env.OPENROUTER_API_KEY?.trim() || '',
      defaultModel: getAgentDefaultModel,
      defaultMaxJobCostUSD: getAgentMaxJobCost,
    },
    agentDataDir
  );

  const toAgentSummary = (job: AgentJob) => ({
    id: job.id,
    goal: job.spec.goal.slice(0, 120),
    mode: job.spec.mode,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    usageUSD: Number(job.usageUSD.toFixed(6)),
    citations: job.citations.length,
    readings: job.readings.length,
    error: job.error,
  });

  app.post('/api/agent', requireRateLimit, requireOwnerGate, (req, res) => {
    const spec = sanitizeAgentSpec(req.body);
    if ('error' in spec) {
      return res.status(400).json({ error: spec.error });
    }
    const job: AgentJob = {
      id: newAgentJobId(),
      spec,
      status: 'planning',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      plan: null,
      research: [],
      readings: [],
      passes: [],
      verdict: '',
      citations: [],
      usageUSD: 0,
      progress: { phase: 'planning', detail: 'Job accepted — planning next.' },
    };
    // Fire-and-forget: the client polls job status; the loop persists every
    // phase so a restart leaves an honest trail.
    void agentRunner.run(job);
    return res.status(202).json({ data: { id: job.id, status: job.status } });
  });

  app.get('/api/agent/jobs', requireOwnerGate, requireRateLimit, (_req, res) => {
    return res.json({ data: agentRunner.list().slice(0, 20).map(toAgentSummary) });
  });

  app.get('/api/agent/jobs/:id', requireOwnerGate, requireRateLimit, (req, res) => {
    const job = agentRunner.get(String(req.params.id || ''));
    if (!job) return res.status(404).json({ error: 'Agent job not found.' });
    // Exhibit bodies are never echoed back on polls — they live server-side.
    return res.json({ data: redactAgentJob(job) });
  });

  app.post('/api/agent/jobs/:id/cancel', requireOwnerGate, requireRateLimit, (req, res) => {
    const ok = agentRunner.cancel(String(req.params.id || ''));
    if (!ok) return res.status(404).json({ error: 'Agent job not found.' });
    return res.json({ data: { cancelled: true } });
  });

  // 6. Client assets handling (Vite middleware in dev, static dist in production)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Structured Error Middleware
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[ServerError]', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message || String(err) });
  });

  const server = app.listen(activePort, '0.0.0.0', () => {
    console.log(`[Remix-Council] Production server active on port ${activePort}`);
  });

  // Graceful Railway shutdown handling
  const shutdown = () => {
    console.log('[Remix-Council] SIGTERM/SIGINT received. Draining server connections...');
    server.close(() => {
      console.log('[Remix-Council] Server shut down cleanly.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, server, port: activePort };
}

if (process.env.NODE_ENV !== 'test') {
  startServer(PORT);
}
