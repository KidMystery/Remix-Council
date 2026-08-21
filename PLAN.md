# Implementation Plan — Remix-Council v2

Scope: the full review-fix list **plus** two new features:
1. **Auto-named threads** in the Chamber (page 1) and Nexus Lab (page 2).
2. **Nexus follow-up** capability.
3. **A 3rd page** — an autonomous, multimodal "living" assistant that deliberates, answers, and continuously maintains a **Bible** (a persistent, self-updating summary it references every turn).

Each item below lists: **what/where**, **approach**, **pitfalls + solutions**, and **viability**. Execution order and verification gates are at the end. No code changes yet.

---

## Workstream 1 — Correctness fixes (from REVIEW.md)

### 1.1 Fix round-list rendering + live streaming — *blocker*
- **What/Where:** `src/components/CouncilChamber.tsx` + `src/hooks/useCouncilReducer.ts`.
- **Approach:** The reducer stays as the *live render source*; the session manager stays as the *durable source*. Fix the seam:
  - Add an idempotent `UPSERT_ROUND` action to the reducer.
  - Dispatch `UPSERT_ROUND(currentRoundState)` at the top of `runRoundExecution` (covers deliberate, resume, re-run, fork — all flow through it).
  - Persist the round at **creation** (call `onUpdateRound` immediately in `handleDeliberate`), not after Stage 1 — so reloads mid-stage can still resume.
  - Add a `DELETE_ROUND` dispatch where a per-round delete button is added (1.5).
  - Re-seed effect: keep `[activeSessionId]`, plus a guard that re-seeds to `[]` when `rounds.length === 0 && !isDeliberating` (handles "Clear History" from the sidebar, which the chamber can't see).
- **Pitfalls:** (a) Re-seeding from parent `rounds` mid-stream would drop in-flight token text — solution: never re-seed while `isDeliberating`, and never key the seed effect on the full `rounds` array. (b) Duplicate rounds if `UPSERT_ROUND` isn't idempotent — solution: upsert by `round.id`, not push.
- **Viability:** High — the reducer is already written and tested; this is wiring, not new logic.

### 1.2 Remove side effects from `setState` updaters
- **What/Where:** `src/hooks/useSessionManager.ts` (`createSession`, `deleteSession`, `clearSessionHistory`, `clearAllSessions`, `upsertRound`, `deleteRoundFromActiveSession`).
- **Approach:** Compute `next` from `sessionsRef.current` outside the updater, then `setSessions(next)` + persist as separate statements. Use refs (already present) to avoid stale-closure bugs in `deleteSession`/`clearSessionHistory`.
- **Pitfalls:** (a) Stale closures over `activeSessionId` — solution: read from `sessionsRef.current` and pass the id explicitly. (b) StrictMode double-invocation making writes fire twice — this fix is precisely what removes it.
- **Viability:** High, mechanical.

### 1.3 Cancel / Stop + client-side timeout
- **What/Where:** `CouncilChamber.tsx`, `Composer.tsx`, `server.ts`.
- **Approach:**
  - Chamber holds an `AbortController` ref; `streamPersonaWithFallback` already accepts `signal` → `streamOpenRouterCompletion` → `fetch` (already passes `signal`).
  - Add a **Stop** affordance in `Composer` while deliberating; on stop, `abort()`, release the deliberation lock, and leave the round in a resumable (incomplete) state.
  - Wire the existing `panelTimeoutSeconds` setting as a per-call client timeout (reject after N s).
  - Server: also listen for `req.on('close')` to abort the upstream fetch promptly instead of waiting out its 110 s timer.
- **Pitfalls:** (a) Aborted fetches throw `AbortError` — must not be logged as failures or overwrite partial content; solution: treat `AbortError` as "stopped", mark stage as interrupted. (b) The lock must always release — solution: keep the existing `finally` blocks.
- **Viability:** High — all the plumbing exists; only the controller + UI button are missing.

### 1.4 Make "Resume" actually resume (skip completed stages)
- **What/Where:** `runRoundExecution` in `CouncilChamber.tsx`.
- **Approach:** Compute which stages/personas are incomplete from `round.deliberation`; run only missing personas per stage; only run synthesis if missing. Re-running the whole pipeline is never the default.
- **Pitfalls:** (a) Partial-completion edge cases (some personas errored) — solution: only re-run personas whose status ≠ `completed`. (b) Synthesis depends on stage outputs — solution: fall back to whatever completed outputs exist; if stage1 is empty, run stage1.
- **Viability:** High — contained refactor of one function.

### 1.5 Stop silent data loss (attachments)
- **What/Where:** `useSessionManager.ts` (`sanitizeForStorage`, 2 KB cap), `drivePersistence.ts` (`sanitizeForDrive`, 5 KB cap), `Composer.tsx`.
- **Approach:** Raise the local cap and surface a visible warning at attach time when a file exceeds it (badge on the attachment pill + toast). Drive keeps a larger cap. Never truncate silently.
- **Pitfalls:** (a) localStorage quota (~5 MB) — solution: keep a cap but *tell the user*, and encourage Drive for big codebases. (b) Already-truncated data in old exports — solution: don't re-truncate on load; only truncate on write, and only warn on *new* attachments.
- **Viability:** High.

### 1.6 Wire the settings that already exist (high-value subset)
- **What/Where:** `App.tsx` (pass-through) → `CouncilChamber.tsx`.
- **Approach:** Thread into the run loop:
  - `maxTokens` → `streamPersonaWithFallback({ maxTokens })`; `quickPanelMaxTokens`/`synthesisMaxTokens` for their stages.
  - `stopAfterStage1` → skip Stage 2 + synthesis (proposals only).
  - `webMode` (`off/auto/always`) → `webSearch` flag on persona calls via `shouldEnableWebSearch()`.
  - `panelTimeoutSeconds` → client timeout (1.3).
- **Deferred (documented):** `maxRoundCostCeiling`, `useSingleModelForSimple`, pro-compare — these need cost accounting (1.8) to be meaningful; wire them *after* real costs exist.
- **Pitfalls:** (a) Settings live in `App` state; missing prop pass-through breaks TS — solution: update `CouncilChamberProps` and `App` together. (b) Web search under `free` budget must stay disabled (the guard already exists in `shouldEnableWebSearch`).
- **Viability:** High.

### 1.7 Re-enable web grounding end-to-end
- **What/Where:** `server.ts` (forward `tools`), `webGrounding.ts` (already complete), chamber wiring (1.6).
- **Approach:** Server merges `tools` and `stream_options:{include_usage:true}` into the upstream payload when present (the schema already tolerates extra fields via `body` construction — extend `CouncilRequestSchema` to allow `tools` + `content` arrays for images).
- **Pitfalls:** (a) Some models reject the tool schema — solution: send tools only when `webSearch` is requested. (b) Web search costs money on `free` budget — solution: `shouldEnableWebSearch` already blocks `free`.
- **Viability:** High.

### 1.8 Real usage/cost reporting
- **What/Where:** `server.ts` + `openrouter.ts` + `archivist.ts` (already has cost math) + `CouncilSummaryBar`.
- **Approach:** Add `stream_options:{include_usage:true}` (1.7); client already parses `json.usage` on stream chunks — with the flag it'll populate. Display per-round cost via the existing `countRoundCost`/`formatCost` in the round header. Keep the static "Est. Cost" as a pre-flight estimate.
- **Pitfalls:** (a) Usage may only arrive on the final chunk — solution: already handled (usage is captured whenever present). (b) Free models → $0 — solution: existing `:free` handling.
- **Viability:** Medium-High (depends on OpenRouter honoring the flag; already standard).

---

## Workstream 2 — Auto-naming + Nexus follow-up (new)

### 2.1 Auto-name Chamber threads
- **What/Where:** `useSessionManager.ts`, `CouncilSidebar.tsx`, `App.tsx`.
- **Approach:**
  - On first round completion, if `session.title` is the default ("New Deliberation"/"Untitled"), set it to `summarizeTitle(firstUserQuery)` (function already exists in `titleUtils.ts`).
  - Add inline **rename** in the sidebar (pencil → input, Enter/blur to save) so titles are editable.
- **Pitfalls:** (a) Naming only on completion means an empty thread stays "New Deliberation" — acceptable; solution: also title on first submit. (b) Sidebar rename must persist — solution: go through a new `renameSession(id,title)` that writes local + Drive.
- **Viability:** High — `summarizeTitle` is already tested.

### 2.2 Auto-name + Follow-up in Nexus Lab
- **What/Where:** `NexusLabView.tsx`.
- **Approach:**
  - Auto-title the mission from `summarizeTitle(missionGoal)`; display in header + dossier.
  - **Follow-up:** after a mission reaches `converged`/`max_reached`, show a "Follow-up directive" input. Starting it seeds a new mission whose cycle context carries the prior mission's final synthesis (as `[Prior Mission Consensus]`), so it's a true continuation, not a cold start.
- **Pitfalls:** (a) Mission persistence is a single localStorage record — a follow-up overwrites the old mission; solution: archive the finished mission (keep `nexus-archive-v1`) or append rounds. (b) Cost estimate should reflect carried context — solution: keep the same estimator, it's pre-flight only.
- **Viability:** High.

---

## Workstream 3 — New 3rd page: the living assistant + "Bible"

### 3.1 New view + navigation
- **What/Where:** `AppViewMode` (`CouncilHeader.tsx`), `App.tsx`, new `src/components/OracleView.tsx`.
- **Approach:** Add `'oracle'` (working name) to `AppViewMode`, a third nav button, and route to the new view. The assistant keeps its **own thread list** (self-contained) rather than sharing the Chamber sidebar, to avoid coupling the two data models.
- **Pitfalls:** (a) Header width on mobile with 3 tabs — solution: compact labels/icons, allow wrap. (b) Keeping the existing `view === 'chamber' ? … : <NexusLabView>` ternary — solution: switch to a small view map.
- **Viability:** High.

### 3.2 Data model + persistence (threads + Bible)
- **What/Where:** new `src/lib/oracleStore.ts` + `src/types.ts`.
- **Approach:**
  ```ts
  interface OracleThread {
    id: string; title: string;
    createdAt: number; updatedAt: number;
    persona: { name; role; systemPrompt; model };      // single editable persona
    messages: { id; role: 'user'|'assistant'; content; images?: {name;url}[]; timestamp; model?; error? }[];
    bible: { content: string; updatedAt: number };
  }
  ```
  Persist to `council-oracle-threads-v1` (localStorage, no truncation on the Bible; cap message history by count, not chars). Add JSON export/import. (Drive sync optional — follow-up.)
- **Pitfalls:** (a) localStorage quota — solution: Bible is one bounded doc; messages capped to last N. (b) Migration if the shape changes — solution: versioned key + tolerant parse (same pattern as `useSessionManager`).
- **Viability:** High.

### 3.3 The agentic turn loop (deliberate → answer → update Bible)
- **What/Where:** `OracleView.tsx` + a small `src/lib/oracleEngine.ts`.
- **Approach:** Bounded 3-step loop (no unbounded agent):
  1. **Reflect** (toggleable, default on): cheap call — "given your current Bible + user message, plan your reply and list Bible facts to update."
  2. **Answer:** streaming call with context = Bible (compressed if long) + reflection plan + recent messages → streamed to UI.
  3. **Bible update:** dedicated cheap call — "here is the current Bible and the latest exchange; return the updated, self-contained Bible." Replace Bible, show "Bible updated" + `updatedAt`.
- **Pitfalls:** (a) Unbounded loops/cost — solution: fixed 3 steps, no self-retry. (b) Bible drift/hallucination — solution: the update prompt is strict ("only add/merge confirmed info, preserve user facts verbatim, keep it concise"), and the Bible is user-editable with a manual "Regenerate Bible" button. (c) Long Bibles blowing context — solution: reuse the chunk/compression helpers if Bible exceeds a threshold. (d) A failed Bible step shouldn't kill the answer — solution: the answer already rendered; Bible failure just warns.
- **Viability:** Medium-High — mostly reuses `streamOpenRouterCompletion`/`streamPersonaWithFallback`; new code is orchestration only.

### 3.4 Multimodal input (images)
- **What/Where:** `server.ts` schema, `openrouter.ts`, `OracleView` composer.
- **Approach:** Accept image attachments (data-URL) and send OpenRouter content arrays `[{type:'text',…},{type:'image_url',…}]`. Default model vision-capable (e.g. `google/gemini-2.5-flash`), with a model picker.
- **Pitfalls:** (a) Server schema currently requires `content: string` — solution: widen to `string | array`. (b) Non-vision models reject images — solution: model picker + warning when images are attached to a non-vision model. (c) Data-URL payload size — solution: resize/compress before base64 (canvas), cap count.
- **Viability:** Medium-High.

### 3.5 Web grounding for the assistant
- **Approach:** Reuse 1.7's `tools` forwarding + `shouldEnableWebSearch` for the answer step, so the Bible stays *current* (this is the "perpetual/up to date" requirement).
- **Viability:** High once 1.7 lands.

---

## Execution order & verification gates

1. **Phase A (correctness):** 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8.
   Gate: `npm run lint` (tsc) + `npm test` + `npm run build` + prod-server smoke (`/`, `/api/health`, SPA fallback).
2. **Phase B (naming + nexus):** 2.1 → 2.2. Same gates + manual UI check.
3. **Phase C (assistant page):** 3.1 → 3.2 → 3.3 → 3.4 → 3.5. Same gates + a live preview pass.
4. **Phase D (cleanup, optional):** delete dead `patch_*.js`/`V2.patch`/unused modules, reconcile `security_spec.md`, regenerate `package-lock.json`.

Every phase keeps the app runnable — I'll verify after each, not at the end.

---

## Open decisions (blocking Workstream 3 design)

See the questions — they lock down: (1) what "multimodal" must include, (2) Bible scope (per-thread vs global), (3) how agentic the turn loop should be, (4) implementation scope for this pass.

---

## Implementation status (this pass)

**Done — Phase A (correctness):**
- 1.1 ✅ Round rendering fixed: `UPSERT_ROUND` reducer action, dispatch at run start, persist-at-creation, external-clear re-seed guard. New rounds now stream live in both fresh and existing sessions.
- 1.2 ✅ Removed side effects from all `useSessionManager` setState updaters (computed outside, persisted separately).
- 1.3 ✅ Stop button in Composer + run-level `AbortController` + per-call timeout wired to `panelTimeoutSeconds`; server aborts upstream on client disconnect.
- 1.4 ✅ Resume now skips completed stages/personas (no more full re-run/re-billing).
- 1.5 ✅ Attachment-truncation warning in Composer (8 KB local cap note); caps raised (local 8 KB, Drive 20 KB).
- 1.6 ✅ Wired `maxTokens`, `quickPanelMaxTokens`, `synthesisMaxTokens`, `stopAfterStage1`, `webMode`, `panelTimeoutSeconds` into the run loop.
- 1.7 ✅ Server forwards `tools` + `stream_options.include_usage`; schema accepts multimodal content arrays (verified via live curl).
- 1.8 ✅ Per-round cost chip in the round header (`countRoundCost`/`formatCost`).
- Bonus ✅ Fixed Stage 2 panelist-letter misalignment; deep-cloned rounds so in-flight streaming never mutates session state; Chamber Follow-up toggle now carries prior consensus.

**Done — Phase B (naming + nexus):**
- 2.1 ✅ Chamber threads auto-title from the first query (`summarizeTitle`), plus inline rename (pencil) in the sidebar.
- 2.2 ✅ Nexus missions auto-title; follow-up directive carries prior consensus forward and archives the finished mission.

**Done — Phase C (Oracle page):**
- 3.1 ✅ Third nav tab + `OracleView` (self-contained thread list).
- 3.2 ✅ `oracleStore.ts` — threads + per-thread Bible + global Bible, export/import.
- 3.3 ✅ Bounded 3-step loop: reflect → streamed answer → thread Bible update → global Bible update, with Stop + partial-answer handling.
- 3.4 ✅ Multimodal: image attachments (vision content parts) + text file attachments.
- 3.5 ✅ Web grounding toggle (reuses the server `tools` path).

**Deferred / not in this pass (documented):**
- `maxRoundCostCeiling`, `useSingleModelForSimple`, pro-compare remain un-wired (need real cost accounting before they're meaningful).
- Drive sync for Oracle threads/Bibles (localStorage + JSON export/import for now).
- Dead-code deletion, `security_spec.md` reconciliation, `package-lock.json` regeneration.

Verification: `tsc --noEmit` ✅ · 96 unit tests ✅ · `vite build` ✅ · prod server smoke (`/`, `/api/health`, SPA fallback, schema) ✅.

---

## Implementation status — second batch (autonomy + intelligence + speech)

**Done this pass:**
- **Token Governor** (`src/lib/tokenGovernor.ts`) — adaptive output budget: auto-continues truncated answers (up to 2 expansions, 1.5× each) and learns budgets down when a short answer underuses its allowance. Wired into the Oracle answer step, persisted per-thread.
- **Credits readout** — `useOpenRouterCredits` hook reads the server proxy; live "Credits" badges in the main header + Oracle header, and the Settings → Account tab now shows remaining credits + usage bar + refresh (was previously a dead "Loading…" stub).
- **Task-based model recommendations** — `smartModelSelector` now wired into the Chamber run: detects domain (code/math/finance/creative/general) and auto-assigns per-panelist models when "Auto-select models" is on; domain shown in the summary bar.
- **Oracle voice rotation** — six rotating analytical voices (same model → budget-safe) with a per-thread "Voices" toggle; the active voice is shown on each reply.
- **Dictation (STT)** — `useSpeechRecognition` hook + mic buttons in the Oracle and Chamber composers (Chromium browsers).
- **HANDBOOK.md** — operator's manual: three tabs, all features, key/security map, Railway + Drive troubleshooting, storage map, roadmap.

**Verification:** `tsc --noEmit` ✅ · 96 tests ✅ · `vite build` ✅.

**Still deferred (documented in HANDBOOK):** Firebase profile sign-in restore, Oracle Drive sync, Chamber cost-ceiling enforcement, dead-code cleanup + lockfile regeneration.

---

## Implementation status — final batch (autonomy end-to-end + cleanup)

**Done this pass:**
- **Deep Document Mode (Nexus)** — `src/lib/documentChunker.ts` splits oversized attachments into ~page-sized parts (default 20 pages/part, selectable 10–60, 60-part safety cap) on paragraph/sentence boundaries. Nexus now reviews **every part**, builds a running findings ledger, and runs a final cross-document synthesis — the "400 pages → 20 × 20-page parts" workflow. Chunk manifest + terminal logs tell the user exactly what was split. 5 new unit tests.
- **Oracle Drive sync** — generalized the Drive helpers (`findSessionsFile`/`uploadSessionsMultipart` take a filename) and added `saveOracleToDrive`/`loadOracleFromDrive` (`appDataFolder/council-oracle.json`). Oracle auto-loads on sign-in and debounce-saves threads + Bibles; header shows a Drive sync indicator.
- **Chamber cost-ceiling enforcement** — `maxRoundCostCeiling` now wired in: when the round's estimated cost (from real per-token usage) exceeds the cap, Stage 2 + Synthesis are skipped with an explanatory note.
- **Profile/identity in Account tab** — Settings → Account now shows the signed-in Google identity + sign in/out + live credits (Drive sign-in = profile).
- **Cleanup** — deleted `patch_*.js`, `test_expansion.js`, `V2.patch`; regenerated `package-lock.json` (drops stale `firebase` deps, aligns engine to 24.x — fixes Railway builds); rewrote `security_spec.md` to describe the *actual* server architecture (OpenRouter proxy + Drive OAuth), with an honest limitations + hardening roadmap.

**Verification:** `tsc --noEmit` ✅ · **101 tests** ✅ (was 96) · `vite build` ✅ · prod server smoke (`/`, `/api/health`, SPA fallback) ✅.

**Deferred (documented in HANDBOOK):** Firebase profile sign-in restore (needs the user's Firebase project + SDK re-add), Oracle voice→model rotation within budget, pruning of remaining unused modules.

---

## Implementation status — final hardening + cleanup pass

**Done this pass:**
- **Apple references removed** — `⌘+Enter` placeholders → `Ctrl+Enter` (Chamber + Oracle composers).
- **Owner gate (security)** — server `OWNER_EMAIL` gate: browser proves Google identity via `x-owner-token`; server verifies against Google `userinfo` (5-min cache). Replaces the old Firebase `OWNER_UID` idea using the existing Google sign-in.
- **Rate limiting** — in-memory fixed-window per-IP limiter on `/api/council` + `/api/council/models` (default 60/min, `RATE_LIMIT_PER_MINUTE`). Verified: 429s after bucket fills.
- **Input caps** — ≤ 80 messages and ≤ 300k chars per completion request (verified 400 on 81 messages).
- **Voice → model rotation within budget** — `ORACLE_VOICES` carry budget-tier models; a "Model/voice" toggle rotates the model per voice, but only on paid models (never upgrades a free tier) and never when images need vision the voice model lacks.
- **Dead-code prune** — removed 8 unused components, 8 libs, 2 hooks, plus their tests (arena, modelResolver, executionPlan, githubValidator, costGovernor, auditLogger, capabilityGuard, authHeader, useFileAttachment, usePersonaStream). invariantTests trimmed to the surviving invariants.
- **Docs** — `security_spec.md` + `HANDBOOK.md` updated for the new owner-gate/rate-limit reality.

**Verification:** `tsc --noEmit` ✅ · **85 tests** (down from 101 — 16 were testing deleted code) ✅ · `vite build` ✅ · prod smoke: `/api/health` 200, input cap 400, rate limit 429 ✅.

**Answering "is it safe to put here":** Not safe public-by-default. Personal use = keep on localhost/AI Studio/private Railway, or set `OWNER_EMAIL` to lock the money route to your Google account. Documented in `security_spec.md` §4.
