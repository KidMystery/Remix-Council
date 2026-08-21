# Security Specification — Remix Council (current architecture)

This document describes the security model **as actually implemented** in the
codebase. It replaces the earlier Firestore/Firebase spec, which described a
backend that no longer exists in this app.

---

## 1. Architecture

```
Browser (React SPA)
   │  same-origin fetch (relative URLs only)
   ▼
Express server (server.ts)
   │  Authorization: Bearer <OPENROUTER_API_KEY>   ← server-side only
   ▼
OpenRouter API  +  Google Drive API (appDataFolder)
```

- **All model traffic** goes through the server's `/api/council` proxy. The
  OpenRouter API key lives in `process.env.OPENROUTER_API_KEY` and is **never
  sent to the browser**.
- **Google Drive** is accessed directly from the browser via Google Identity
  Services (GIS) OAuth tokens. Tokens are held in module memory only — they are
  never written to localStorage or sessionStorage.

---

## 2. Endpoints & protection

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | Railway healthcheck |
| `GET /api/council/models` | council key (optional) + rate limit | Cached OpenRouter catalog |
| `GET /api/council/account` | council key (optional) | Credits / usage (no key leak) |
| `POST /api/council` | owner gate (or council key) + rate limit | Model completion proxy (streaming) |

### Council access key
- `COUNCIL_ACCESS_KEY` (server) is compared against the `x-council-key` header.
- If **unset**, the server runs in open dev mode (allows all) — intended for
  localhost / AI Studio / single-user.
- If set, the client must also set `VITE_COUNCIL_ACCESS_KEY` to the same value.
  ⚠️ That client copy is **visible in the bundle** — it is a shared secret that
  mitigates casual cross-site abuse, **not** a strong credential. It never
  protects money directly: the money key (`OPENROUTER_API_KEY`) stays server-side.

### Owner gate (real identity, optional)
- Set `OWNER_EMAIL` on the server to bind `/api/council` to **your** Google
  account. The browser (after Drive sign-in) sends its Google access token as
  `x-owner-token` on same-origin requests; the server verifies it against
  Google's `userinfo` endpoint (cached 5 min) and compares the email. Mismatch → 403.
- This is the modern replacement for the old Firebase `OWNER_UID` concept, using
  the Google sign-in that already ships with the app — no extra SDK.

### Server hardening already in place
- Model id allowlist regex (`ALLOWED_MODEL_PATTERN`) — rejects arbitrary provider/URL injection.
- Zod schema validation of the request body (roles, `content: string | array`).
- **Rate limiting** — fixed-window per-IP limiter on `/api/council` and
  `/api/council/models` (default 60 req/min, configurable via `RATE_LIMIT_PER_MINUTE`).
- **Input caps** — ≤ 80 messages and ≤ 300k characters per completion request.
- 110 s upstream timeout + client-disconnect abort.
- 10-minute in-memory catalog cache with stale-fallback.
- `express.json({ limit: '50mb' })` caps request body size.

---

## 3. Data-at-rest

- **Sessions** → localStorage (`council-sessions-v3`) and Drive `appDataFolder/council-sessions.json` when signed in.
- **Oracle threads/Bibles** → localStorage (`council-oracle-threads-v1`, `council-oracle-global-bible-v1`) and Drive `appDataFolder/council-oracle.json` when signed in.
- **Attachments are truncated on write** (local ~8 KB, Drive ~20 KB per file) to protect quota — surfaced with a UI warning.
- No Firebase/Firestore collections are used.

---

## 4. Known limitations (honest assessment)

1. **Still not safe to expose publicly by default.** If you leave both
   `COUNCIL_ACCESS_KEY` and `OWNER_EMAIL` unset, the server falls open and anyone
   who can reach the deployment can drive `/api/council` (rate-limited, but still
   spending your credits). **For personal use:** keep it on localhost, AI
   Studio's per-user runtime, or a private Railway service — OR set `OWNER_EMAIL`
   to your Google address and sign in to Drive before use, which hard-restricts
   the money route to you.
2. **Rate limiting is per-IP and in-memory** — it resets on restart and can be
   bypassed with many IPs; it stops casual abuse, not a determined attacker.
3. **Prompt injection** in attachments/follow-ups is unmitigated (acceptable for
   a personal analysis tool; a risk when analyzing untrusted documents).
4. `VITE_COUNCIL_ACCESS_KEY` (if used) is visible in the client bundle by design.

---

## 5. Roadmap to harden (further)

1. **Persistent rate limiting / per-identity budget** — move the limiter to a
   store (or key it on the verified owner identity) if you ever scale beyond one user.
2. **Server-side cost governor** — hard cap on spend per session/mission, enforced
   server-side (today the Chamber enforces cost ceilings client-side).
3. **Content-type + prompt-injection hardening** if you feed untrusted documents.

See `HANDBOOK.md` for setup (Google Client ID authorized origins, Railway env,
Drive troubleshooting) and the full feature/storage map.
