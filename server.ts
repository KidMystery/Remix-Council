import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

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

// Model validation pattern
const ALLOWED_MODEL_PATTERN =
  /^(google\/[a-z0-9.-]+|anthropic\/[a-z0-9.-]+|openai\/[a-z0-9.-]+|deepseek\/[a-z0-9.-]+|meta-llama\/[a-z0-9.-]+|nvidia\/[a-z0-9.-]+|qwen\/[a-z0-9.-]+|mistralai\/[a-z0-9.-]+|poolside\/[a-z0-9.-]+|inclusionai\/[a-z0-9.-]+)(:[a-z]+)?$/i;

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

  try {
    const resp = await fetch(
      `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${encodeURIComponent(token)}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const email = (data?.email as string) || null;
    if (email) {
      ownerVerifyCache.set(token, { email, expiresAt: Date.now() + OWNER_VERIFY_TTL_MS });
    }
    return email;
  } catch {
    return null;
  }
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
  const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const requireOwnerGate = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (!OWNER_EMAIL) {
      // Not configured — fall through to the shared-key gate (or open dev mode).
      return requireCouncilAuth(req, res, next);
    }

    const token = req.header('x-owner-token') || '';
    if (!token) {
      return res.status(401).json({ error: 'Sign in required (owner gate).' });
    }
    const email = await resolveTokenEmail(token);
    if (!email || email.toLowerCase() !== OWNER_EMAIL) {
      return res.status(403).json({ error: 'This deployment is restricted to its owner.' });
    }
    return next();
  };

  // 3. Models catalog route with 10-minute in-memory cache + stale fallback
  app.get('/api/council/models', requireCouncilAuth, requireRateLimit, async (_req, res) => {
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

  // 4. Account balance route
  app.get('/api/council/account', requireCouncilAuth, async (_req, res) => {
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

  // 5. Deliberation stream route
  app.post('/api/council', requireRateLimit, requireOwnerGate, async (req, res) => {
    const parseResult = CouncilRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request payload',
        details: parseResult.error.issues,
      });
    }

    const { model: rawModel, messages, temperature, max_tokens, budget, stream, tools } = parseResult.data;

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
      model: rawModel,
      messages,
      temperature: temperature ?? 0.7,
      stream: stream ?? true,
    };
    if (max_tokens) payload.max_tokens = max_tokens;
    if (tools && tools.length > 0) payload.tools = tools;
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

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          return res.end();
        } finally {
          req.off('close', onClientClose);
        }
      } else {
        const json = await upstreamResp.json();
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
