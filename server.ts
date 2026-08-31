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
import { createOracleServerStore } from './src/server/oracleServerStore';
import { createNexusMissionStore } from './src/server/nexusMissions';
import { createWebhookNotifier, detectObligation, parseObligationHints } from './src/server/webhookNotifier';

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
  let bucket = rateBuckets.get(ip);
  
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    bucket = { windowStart: now, count: 1 };
  } else {
    bucket.count++;
  }

  // LRU behavior: remove and re-insert to move to the end (most recently used)
  rateBuckets.delete(ip);
  rateBuckets.set(ip, bucket);

  // Evict oldest if we exceed the memory cap
  if (rateBuckets.size > 10_000) {
    const oldestKey = rateBuckets.keys().next().value;
    if (oldestKey !== undefined) rateBuckets.delete(oldestKey);
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

/* ───────────────────────────────────────────────────────────────────────────
 * Server event log (Aug 2026) — "where the logs live" for agents.
 *
 * Structured JSON events, newest-first, readable via GET /api/diagnostics/events
 * (council key or owner token). In-memory ring is the primary source (Railway is
 * ephemeral); data/events.jsonl is best-effort persistence with one rotation.
 * Logging must NEVER throw — a broken logger must not take down requests.
 * ─────────────────────────────────────────────────────────────────────────── */
export interface ServerEvent {
  ts: string;
  level: 'error' | 'warn' | 'info';
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

export function createServerEventLog(
  opts: { maxEvents?: number; filePath?: string; maxFileBytes?: number } = {}
): { record: (level: ServerEvent['level'], scope: string, message: string, meta?: Record<string, unknown>) => void; recent: (limit?: number) => ServerEvent[] } {
  const maxEvents = Math.max(50, Math.floor(opts.maxEvents ?? 500));
  const filePath = opts.filePath ?? '';
  const maxFileBytes = Math.max(2048, opts.maxFileBytes ?? 1_048_576);
  const events: ServerEvent[] = [];

  const appendFile = (line: string) => {
    if (!filePath) return;
    try {
      const fs = require('fs') as typeof import('fs');
      const pathMod = require('path') as typeof import('path');
      fs.mkdirSync(pathMod.dirname(filePath), { recursive: true });
      try {
        const size = fs.statSync(filePath).size;
        if (size > maxFileBytes) {
          const rotated = `${filePath}.1`;
          try { fs.unlinkSync(rotated); } catch { /* none yet */ }
          fs.renameSync(filePath, rotated);
        }
      } catch { /* file does not exist yet */ }
      fs.appendFileSync(filePath, line);
    } catch { /* never throw from logging */ }
  };

  return {
    record: (level, scope, message, meta) => {
      const event: ServerEvent = { ts: new Date().toISOString(), level, scope, message, ...(meta ? { meta } : {}) };
      events.push(event);
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
      appendFile(JSON.stringify(event) + '\n');
    },
    recent: (limit) => {
      const raw = Math.floor(limit ?? 100);
      const n = Number.isFinite(raw) && raw > 0 ? Math.min(raw, maxEvents) : 100;
      return events.slice(-n).reverse();
    },
  };
}

/**
 * Owner-gate decision as a PURE function so the auth matrix is unit-testable.
 * FIX (Aug 2026, found by the live audit): when OWNER_EMAIL is configured and
 * the caller presents NEITHER a valid council key NOR an owner token, the old
 * code waved the request through (next()) whenever COUNCIL_ACCESS_KEY was
 * unset — an open door on exactly-one-gate-configured deployments. Now:
 * owners configured + no credentials → 401, always.
 */
export function decideOwnerGate(input: {
  councilKeyConfigured: boolean;
  clientKey: string;
  councilKeyMatches: boolean;
  ownerEmailsConfigured: boolean;
  token: string;
  tokenEmail?: string | null;
  emailAllowed: (email: string) => boolean;
}): { allow: true } | { allow: false; status: 401 | 403; reason: 'signin_required' | 'not_owner' } {
  if (input.councilKeyConfigured && input.clientKey && input.councilKeyMatches) {
    return { allow: true }; // agent bypass — the shared key is the credential
  }
  if (!input.ownerEmailsConfigured) {
    return { allow: true }; // dev mode — council-key gate still applies separately
  }
  if (!input.token) {
    return { allow: false, status: 401, reason: 'signin_required' }; // THE FIX
  }
  const email = (input.tokenEmail || '').toLowerCase().trim();
  if (!email || !input.emailAllowed(email)) {
    return { allow: false, status: 403, reason: 'not_owner' };
  }
  return { allow: true };
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

  // 1b. Server event log — "where the logs live" for agents (HANDBOOK § Where the logs live).
  const eventLog = createServerEventLog({ filePath: path.join(process.cwd(), 'data', 'events.jsonl') });

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
        eventLog.record('warn', 'auth', 'Council access key rejected (401).', { path: req.path });
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
      eventLog.record('warn', 'ratelimit', 'Rate limit exceeded (429).', { path: req.path });
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
    // Agent identity (Phase 4 "return wire"): callers MAY declare who they are
    // via x-agent-name (e.g. "hermes"). It is metadata only — never auth — and
    // defaults to "web" for browser callers.
    res.locals.agent = (req.header('x-agent-name') || 'web').trim().slice(0, 64) || 'web';
    // HARDENING (Hermes bridge, Aug 2026): when NO council key is configured,
    // every gated endpoint fails closed with 503. The old dev-mode fallback
    // waved requests through unauthenticated — an open door on deployments
    // that simply forgot to set COUNCIL_ACCESS_KEY/SECRET.
    if (!COUNCIL_ACCESS_KEY) {
      eventLog.record('warn', 'auth', 'Owner gate: server auth not configured — 503.', { path: req.path });
      return res.status(503).json({
        error: 'Server auth not configured. Set COUNCIL_ACCESS_KEY (or COUNCIL_ACCESS_SECRET) to enable gated endpoints.',
      });
    }
    const clientKey = req.header('x-council-key') || '';
    const token = req.header('x-owner-token') || '';
    const decision = decideOwnerGate({
      councilKeyConfigured: Boolean(COUNCIL_ACCESS_KEY),
      clientKey,
      councilKeyMatches: Boolean(COUNCIL_ACCESS_KEY) && clientKey === COUNCIL_ACCESS_KEY,
      ownerEmailsConfigured: allowedOwnerEmails.size > 0,
      token,
      tokenEmail: token ? await resolveTokenEmail(token) : null,
      emailAllowed: (email) => allowedOwnerEmails.has(email),
    });
    if (decision.allow) {
      if (allowedOwnerEmails.size === 0) {
        // Dev mode — still enforce the shared council key if configured.
        return requireCouncilAuth(req, res, next);
      }
      return next();
    }
    if (decision.status === 401) {
      eventLog.record('warn', 'auth', 'Owner gate: no credentials accepted — 401.', { path: req.path });
      return res.status(401).json({ error: 'Sign in required (owner gate).' });
    }
    eventLog.record('warn', 'auth', 'Owner gate: identity not on the owner list — 403.', { path: req.path });
    return res.status(403).json({ error: 'This deployment is restricted to its owner.' });
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
        const errorMsg = errorJson.error?.message || `Upstream provider error: HTTP ${upstreamResp.status}`;
        eventLog.record('error', 'upstream', errorMsg, {
          model: resolvedModel,
          requestedModel: rawModel,
          status: upstreamResp.status,
          budget,
        });
        // Never fall back to Gemini for a Strict Free request when the provider
        // rejects the request (401/402/403). Only non-free requests may use
        // provider fallbacks, and those happen client-side via the policy layer.
        if (budget === 'free' && [401, 402, 403].includes(upstreamResp.status)) {
          return res.status(upstreamResp.status).json({
            error: errorMsg,
            freeModeBlocked: true,
            status: upstreamResp.status,
            providerCode: errorJson.error?.code,
            providerMetadata: errorJson.error?.metadata ?? errorJson.metadata,
          });
        }
        return res.status(upstreamResp.status).json({
          error: errorMsg,
          status: upstreamResp.status,
          providerCode: errorJson.error?.code,
          providerMetadata: errorJson.error?.metadata ?? errorJson.metadata,
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
      eventLog.record('error', 'upstream', error?.message || 'Upstream LLM communication failure', {
        model: resolvedModel,
        requestedModel: rawModel,
        name: error?.name,
      });
      // Client disconnected or stream was cancelled — nothing left to respond to.
      if (res.writableEnded || res.destroyed) {
        return;
      }
      // Mid-stream failure (upstream stalled/aborted after SSE started): END
      // the stream with an error frame. Returning without ending it leaves the
      // client's reader pending forever — a wedged Oracle on a one-liner.
      if (res.headersSent) {
        try {
          res.write(
            `data: ${JSON.stringify({ error: { message: `Upstream stream failed mid-response: ${error?.message || String(error)}` } })}\n\n`
          );
        } catch {
          // socket already gone
        }
        return res.end();
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
  //       AGENT_DEFAULT_MODEL      (default anthropic/claude-opus-5-fast)
  //       AGENT_MAX_JOB_COST_USD   (default 2.00)
  //       AGENT_DATA_DIR           (default ./data)
  const agentDataDir = process.env.AGENT_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
  const getAgentDefaultModel = () =>
    process.env.AGENT_DEFAULT_MODEL?.trim() || 'anthropic/claude-opus-5-fast';
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

  // Hermes bridge (Aug 2026): synchronous chamber deliberation for agent
  // callers. Runs the existing agent loop in 'chamber' mode and awaits the
  // full transcript (120s ceiling) — browser /api/agent flows are untouched.
  app.post('/api/council/deliberate', requireRateLimit, requireOwnerGate, async (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const participants = Array.isArray(body.participants)
      ? (body.participants as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [];
    if (body.participants !== undefined && !Array.isArray(body.participants)) {
      return res.status(400).json({ error: 'participants must be an array of strings.' });
    }
    const context =
      typeof body.context === 'string' && body.context.trim()
        ? participants.length > 0
          ? `${body.context}\n\nParticipants: ${participants.join(', ')}`
          : body.context
        : participants.length > 0
          ? `Participants: ${participants.join(', ')}`
          : undefined;
    const spec = sanitizeAgentSpec({
      goal: body.question,
      mode: 'chamber',
      context,
      maxDeliberationPasses: body.rounds ?? body.maxPasses,
    });
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
      progress: { phase: 'planning', detail: 'Sync deliberation accepted.' },
    };
    const timeoutMs = 120_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      agentRunner.cancel(job.id);
    }, timeoutMs);
    timer.unref?.();
    try {
      const result = await agentRunner.run(job);
      if (timedOut || (!result.succeeded && job.status !== 'done')) {
        return res.status(504).json({
          error: timedOut ? `Deliberation timed out after ${timeoutMs / 1000}s.` : job.error || 'Deliberation failed.',
          jobId: job.id,
        });
      }
      return res.json({
        jobId: job.id,
        transcript: result.job.passes,
        consensus: result.job.verdict,
        citations: result.job.citations,
        confidence: result.job.confidence,
        usageUSD: Number(result.job.usageUSD.toFixed(6)),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Deliberation failed.' });
    } finally {
      clearTimeout(timer);
    }
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

  // Diagnostics: recent server events and client-reported errors.
  // Auth = council key or owner token. See HANDBOOK § Where the logs live.
  app.get('/api/diagnostics/events', requireOwnerGate, requireRateLimit, (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    res.json({ events: eventLog.recent(limit), generatedAt: new Date().toISOString() });
  });

  app.post('/api/diagnostics/events', requireOwnerGate, requireRateLimit, (req, res) => {
    try {
      const { level, scope, message, meta } = req.body || {};
      const validLevel = ['error', 'warn', 'info'].includes(level) ? level : 'info';
      const validScope = typeof scope === 'string' && scope ? scope.slice(0, 50) : 'client';
      const validMessage = typeof message === 'string' && message ? message.slice(0, 1000) : 'Client event';
      const validMeta = meta && typeof meta === 'object' ? meta : undefined;
      eventLog.record(validLevel, validScope, validMessage, validMeta);
      res.status(200).json({ status: 'ok' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to record event' });
    }
  });

  // 5b. Oracle server persistence (Phase 2) — the server is the source of
  // truth; the browser syncs against it. Data dir injectable for tests via
  // ORACLE_DATA_DIR (defaults to <cwd>/data/oracle).
  const oracleStore = createOracleServerStore(
    process.env.ORACLE_DATA_DIR || path.join(process.cwd(), 'data', 'oracle')
  );

  app.get('/api/oracle/bible', requireOwnerGate, requireRateLimit, (_req, res) => {
    return res.json({ data: oracleStore.getBible() });
  });

  app.get('/api/oracle/threads', requireOwnerGate, requireRateLimit, (_req, res) => {
    return res.json({ data: oracleStore.getThreads() });
  });

  app.get('/api/oracle/threads/:id', requireOwnerGate, requireRateLimit, (req, res) => {
    const thread = oracleStore.getThread(String(req.params.id || ''));
    if (!thread) return res.status(404).json({ error: 'Oracle thread not found.' });
    return res.json({ data: thread });
  });

  app.post('/api/oracle/entries', requireOwnerGate, requireRateLimit, (req, res) => {
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required.' });
    if (body.threadId !== undefined && typeof body.threadId !== 'string') {
      return res.status(400).json({ error: 'threadId must be a string.' });
    }
    if (body.ts !== undefined && (typeof body.ts !== 'number' || !Number.isFinite(body.ts))) {
      return res.status(400).json({ error: 'ts must be a number.' });
    }
    const thread = oracleStore.appendEntry({
      threadId: body.threadId,
      text,
      ts: body.ts,
      agent: res.locals.agent,
    });
    // Return wire: announce the appended entry; simple obligation pattern
    // (starts with "obligation:" or contains "TODO:") reserves the
    // obligation_flagged event. Kept dead simple on purpose — see
    // webhookNotifier.ts.
    if (webhookNotifier.enabled) {
      webhookNotifier.notify({ event: 'oracle_entry_appended', threadId: thread.id, agent: res.locals.agent, ts: Date.now() });
      if (detectObligation(text)) {
        webhookNotifier.notify({ event: 'obligation_flagged', text, ts: Date.now(), ...parseObligationHints(text) });
      }
    }
    return res.status(201).json({ data: thread });
  });

  app.post('/api/oracle/sync', requireOwnerGate, requireRateLimit, (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.threads)) {
      return res.status(400).json({ error: 'threads array is required.' });
    }
    if (body.bible !== undefined && body.bible !== null && typeof body.bible !== 'object') {
      return res.status(400).json({ error: 'bible must be an object.' });
    }
    try {
      const merged = oracleStore.sync({ threads: body.threads, bible: body.bible ?? null });
      return res.json({ data: merged });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'Sync failed.' });
    }
  });

  // 5c. Nexus missions API (Phase 3) — server-side CSV upload + the
  // pause/answer loop, wrapped around the existing agent loop. Gated like
  // every other money route.
  // Phase 4 "return wire": outbound webhook is fully disabled unless
  // HERMES_WEBHOOK_URL is set — no env var, zero behavior change.
  const webhookNotifier = createWebhookNotifier(process.env.HERMES_WEBHOOK_URL, {
    log: (message, meta) => eventLog.record('warn', 'webhook', message, meta),
  });
  const nexusMissions = createNexusMissionStore(agentRunner, agentDataDir, webhookNotifier, () => cachedCatalog || []);

  app.post('/api/nexus/missions', requireRateLimit, requireOwnerGate, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const created = nexusMissions.create({
      goal: body.goal,
      csv: body.csv,
      context: body.context,
      agent: res.locals.agent,
      models: body.models,
      taskType: body.taskType,
    });
    if ('error' in created) return res.status(400).json({ error: created.error });
    return res.status(201).json({ data: { missionId: created.id, status: 'running' } });
  });

  app.get('/api/nexus/missions', requireOwnerGate, requireRateLimit, (_req, res) => {
    return res.json({ data: nexusMissions.list() });
  });

  app.get('/api/nexus/missions/:id', requireOwnerGate, requireRateLimit, (req, res) => {
    const view = nexusMissions.get(String(req.params.id || ''));
    if (!view) return res.status(404).json({ error: 'Nexus mission not found.' });
    return res.json({ data: view });
  });

  app.post('/api/nexus/missions/:id/answers', requireOwnerGate, requireRateLimit, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const result = nexusMissions.answer(String(req.params.id || ''), body.answers);
    if (!result) return res.status(404).json({ error: 'Nexus mission not found.' });
    if (!('id' in result)) {
      const notAcceptable = /only accepted while/.test(result.error);
      return res.status(notAcceptable ? 409 : 400).json({ error: result.error });
    }
    return res.json({ data: result });
  });

  app.post('/api/nexus/missions/:id/pause', requireOwnerGate, requireRateLimit, (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const view = nexusMissions.pause(String(req.params.id || ''), body.pendingQuestions);
    if (!view) return res.status(404).json({ error: 'Nexus mission not found.' });
    return res.json({ data: view });
  });

  app.post('/api/nexus/missions/:id/resume', requireOwnerGate, requireRateLimit, (req, res) => {
    const view = nexusMissions.resume(String(req.params.id || ''));
    if (!view) return res.status(404).json({ error: 'Nexus mission not found (or not resumable).' });
    return res.json({ data: view });
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
    eventLog.record('error', 'server', err?.message || String(err), {
      stack: String(err?.stack || '').split('\n').slice(0, 4).join(' | '),
    });
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
