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
      content: z.string(),
    })
  ),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  budget: z.enum(['free', 'cheap', 'quality']).optional(),
  stream: z.boolean().optional(),
});

// In-memory catalog cache (10 minute TTL)
let cachedCatalog: any[] | null = null;
let lastCatalogFetchTime = 0;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

  // 3. Models catalog route with 10-minute in-memory cache + stale fallback
  app.get('/api/council/models', requireCouncilAuth, async (_req, res) => {
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
      const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${openrouterKey}` },
      });
      const data = await resp.json();
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch OpenRouter account' });
    }
  });

  // 5. Deliberation stream route
  app.post('/api/council', requireCouncilAuth, async (req, res) => {
    const parseResult = CouncilRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request payload',
        details: parseResult.error.issues,
      });
    }

    const { model: rawModel, messages, temperature, max_tokens, budget, stream } = parseResult.data;

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

        const reader = upstreamResp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        return res.end();
      } else {
        const json = await upstreamResp.json();
        return res.status(upstreamResp.status).json(json);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
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

  // Client static assets
  const clientDist = path.resolve(serverDirname, '.');
  app.use(express.static(clientDist));
  app.use((_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Not Found');
    });
  });

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
