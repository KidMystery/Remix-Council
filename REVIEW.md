# Remix-Council — Code Review & Iteration Suggestions

**Scope:** personal use only. Build passes (`vite build` ✅), typecheck passes (`tsc --noEmit` ✅), and all 96 unit tests pass ✅. The issues below are *runtime / design* problems that tests don't catch — the test suite only exercises pure functions and the reducer in isolation, never the actual render + deliberation flow.

---

## 1. Critical functional bugs

### 1.1 New rounds don't reliably render, and live streaming is broken (HIGH confidence)
`CouncilChamber` keeps **two** sources of truth for the round list and they are never reconciled:

- `useCouncilReducer(rounds)` seeds a local reducer (`localRounds`) from the session's rounds.
- `ADD_ROUND` is **never dispatched anywhere** (`src/hooks/useCouncilReducer.ts` defines it, `src/components/CouncilChamber.tsx` never calls it).
- `setRounds(...)` is only called inside a `useEffect` keyed on `[activeSessionId]`, so the reducer copy only refreshes when you *switch sessions*.
- New rounds enter the parent session only via `onUpdateRound`/`onCompleteRound` → `upsertRound`, which fire **after each stage completes** (not per token).
- Render line: `{(localRounds.length > 0 ? localRounds : rounds).map(...)}`.

Consequences:
- **Fresh session (0 rounds):** `localRounds` stays `[]`, so the fallback `rounds` is rendered. Rounds appear only at coarse checkpoints (after Stage 1, after Stage 2, after synthesis). The per-token streaming UI (status "Streaming", incremental text) **never appears**.
- **Session that already has ≥1 round (e.g. after a reload):** `localRounds` is non-empty and stale, so a newly submitted round **never appears at all** until the user switches sessions or reloads.

This looks like a half-finished refactor from a reducer-driven model to a session-manager-driven model. Fix either way: dispatch `ADD_ROUND` when a round starts and keep the reducer authoritative, or delete the reducer double-buffer entirely and render `rounds` directly with token updates flowing through the session manager.

### 1.2 Side effects inside `setState` updaters (StrictMode)
`src/main.tsx` wraps the app in `<StrictMode>`. React dev-mode **double-invokes updater functions**, and updaters must be pure. In `src/hooks/useSessionManager.ts`, `createSession`, `deleteSession`, `clearSessionHistory`, `clearAllSessions`, `upsertRound`, and `deleteRoundFromActiveSession` all call `writeLocalThrottled(next)`, `writeDriveThrottled(next)`, `persistToLocalStorage`, `saveSessionsToDrive`, and even `setIsSyncing(...)`/`setActiveSessionId(...)` *inside* the `setSessions(prev => …)` updater. Result: double-writes, possible stale reads, and "setState during render" warnings. The HEAD commit message ("fix side effect execution in updater") suggests this was known but not fully resolved. Compute the next state first, then perform persistence as a separate statement outside the updater.

### 1.3 "Resume" actually re-runs the whole pipeline (wasted money + changed results)
The "Interrupted Deliberation" banner and per-round "Resume Stage 2/3" buttons call `resumeIncompleteRound`, which calls `runRoundExecution({...round})`. But `runRoundExecution` **always re-runs Stage 1** (it unconditionally dispatches `START_STAGE1` and re-streams every panelist), then re-runs Stage 2 and synthesis. So "Resume Stage 2" silently re-bills and re-generates Stage 1 — it neither resumes nor preserves the prior outputs. Resume should detect completed stages and skip them.

### 1.4 Truncation is invisible → silent data loss
- A round isn't persisted to the session at all until **after Stage 1 finishes** (`onUpdateRound` is only called post-stage). Close/reload mid–Stage 1 = the in-progress round is gone entirely. The "resume" banner only exists for rounds that already got persisted.
- On top of that, `sanitizeForStorage` truncates attached-file content to **2,000 chars** for localStorage and `sanitizeForDrive` to **5,000 chars** for Drive (`useSessionManager.ts`, `drivePersistence.ts`) with **no user notification**. Attach a 100 KB codebase, deliberate, reload → the attachment is silently cut to 2 KB and every subsequent re-run/follow-up uses the truncated copy.

### 1.5 Stage 2 panelist-letter misalignment
In `CouncilChamber.runRoundExecution`, the peer-review prompt says "You are Panelist `{myLetter}`", where `myLetter = letters[activePersonas.findIndex(...)]`. But the peers' proposals are labeled with a *separate* running counter (`letterIdx`) that skips self. Example with 3 personas: self = index 1 → "Panelist B", while peers are labeled A and **B** — a duplicated/mismatched letter. Cosmetic but confusing in a tool whose whole point is structured critique.

---

## 2. Features that *look* implemented but do nothing (dead settings / dead code)

A large part of the codebase is orphaned. The Settings panel exposes many controls that are stored in `App.tsx` state and passed only to `SettingsPanel` — never to `CouncilChamber` — so they have **zero effect on deliberation**:

- `maxTokens`, `quickPanelMaxTokens`, `synthesisMaxTokens` — never passed into `streamPersonaWithFallback` (no `maxTokens` in the call).
- `panelTimeoutSeconds` — no client timeout exists at all.
- `maxRoundCostCeiling`, `costCeiling` (chamber), `stopAfterStage1`, `useSingleModelForSimple`, `proCompareModelId`, `isProCompareEnabled`, `autoSelectModels` — never consumed by the run loop.
- `webMode` (`off/auto/always`) — passed to SettingsPanel only; the chamber never receives it.
- **Web grounding is dead end-to-end:** no caller ever passes `webSearch: true`; `shouldEnableWebSearch` / `requiresCurrentInformation` / `getWebSearchToolDefinition` have no callers; and the server (`server.ts`) builds its own upstream payload and **drops `tools`** entirely, so even if enabled it wouldn't reach OpenRouter.
- **Smart model selection is never applied.** `applySmartModelSelection` / `routeCouncilModels` are only referenced by the unused `SmartSelectionAuditCard`. The chamber always uses `persona.model` as-is.
- **Cost tracking is dead.** `res.cost` is always `undefined` (the client never computes it), `round.cost` is forced to `0`, `updateModelPricingFromOpenRouter` is never called, and `countRoundCost`/`countTotalSessionCost`/`formatCost` have no callers. The only "cost" shown is `CouncilSummaryBar`'s "Est. Cost", which is a static per-model heuristic (`estimatedCost`), not actual spend.
- **Token usage is never reported.** The server doesn't set `stream_options: { include_usage: true }`, so OpenRouter never streams usage back — `res.usage` is `undefined` for every streaming call.
- **Follow-up mode is a no-op.** `Composer` sends `isFollowUp`, but `handleDeliberate(query, files, isFollowUp)` ignores the parameter entirely.

**Unused modules** (dead code, confirmed by import scan): `archivist.ts`, `arena.ts`, `authHeader.ts`, `costGovernor.ts`, `executionPlan.ts`, `githubValidator.ts`, `modelResolver.ts`, `titleUtils.ts`, `useFileAttachment.ts`, `usePersonaStream.ts`.

**Unused components:** `AuditLogModal`, `CapabilityRefusalBanner`, `CompareProCard`, `CouncilPreloadSelector`, `FallbackAuditModal`, `HeaderActions`, `ModelDetailsCard`, `RoundRatingCard`, `SmartSelectionAuditCard`, `SwipeDeck` (and transitively `capabilityGuard`, `modelDetails`, `auditLogger`, `GroundingSourcesCard`, etc.).

Also notable:
- `src/lib/archivist.ts` (the whole hierarchical-memory summarizer) is unused — the only "memory" that actually runs is the tiny `contextCompressor.ts`, and it uses the legacy `streamOpenRouter` (no fallback, `budget:'free'`).
- `useFileAttachment.ts` (unused) had image + paste support and a 30 MB / extension whitelist; the live `Composer.tsx` has its **own** inline file handling with **no size cap, no extension whitelist, no image support**, and reads arbitrary files via `file.text()`.
- The model catalog is fetched twice: `App` calls `fetchCouncilModels()` while `useModelRecommendations` runs `refreshModelRecommendations()`, which issues **three identical** `/api/council/models?sort=…` requests — the server ignores `sort`, so all three are the same data.

**Repo hygiene:** `V2.patch` (497 KB), `patch_fallback.js`, `patch_manager.js`, `patch_manager2.js`, `patch_persistence.js`, `patch_persistence2.js`, `patch_server.js`, `test_expansion.js` are leftover scratch/agent-edit scripts — several target files that no longer exist (`persistence.ts`, `syncCouncilSession`, Firestore). `security_spec.md` describes a **Firestore/Firebase backend with `OWNER_UID` auth** that does not match the actual server (OpenRouter + shared key), and references routes (`/api/council/extract-archive`, `/api/council/import-github`) that don't exist.

**`package-lock.json` is out of sync with `package.json`.** The committed lockfile still pins `firebase@^12.17.1` and `firebase-admin@^14.2.0` (removed from `package.json`) and declares `"engines": { "node": ">=22.0.0" }` while `package.json` says `"24.x"`. Running `npm install` rewrites ~2,400 lines. Regenerate and commit it so CI/deploys install what `package.json` actually declares.

---

## 3. Security & privacy (ranked for personal use)

1. **The "council access key" is not a secret.** `VITE_COUNCIL_ACCESS_KEY` is shipped in the client bundle (acknowledged in `.env.example`) and sent as `x-council-key`. The server compares it to `COUNCIL_ACCESS_KEY`. Anyone who can load the page can read the key and call `/api/council` directly, spending your OpenRouter credits. **For personal use: keep this private** (localhost, Railway private networking, or a non-guessable subdomain + the key), or replace with real per-user auth if you ever share it. The current setup is *not* safe to deploy publicly.
2. **No rate limiting** on `/api/council` or `/api/council/models` (the `security_spec.md` claims per-IP rate limiting on the models route, but it isn't implemented). A runaway/abusive client can drain credits fast.
3. **No server-side limits on messages/content.** `express.json({limit:'50mb'})`, and `messages` are forwarded to OpenRouter verbatim with no count/length caps. Fine for a trusted client; risky if exposed.
4. **Prompt injection is unmitigated** in attachments and follow-ups (a crafted file can instruct personas to ignore their roles). Not usually a blocker for a personal analysis tool, but worth knowing when it analyzes untrusted documents.
5. `firebase-applet-config.json` is committed with the Firebase web API key, app id, and Google OAuth client ID. Firebase web keys aren't secret, but consider moving the OAuth client ID to env and gitignoring the file if you don't need the Firebase applet integration (nothing in the current code uses Firebase anyway).
6. The `/api/council` schema accepts `budget` but never forwards it or `tools` upstream — so the server-side "free mode" guard (`budget === 'free'`) is the only budget enforcement, and it's client-trustable (a caller can just omit `budget`).

---

## 4. Common-sense missing features (prioritized for personal use)

**P0 — make it behave as expected**
- **Cancel/Stop button** for a running deliberation. The server already has an `AbortController` + 110 s timeout; the client just never passes a `signal`. Add stop, plus client-side timeout (the `panelTimeoutSeconds` setting is already there, unused).
- **Wire the settings you already show** (max tokens, cost ceiling, stop-after-stage-1, web mode) into the run loop — or remove them from the UI to stop misleading yourself.

**P1 — data safety & control**
- **Session rename** and **auto-title from the first query** (`titleUtils.summarizeTitle` exists and is unused). "New Deliberation" × N is unusable after a few sessions.
- **Per-round delete** in the chamber (`deleteRoundFromActiveSession` exists, no button calls it).
- **Edit a past query before re-running** (currently you can only re-run the same text).
- **Warn before truncating attachments**, and persist full files to Drive (or a larger cap) instead of silently cutting to 2 KB.
- **Import = merge-or-replace prompt.** `importSessionsJSON` currently **replaces** all sessions with the imported file and only shallow-validates (id + `rounds` array) — easy to nuke current work or crash on an old export shape.

**P2 — quality-of-life**
- **Copy/export the full synthesis or whole session as Markdown** (Nexus has dossier export; the chamber has none).
- **Show real per-round cost** (`countRoundCost` already exists) instead of the static "Est. Cost" heuristic.
- **Make Follow-up actually do something** (inject the prior synthesis explicitly) or remove the toggle.
- **Image attachments + vision** (the dead `useFileAttachment` already had the plumbing).
- **Web grounding + citations** (re-enable `tools` forwarding on the server, pass `webSearch`, surface `GroundingSourcesCard`).
- Mobile: the sidebar/drawer and settings are fine, but long markdown tables/code in `MessageMarkdown` can overflow — verify on narrow screens.

---

## 5. Suggested iteration order

1. **Fix the round-list/streaming state (1.1)** — everything else is secondary if new rounds don't show reliably. Decide on a single source of truth for rounds.
2. **Add Cancel + wire `signal`** (4-P0) and remove the updater side effects (1.2).
3. **Stop the silent data loss** (1.4): persist full attachments to Drive, cap localStorage with a visible warning, and persist a round at creation (not after Stage 1) so reloads can resume.
4. **Make Resume real** (1.3): skip completed stages instead of re-running Stage 1.
5. **Delete the dead settings or wire them.** Removing ~3,000+ lines of dead code (`archivist`, `arena`, `executionPlan`, `costGovernor`, `modelResolver`, `titleUtils`, `githubValidator`, `authHeader`, `useFileAttachment`, `usePersonaStream`, the 10 unused components, and the root `patch_*.js`/`V2.patch`) will make the app dramatically easier to reason about. Optionally restore the good ones (title auto-naming, archivist memory, per-round cost) rather than wiring the hollow ones.
6. **Cost visibility + limits** (real usage via `stream_options.include_usage`, per-round cost display, hard ceiling).
7. **Follow-up & web grounding** as the two most valuable "real" feature restorations.
8. **Security** (rate limiting, key scoping) only matters if it ever leaves your own machine.

### Quick wins (< 1 hour each)
- Forward `tools` in `server.ts` payload; pass `webSearch` from a wired web-mode.
- Add `stream_options: { include_usage: true }` and accumulate usage client-side.
- Call `summarizeTitle(query)` on round creation to auto-name sessions.
- Add `dispatch({type:'ADD_ROUND'})` (or drop the reducer) — the headline bug.
- Delete the 9 root-level `patch_*.js` / `test_expansion.js` / `V2.patch` scratch files.
- Reconcile `security_spec.md` with the actual OpenRouter backend or delete it.
