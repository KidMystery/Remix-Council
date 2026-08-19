import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(portValue?: string | number): number {
  if (typeof portValue === 'number') return portValue;
  if (typeof portValue === 'string') {
    const parsed = parseInt(portValue, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 3000;
}

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

// In-memory catalog cache
let cachedCatalog: any[] | null = null;
let lastCatalogFetchTime = 0;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function startServer(portOverride?: number) {
  if (!getApps().length) {
    const serverProjectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID;
    initializeApp(serverProjectId ? { projectId: serverProjectId } : undefined);
  }

  const app = express();
  const PORT = resolvePort(portOverride ?? process.env.PORT);

  // 1. Health check route (unauthenticated, vital for Railway deployment readiness)
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // 2. Access key & auth gate
  const COUNCIL_ACCESS_KEY = (process.env.COUNCIL_ACCESS_KEY || process.env.COUNCIL_ACCESS_SECRET)?.trim() || '';

  const requireCouncilAuth = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (COUNCIL_ACCESS_KEY) {
      const clientKey = (
        req.header('x-council-key') ||
        req.header('x-council-access-secret') ||
        req.header('x-council-access-key') ||
        ''
      ).trim();

      if (clientKey !== COUNCIL_ACCESS_KEY) {
        return res.status(401).json({ error: 'Missing or invalid council access key.' });
      }
      return next();
    }

    // Fallback to Firebase ID token verification if key is not configured
    const authHeader = req.headers['x-firebase-token'];
    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(401).json({
        error: 'Unauthorized: Missing Firebase ID token or Access Key',
      });
    }

    try {
      const decodedToken = await getAuth().verifyIdToken(authHeader);
      const ownerEmail = process.env.OWNER_EMAIL?.trim();
      const ownerUid = process.env.OWNER_UID?.trim();

      if (ownerEmail && (!decodedToken.email || decodedToken.email.toLowerCase() !== ownerEmail.toLowerCase())) {
        return res.status(403).json({ error: 'Forbidden: Email mismatch' });
      }
      if (ownerUid && decodedToken.uid !== ownerUid) {
        return res.status(403).json({ error: 'Forbidden: UID mismatch' });
      }

      (req as any).user = decodedToken;
      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized: Invalid Firebase ID token' });
    }
  };

  // 3. Models catalog route with 10-minute cache
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
        details: parseResult.error.errors,
      });
    }

    const { model: rawModel, messages, temperature, max_tokens, budget, stream } = parseResult.data;

    if (!ALLOWED_MODEL_PATTERN.test(rawModel)) {
      return res.status(400).json({ error: `Unsupported model identifier: ${rawModel}` });
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (budget === 'free' && !openrouterKey) {
      return res.status(503).json({
        error: 'Free mode requires an OpenRouter key with access to free models.',
      });
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
  const clientDist = path.resolve(__dirname, '../dist/client');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Not Found');
    });
  });

  // Structured Error Middleware
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[ServerError]', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message || String(err) });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Remix-Council] Production server active on port ${PORT}`);
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

  return { app, server, port: PORT };
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
