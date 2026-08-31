# Remix Council

A three-chamber AI workbench: **Chamber** (multi-persona deliberation with a
Chair synthesis), **Nexus Lab** (overnight, multi-pass falsification on
attached artifacts), and **Oracle** (persistent assistant with a Bible of
sealed claims). React 19 + TypeScript + Vite frontend, Express (`server.ts`)
backend proxy — API keys stay server-side.

> Note: this repo started as an AI Studio export. AI Studio is retired — the
> app now deploys to **Railway** at
> https://remix-council-production.up.railway.app

## Documentation

- **[HANDBOOK.md](HANDBOOK.md)** — the operator's handbook and the live
  handoff document. Read it before changing anything; it contains the current
  architecture, invariants, ops facts, and the latest handoff section.
- [PLAN.md](PLAN.md), [REVIEW.md](REVIEW.md), [security_spec.md](security_spec.md) —
  background docs (verify claims against the code; the handbook is the
  maintained source of truth).
- [WORKLOG.md](WORKLOG.md) — chronological log of what was done and verified.

## Run locally

1. Install dependencies (the lockfile is committed — prefer `npm ci`):
   `npm ci`
2. Copy `.env.example` to `.env` and fill in at least `OPENROUTER_API_KEY`
   (server-side). `GEMINI_API_KEY` is only needed for the Gemini-native
   voice/image paths in `server.ts`.
3. Dev (frontend + Express proxy together):
   `npm run dev`
4. Tests: `npm test` (Vitest). Type check: `npx tsc --noEmit`.
5. Production build: `npm run build` then `npm start`
   (bundles the client with Vite and the server to `dist/server.cjs`).

## Deploy

Railway auto-deploys `main` on every push. Keep `main` green: run
`npx tsc --noEmit && npm test` before merging anything to `main`.
