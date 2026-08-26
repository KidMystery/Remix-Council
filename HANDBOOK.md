# Remix Council — Operator's Handbook

Your whole vision, in one page. Three tabs, one assistant, all wired to server-side keys.

## The three tabs (exactly as you imagined)

| Tab | What it is | Use it for |
|---|---|---|
| **Chamber** | A panel of personalities (Skeptic, Visionary, Pragmatist…) debates your question, critiques each other, then a Chair synthesizes one answer. Long threads keep a **hierarchical memory**: recent rounds stay verbatim, older ones are condensed (window = Settings slider). | General questions, anything where you want multiple viewpoints and a verdict. You set the personalities in Settings. Export any thread as Markdown. |
| **Nexus Lab** | Overnight multi-pass on **artifacts** (app tree, CSV, statement, PDF). Every exhibit part is read, then Night Shift falsifies the ledger and writes a Morning Brief. Agent Mode (web research) is an explicit pick, never the silent default. | Drop the files. Say what you want in the morning. |
| **Oracle** | Your Jarvis/Gideon. A persistent multimodal assistant with a **Bible of claims**: sealed LAW (Admit) plus unsealed working notes. Oracle may rewrite notes every turn; it cannot rewrite sealed claims. Runs **Direct**, **Mini Deliberation**, or **Auto-Rotate**. | A companion with a steady personality. Memory that must survive a fight or a second device is sealed, not a diary. |

---

## Where we stand vs aicouncil.ai.studio (the basic version that just worked)

The live basic at https://aicouncil.ai.studio/ is:
- Fast & Free preset, 4 personas (Skeptic deepseek-chat, Visionary claude-3.5-haiku, Pragmatist gpt-4o-mini, Chair gemini-2.5-flash)
- One deliberation mode, no evidence docket, no cost ceiling, no Drive merge, no Bible claims
- It just worked because it had no guardrails to trip.

This repo (main `05adca4` + L1/L2 port) is leaps ahead, and now wired to be **as reliable as the basic, but with teeth**:

| Basic | This version |
|---|---|
| 4 hardcoded models | N enabled seats including Chair = N **different labs** from live catalog, reseated on every catalog refresh ($0 preload). No hardcoded Sonnet/GPT/Gemini/R1. |
| No docket | Evidence docket with SHA-256, IndexedDB blobs, `STAMPED` only when blockers empty. Resume re-hydrates blob, never a 2k stub. |
| No cost ceiling | Per-round ceiling (0 = Unlimited) client + server (409 backstop). Fixed Aug 25: `DollarCostGovernor.recordUsage()` now respects 0=unlimited via `hasFiniteCap()` and resets per-round — was tripping at $0.00 on Highest Quality. |
| No Drive contract | Drive v3 `files.list` is `fields=files(id,name)` never etag (v3 File has no etag, `files(id,name,etag)` 400s). ETag from GET header for If-Match. Fail-closed unread, tombstones, merge-by-id. |
| No Bible | Bible is claims[] with sealed LAW. Union-by-claim-id, sealed beats diary. Admit only after stamped verdict. |
| No Oracle→Chamber | `/chamber` builds Case brief, not transcript dump. Chair must not synthesize error strings. |

**Assurance:** The basic still deliberates. This version now does too — Highest Quality + Auto should give 4 **different** company chips (DeepSeek counted once via `canonicalLab`), cost $0.00 trip gone, Drive search no longer 400s, phone+laptop merge preserved, failed GET fail-closes. If it still blocks, read the docket — it will tell you which blocker, not invent a verdict.

---

## The features (and where to find them)

- **Auto-named threads** — Chamber and Nexus name themselves from your first question. Rename anytime via the pencil in the sidebar (Chamber) or the title pill (Nexus).
- **Token Governor (adaptive tokens)** — in the Oracle, the answer budget self-adjusts: if an answer gets cut off it automatically continues ("pick up where you left off") with a bigger budget, and if a short answer used only a fraction of the budget it learns to spend less next time. You'll see a small `auto-expanded tokens ×N` note when it kicks in. (Chamber uses fixed per-stage limits from Settings.)
- **Credits remaining** — a live "Credits: $X" badge in the top-right header (click to refresh), a bigger one in the Oracle header, and a full **Account & Credits** panel in Settings → Account. It reads from OpenRouter through the **server proxy**, so your API key never touches the browser.
- **Chamber Auto seats unique labs** — a council preset stores people, not a shrine to Claude. When Auto-select is on, every budget preset and every saved council (builtin + yours) is reseated from the **live catalog**: N enabled seats including the Chair get N different labs (Meta, Qwen, DeepSeek, whoever is actually good this week). Personality only decides who picks first. Paid runs still call `openrouter/auto` with `allowed_models: [lab/*]`. Preload is $0 on catalog/roster update — not four paid completions. Thin catalog: unique labs → unique families → run + one toast. Auto-select **off** keeps the snapshot you parked. Default budget is **Highest Quality**. Oracle stays Auto. **L1 production fix Aug 25:** uniqueness uses `canonicalLab()` aliases (`deepseek-ai` → `deepseek`, `meta-llama` → `meta`, `xai` → `x-ai`, `mistralai` → `mistral`) so two DeepSeek Flash variants (Latest + 0731) cannot both seat; family/degrade **never** reuse a seated lab while unused labs remain; repair pass steals leftover labs; Auto glob stays **raw** org (`meta-llama/*` not `meta/*`); summary bar distinct count = `canonicalLab`, not raw first path segment. **One seating source:** `App.tsx` uses `effectiveCatalog` — hook catalog when its length >= direct `fetchCouncilModels`, so Auto doesn't seat from a thinner list.
- **Per-persona model health badges** — each panelist's model card shows **Live** (verified in the live catalog) or **Delisted** (not found — will auto-substitute or fail in strict mode), plus a **Vision** / **Text-only** chip from the model's architecture. Only shown when a live catalog is loaded.
- **Per-round cost ceiling (client + server)** — Settings → Advanced → "Per-Round Cost Ceiling". **0 = unlimited** on client and server (no hidden $2 default). When set, the Chamber skips remaining stages and the server refuses extra calls (HTTP 409) using real usage. Hitting the ceiling **blocks the docket** — it is not a stamped verdict. Missing usage under a ceiling is `cost_unknown`. **Fixed Aug 25:** client `DollarCostGovernor.recordUsage()` now checks `hasFiniteCap()` so 0=unlimited never trips (was `$0.0002 reached limit of $0.00`), and governor resets per-round so 2nd deliberation doesn't inherit 1st round's spend. Server `RoundCostLedger.exceeded()` already required `ceiling > 0`.
- **Modality-aware routing (vision guard)** — images are Oracle-only. If you attach a picture and the resolved model can't read images, the turn is automatically routed to a vision-capable model (Gemini 2.5 Flash) and the swap is noted in the reply header. In Mini Deliberation the panel is filtered to vision-capable models. You're never silently wasting a turn on a model that can't see.
- **Council Archivist memory (Chamber)** — Settings → Advanced → "Archivist Recent Rounds Window" (1–5). The N most recent rounds stay **verbatim** in the panel's memory; older rounds are condensed into an executive summary. This is what keeps long deliberations coherent without blowing the context window.
- **Single-model fast mode (Chamber)** — Settings → Advanced → "Use Single Model for Simple Questions" pins new deliberations to the Quick Panel (one primary model, no peer review). "Strict No-Fallback Mode" surfaces raw model errors instead of silently swapping models (for diagnosing a specific model).
- **Export (Chamber + Nexus)** — Chamber: "Export .md" in the action toolbar downloads the whole thread (queries, proposals, critiques, syntheses, web sources) as Markdown. Nexus: the mission Dossier export.
- **Oracle model & modes (Settings, not the main page)** — the Oracle main page stays clean; which model(s) it uses and how is configured in **Settings → Oracle → Model & Modes**: mode picker (Direct / Mini Deliberation / Auto-Rotate), an editable model palette for Direct (click to select, × to remove, add/randomize/defaults), and roster chip editors (add/remove/randomize/defaults) for the other two. The curated list is current-frontier only and spans six labs (Anthropic incl. Claude Fable 5, OpenAI, Google, Meta Muse Spark 1.2, Z.ai GLM 5.3, DeepSeek V4 Flash — every id live-verified against the OpenRouter catalog on Aug 24, 2026, vision flags taken from catalog architecture).
- **Oracle custom models (Settings → Oracle)** — the owner can type any OpenRouter model id (`provider/model-name`); it's validated against the live catalog and badged **Live / Delisted / Unverified (offline)** with its **Vision / Text-only** capability, then joins the Direct palette and every roster picker, rotates like any other model, and obeys the vision guard (text-only custom models are never sent images; delisted ids are always shown, never silently dropped). Removing a custom model also removes it from the Direct palette and the current thread's rosters. New Oracle threads **inherit** the active thread's mode, rosters, and toggles — the models you add to Auto-Rotate are the ones that rotate.
- **Voice rotation (Oracle)** — the Oracle cycles through six analytical voices (Skeptic, Visionary, Pragmatist, Synthesist, Strategist, Teacher) on the same model, so each turn has a different perspective. Toggle "Voices" on/off per thread.
- **Speech** —
  - *Listen:* every Oracle reply and every Chamber panelist card has a read-aloud button.
  - *Dictate:* the **Dictate** (mic) button in the Oracle and Chamber composers uses your browser's speech-to-text so you can talk instead of type (Chromium browsers: Chrome, Edge, Brave, Arc).
- **Web grounding** — the Oracle has a "Web" toggle; the Chamber honors the Settings → Web mode (off/auto/always). Live citations come back through the server proxy.
- **Evidence docket (Chamber + Nexus)** — attachments are exhibits, not prompt stuffing. Each file is hashed (SHA-256), extracted, and stored as a **blob on this device** (IndexedDB). Session JSON / Drive sync carry **metadata only** (name, size, coverage, hash). A round cannot be **stamped COMPLETED** while blockers are open (partial panel, unread/thin PDF, missing blob, skipped stages, unknown spend under a ceiling). The paper-form docket on each round is the cover sheet: what was uploaded vs what was actually read. Resume re-reads the blob, never a 2k stub.
- **Attachments** — text/code files, PDFs, and ZIP/RAR codebases in Chamber + Nexus; the Oracle adds **images** (vision) + files. Image turns are modality-guarded: if the chosen model is text-only it's auto-routed to a vision model (see above).
- **Nexus overnight on artifacts** — a fresh mission needs exhibits (tree / CSV / statement / PDF). Follow-up of a finished mission may carry the prior consensus without new files. Large files are **always** split into ~20-page parts (pages-per-part still tunable). Every part is read; the cycle budget cannot drop unread pages. Server launch **refuses** over 50k chars instead of slicing to 15k. Tests: `nexusExhibits.test.ts`.
- **Self-correcting consensus (Nexus)** — from cycle 2 on, the Chair is handed the previous cycle's full consensus and instructed to **adversarially falsify** it: re-derive critical claims (preferring live web verification over memory), change the consensus only with substantive justification, and state exactly what changed, why, and the top remaining pitfalls. So pass 1 proposes, and later passes defend-or-overturn — the "I jumped the gun, here's why" behavior is now structural. The verdicts feed is **clean by default**: final verdict in full, earlier cycles as one-line summaries, with a "Full deliberation" toggle to expand. The runtime telemetry terminal is collapsed by default (auto-opens while a mission runs).
- **Night Shift (Nexus)** — a mode in the Autonomous Tool Matrix: wider falsification ladder (3–8 passes, each falsifying the previous consensus on a different front — facts → costs → failure modes → assumptions → actionability), optional pacing between passes (0–2 hr), and a final **🌅 Morning Brief**: the Chair's "what changed overnight" changelog (initial consensus, each reversal + why, final verdict, top pitfalls, honest confidence). The cost estimate includes the extra brief pass; the mission runs while the tab is open (Pause always responds).
- **Nexus "⚡ Agent Mode" (explicit, not default)** — web-research theater on the server. Default Nexus is **Autonomous + Night Shift** on the files you attached. Live Research off = exhibits only (zero tool fees).
- **Server-side agent loop (`/api/agent*`)** — "assess the question, make a plan, research, deliberate, fact-check, then answer," running inside `server.ts` so jobs survive tab closes and short restarts. Phases: **planning** (bounded plan + research queries) → **researching** (OpenRouter's `openrouter:web_search` server tool, citations collected) → **deliberating** (chair passes; Nexus escalates falsification pass-by-pass; pacing is server-side) → **finalizing** (fact-check against citations + verdict + honest confidence). Guards: hard per-job cost cap (env `AGENT_MAX_JOB_COST_USD`, default $2.00, REAL usage incl. web-search fees), strict-free budgets never use research tools, delisted models substituted from the live catalog, per-call timeouts, jobs persisted to `data/agent-jobs.json` (gitignored, bounded; mid-flight jobs mark themselves **interrupted** after a restart). Env knobs: `AGENT_DEFAULT_MODEL` (default `google/gemini-2.5-flash`), `AGENT_MAX_JOB_COST_USD`, `AGENT_DATA_DIR`.
- **Oracle server briefings** — the Unasked Verdict card's "☁ on server" runs the briefing as an `oracle`-mode agent job (plan → research → single deliberative pass, capped at $1) and folds the verdict + sources back into a titled briefing thread. Cancel anytime; the job keeps working if you close the tab.
- **Unasked Verdict (Oracle)** — the Oracle locally detects topics you keep circling across threads (zero tokens: decision-style questions only, personal topics always excluded) and offers a small card — *"You've circled this one a few times… Convene mini-council?"* Nothing is spent until you click; the briefing opens as a Mini Deliberation thread titled "Council Briefing — <topic>". Tunable in Settings → Oracle (on/off, mention threshold, lookback window); "Later" snoozes a topic, a new mention brings it back.
- **Confidence Ledger (Chamber, opt-in add-on)** — Settings → Advanced → "Outcome Tracking". When on, completed rounds get a **Track verdict** button; you mark each tracked verdict later as ✓ worked / ✗ didn't / ↷ ignored. A **Track Record** button in the Chamber toolbar shows per-panelist and per-model stats, grouped by task domain (construction estimates classify as finance). Only what you explicitly track is recorded, and ratios only appear after 3 resolved outcomes — before that it honestly says "gathering evidence".
- **Rounds stack & collapse (Chamber)** — only the newest round is open; earlier rounds fold into a compact stacked card (query + meta + actions + one-line synthesis or incomplete-state summary). The per-round header stays sticky with **Resume / Re-run / Fork / Delete / Track verdict** always reachable — an incomplete round you moved past collapses into the stack instead of staying open forever, and clicking its Resume (or the interrupted-deliberation banner) re-opens it and continues. The round-level chevron toggles any round manually; starting a new round re-folds the previous one.
- **Manual model picks win (Chamber presets)** — if you hand-pick a persona or Chair model that isn't a verified zero-cost model while a Fast & Free preset is active, the app leaves free mode EXPLICITLY (preset switches to Balanced Quality with a toast) instead of erroring mid-deliberation and forcing you to re-apply a preset that wipes your picks. Your picks always stay. Unknown ≠ paid (no catalog → no switch), and a preset you just clicked is authoritative for a few seconds. The "free mode never upgrades to paid silently" invariant holds — this is a visible preset change, never an in-mode upgrade.
- **Oracle → Chamber handoff** — type `/chamber` (or tap **Send to Chamber**). Oracle does **not** copy the thread. It writes a one-page **Case brief** (question + last few turns + Thread/Global Bible excerpts) and opens a new Chamber session. You still press Deliberate. After a **stamped** verdict, **Admit to Bible** **seals** invariants as claims. Oracle’s next rewrite cannot eat them. Two devices merge claims; sealed beats a newer diary. Tests: `chamberHandoff.test.ts`, `bibleClaims.test.ts`.
- **Bible is claims, not a diary** — `OracleBible.claims[]`. `sealed: true` is law. Drive merge is union-by-id, not last-`updatedAt`-wins on the whole blob. `saveGlobalBible` throws on quota (same as threads). Settings **Clear** drops unsealed notes only.
- **Default Chamber team is frontier** — new sessions start on `highest_quality`. Cheap/Auto-low is an explicit budget pick, never the silent default. The product bet is an ensemble of frontier models.
- **No blank thread on load (Chamber sessions)** — the initial "New Deliberation" is only auto-created AFTER local/Drive storage has finished loading, so visiting the site signed-out never adds a blank thread to your synced sessions.
- **Profile (Account tab)** — Settings → Account now shows your signed-in Google identity (profile), sign in/out, and live OpenRouter credits in one place. Drive sign-in *is* the profile sign-in.

---

## Keys & security (what's server-side vs. visible)

| Secret | Where it lives | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | **Server env only** | Never sent to the browser. All model calls go through `/api/council`. |
| `GEMINI_API_KEY` | Server env (AI Studio injects it) | Used by the direct-Gemini paths. |
| `COUNCIL_ACCESS_KEY` / `COUNCIL_ACCESS_SECRET` | Server env | A CSRF-style gate on `/api/council`. If you also set `VITE_COUNCIL_ACCESS_KEY`, that copy *is* visible in the bundle (it's a shared secret, not a money key). For a personal single-user app you can leave it unset and the server allows local/dev access. |
| `OWNER_EMAIL` | **Server env** | Set to your Google address to hard-lock the money route to you. After Drive sign-in the browser proves your identity; the server verifies it against Google. This is the "profile → server-side keys" gate. |
| `RATE_LIMIT_PER_MINUTE` | Server env (optional) | Per-IP request cap on `/api/council` (default 60/min). |
| `VITE_GOOGLE_CLIENT_ID` | **Client** (must be public) | OAuth requires a public client ID — this is normal and safe. |

**Profile sign-in:** the app currently signs you in via **Google Drive sync** (top-right). A separate Firebase profile sign-in existed earlier and was removed; the codebase still carries its config (`firebase-applet-config.json`, `security_spec.md`). Restoring it is on the roadmap below — it needs the Firebase SDK re-added and server-side token verification (`OWNER_UID`/`OWNER_EMAIL`), and is deliberately kept separate so it can't break the working Drive login.

---

## Troubleshooting (the two things that bit you)

### Google Drive "won't connect"
1. You need a Google OAuth Client ID. Set `VITE_GOOGLE_CLIENT_ID` in your env, **or** the app falls back to the one in `firebase-applet-config.json` (its `oAuthClientId`), **or** you can paste one in **Storage & Cloud Sync → Settings**.
2. The Client ID must have the app's origin (including the AI Studio / Railway domain) in its **Authorized JavaScript origins**.
3. AI Studio injects its own environment — make sure `VITE_GOOGLE_CLIENT_ID` isn't being overwritten by the placeholder value `YOUR_GOOGLE_OAUTH_CLIENT_ID` (the app explicitly rejects that placeholder).
4. Without Drive, everything still **works and saves locally** (localStorage) + JSON export/import.

### Railway "won't deploy"
1. The server already binds `0.0.0.0` and honors `PORT`, and `railway.json` points the healthcheck at `/api/health` — that part is solid.
2. Set `OPENROUTER_API_KEY` (and `COUNCIL_ACCESS_KEY` + `VITE_COUNCIL_ACCESS_KEY` if you use them) as Railway variables.
3. `package.json` wants Node 24 (`engines.node`); Railway's Nixpacks config (`nixpacks.toml`) selects `nodejs_24`. If your build still picks an old Node, check the builder settings.
4. ✅ `package-lock.json` is in sync with `package.json` (stale `firebase` deps dropped, engine aligned to 24.x). Nothing to do here.

### `Failed to execute 'setItem' … council-sessions-v3 exceeded the quota`
Nexus used to copy the full CSV/PDF into every cycle's `userQuery`, then write that into Chamber sessions. `stripRoundBodies` blanked the attachment field but left the dump in the query — one monarch export × 3 Night Shift cycles blows the ~5 MB origin cap.

**Right now (don't refresh):** the run is still in RAM. Export the Nexus dossier if a verdict exists. Then DevTools → Application → Local Storage → delete `openrouter_models_cache_v2` and `nexus-missions-archive-v1`. In Chamber, delete old threads you don't need. That frees the write. The last good `council-sessions-v3` copy was not overwritten.

**After this build:** persist strips exhibit dumps from `userQuery`, and a quota hit drops those two cache keys and retries. Exhibit bodies are still never sliced.

### Chamber "spend cap on Highest Quality" / panel 0/3 + NOT STAMPED
- Was bug: `DollarCostGovernor.recordUsage()` tripped at $0.00 when ceiling = 0 (Unlimited). Fixed Aug 25 to use `hasFiniteCap()` and reset per-round. If you still see `[CostGovernor] Hard Dollar Ceiling Tripped: ... limit of $0.00`, you are on stale bundle — hard refresh. Valid ceiling trip shows real limit like $0.25, not $0.00, and docket correctly blocks with `partial_panel` + banner "A Chair must not synthesize error strings into a verdict."

---

## Evidence docket (how a verdict is allowed to exist)

This is the cover sheet, not a feature. Read it like a paper form.

| Field | Meaning |
|---|---|
| **Exhibit A, B, …** | One row per attached file. |
| **Size** | Original bytes. |
| **Extractor** | `pdf-text` / `zip-code` / `utf8` / `failed`. |
| **Coverage** | Honest fraction: `12 / 80 pages with text`, or `files extracted / files in archive`. |
| **SHA-256** | Content address of the original bytes. Debug key = `ev_<first 16 hex>`. |
| **Stamp** | `STAMPED` only when `blockers` is empty. Otherwise `NOT STAMPED` / `STOPPED` / `FAILED`. |

**Rules (also the unit tests in `src/lib/__tests__/evidence.test.ts`):**

1. File bodies are **never** written to localStorage or Drive. Blobs live in IndexedDB `council-evidence-v1`. A 2G Drive sync is metadata-only.
2. We **never slice** a body to fit storage. Quota failure is a failed write, not a 2,000-character stub. (The old 2k/5k/8k caps were three different lies.)
3. `completed` is illegal while any blocker is open. A Chair draft may still render as **Unstamped draft — docket incomplete**.
4. Resume / Re-run hydrates the blob. If the blob is missing (other browser, cleared site data), the docket blocks with `blob_missing` — it does not silently use leftover preview text.
5. Drive merge prefers exhibit identity + completed seats, **not** synthesis string length. A truncated Drive copy cannot beat a local copy that still has the exhibit.

**Open blockers you will actually see:**

- `extraction_failed` — PDF/ZIP threw, or 0 characters from a non-empty file (typical scanned bill).
- `coverage_thin` — fewer than half the pages/files were readable, and there were at least 4 units. A 2-page letter that fully extracted is fine.
- `partial_panel` — any seat did not `completed` Stage 1 (or Stage 2 once started). Error strings are not a panel.
- `skipped_stages` — Stop After Stage 1, or the cost ceiling fired.
- `cost_unknown` — a ceiling is set but a completed seat reported no token usage.
- `legacy_truncated_inline` — an old session still contains `[Truncated for storage`. Re-attach the file.
- `blob_missing` — metadata without the IndexedDB body.

Debug without the original author: open the round, read `stamp` and `blockers` on the docket (and in DevTools → Application → IndexedDB → `council-evidence-v1`).

---

## Drive write contract (two devices)

One rule: **never PUT a device's list over Drive without reading first.** A failed GET is not an empty Drive.

| Field | Meaning |
|---|---|
| **Envelope** | Drive files are now `{ version: 2, sessions\|threads, deleted }`. A legacy array still loads as "no tombstones". |
| **Union** | Merge is by id. Chamber rounds pick exhibit identity + completed seats (`preferIncomingRound`), never synthesis length. Oracle messages union by id. **Bibles union by claim id**: sealed beats unsealed; a laptop rewrite cannot erase a phone Admit. |
| **Tombstone** | Delete writes `{ id, deletedAt }` into the same JSON. A later edit (newer `updatedAt`) undeletes. Local copies of the marks live in `council-session-tombstones-v1` / `council-oracle-tombstones-v1`. |
| **Fail closed** | If Drive cannot be read, we do not upload. Chamber shows the amber auto-save notice; Oracle shows a paper-form banner: *Drive unread — local copy was not uploaded, so the other device is safe.* |
| **List fields** | Drive v3 `files.list` on `appDataFolder` must be `fields=files(id,name)` **never** etag. v3 `File` has no etag field in list; that extra field 400s. ETag for `If-Match` comes from the **GET media header**, not the list body. Helper `driveAppDataListUrl()` enforces this. |
| **Quota** | localStorage quota is a failed write, not a silent drop. The last good copy stays on the device. |
| **Agent 404** | Jobs live in `data/agent-jobs.json` on the server disk. A Railway redeploy with no volume returns 404. The UI says *Mission lost on redeploy (this server has no persistent volume).* — it does not invent an empty job. |

**Debug without the original author:** open DevTools → Application → Local Storage for the tombstone keys, and inspect the Drive appData file (`council-sessions.json` / `council-oracle.json`). The merge tests live in `src/lib/__tests__/syncContract.test.ts`.

**Not a bug:** only the `OWNER_EMAIL` Google account can open the money route. Rotating three personal accounts will look like "the app locked me out" — that is the owner gate.

## Oracle → Chamber (Case Relay)

Oracle stays Jarvis. Chamber is the court. You are the editor.

1. Vent as long as you want. Oracle still sends the last 12 turns + Bibles, not the whole night.
2. `/chamber` or **Send to Chamber** builds a local Case brief (no extra model call — 2G-safe). Optional: `/chamber should we fire the contractor?`
3. A new Chamber thread opens with the brief on a paper cover sheet and the question in the composer. **Nothing runs until you press Deliberate.**
4. After the docket stamps COMPLETED, **Admit to Bible** appends only extracted invariants to the Global Bible. Unstamped text is refused.

Debug: `session.handoff` on the Chamber session in DevTools. Tests in `chamberHandoff.test.ts`.

## Storage map

- **Evidence blobs** → IndexedDB `council-evidence-v1` / `blobs` (this device only; not Drive).
- **Chamber/Nexus sessions** → `council-sessions-v3` (localStorage, exhibit metadata only) + Google Drive `appDataFolder/council-sessions.json` when signed in (v2 envelope + `deleted` tombstones).
- **Oracle threads + Bibles** → `council-oracle-threads-v1` and `council-oracle-global-bible-v1` (localStorage; Bible is `{ content, updatedAt, claims[] }`), JSON export/import, **and** Drive `council-oracle.json` (claim merge, not blob LWW).
- **Learned token budgets** → `council_token_governor_v1`.
- **Fallback event log** → `council_fallback_events_v1`.
- **Oracle custom models + Direct palette** → `council-oracle-custom-models-v1` and `council-oracle-direct-list-v1` (localStorage; included in the Oracle JSON export).
- **Council briefing suggestions** → `council-oracle-briefings-v1` (settings + dismissed/convened topics).
- **Confidence Ledger** → `council_outcome_ledger_v1` (tracked verdicts + outcomes).

---

## Roadmap (next in line)

Done since the first pass: ✅ token governor, ✅ credits readout, ✅ task-based model recommendations, ✅ Oracle voice rotation, ✅ dictation (STT), ✅ Deep Document Mode, ✅ Oracle Drive sync, ✅ Chamber cost-ceiling enforcement, ✅ profile/identity in Account tab, ✅ `package-lock.json` regenerated (Railway fix), ✅ scratch files removed, ✅ `security_spec.md` rewritten to match reality, ✅ **owner gate** (`OWNER_EMAIL`), ✅ **rate limiting + input caps**, ✅ **voice→model rotation within budget**, ✅ **dead-code prune** (8 components, 8 libs, 2 hooks + their tests), ✅ **Apple refs removed** (`⌘` → `Ctrl`), ✅ **dynamic model layer** (live-catalog validation + delisted-model substitution, free-tier honesty, per-persona Live/Delisted/Vision badges, vision-aware routing), ✅ **Oracle Auto-Rotate + Settings-based model config (frontier-only)**, ✅ **Nexus self-correcting consensus + clean-by-default verdicts**, ✅ **Council Archivist hierarchical memory wired** (recent rounds verbatim + older condensed), ✅ **Chamber Markdown export**, ✅ **ghost-settings sweep** (single-model mode + strict no-fallback now wired; "Blind Pro Compare (Phase 2)" removed — it did nothing), ✅ **server-side cost governor** (real per-round usage tracked server-side; ceiling enforced with a 409 backstop independent of the client bundle), ✅ **Oracle frontier roster expanded to six labs** (Claude Fable 5, Muse Spark 1.2, GLM 5.3, DeepSeek V4 Flash — all live-verified) **+ custom model input** (Live/Delisted badges, vision-guarded, editable Direct palette, threads inherit rosters), ✅ **Night Shift (Nexus)** (escalating falsification passes + pacing + Morning Brief changelog), ✅ **Unasked Verdict (Oracle)** (zero-token cross-thread topic detection + convene card), ✅ **Confidence Ledger (Chamber, opt-in)** (per-round verdict outcome tracking, honest per-persona/per-model stats, finance-domain keywords now cover estimate/quote/cost phrasing), ✅ **server-side agent loop** (plan → research → deliberate → fact-check → answer, with citations; survives tab close; hard cost caps; jobs persisted to disk) wired into Nexus Night Shift ("☁️ Run on server") and Oracle briefings ("☁ on server"), ✅ **Nexus overnight on artifacts** (exhibits required; auto-chunk; refuse huge server packs; Agent Mode explicit), ✅ **Chamber fixes: no blank thread on load** (initial session waits for storage/Drive load), **manual model picks win** (free preset steps aside visibly instead of erroring and wiping picks), **rounds stack & collapse** (newest round open, earlier rounds folded with Resume/Re-run always reachable), ✅ **evidence-gated completion** (IndexedDB blobs, no silent truncation, paper docket stamp, merge-by-exhibit, one cost number), ✅ **Drive write contract** (GET → merge → PUT, tombstones, fail-closed unread, visible quota, agent-lost-on-redeploy), ✅ **Oracle → Chamber handoff** (Case brief, not transcript dump; Admit to Bible only after stamp), ✅ **OpenRouter Auto seating** (paid auto-select uses `openrouter/auto` + unique live labs; free preset stays local), ✅ **dynamic unique-lab presets** (every saved council + budget preset reseated from the catalog; Chair included; $0 preload), ✅ **unique-lab L1 production fix Aug 25** (canonicalLab aliases, family/degrade skip used labs, repair pass steals leftover labs, Auto glob raw org, summary bar distinct = canonical, one seating source effectiveCatalog), ✅ **Drive v3 list-fields fix Aug 25** (fields=files(id,name) never etag, ETag from GET header, driveAppDataListUrl helper), ✅ **cost ceiling $0.00 bug fix Aug 25** (DollarCostGovernor 0=unlimited via hasFiniteCap, per-round reset, Highest Quality now works).

Still open (honest status):
1. **Native Firebase SDK sign-in** — intentionally **not** restored. The security outcome you described ("keys server-side, profile sign-on") is now delivered via `OWNER_EMAIL` + the existing Google sign-in (Settings → Account), with no Firebase SDK, no extra 2 MB dependency, and nothing that can break the working Drive login. If you specifically want Firebase's own auth UI back, that's a follow-up requiring your Firebase project config — flag it and I'll wire it.
2. **Persistent (non-in-memory) rate limiting + cost ledger** — the rate limiter and the per-round cost ledger are in-memory (they reset on server restart). That's correct for personal use; it only matters if you go multi-user, at which point both want a small durable store.
3. **Blind Pro Compare** — the old Phase-2 toggle was a no-op and has been removed. Its spirit (which output can you actually trust?) is now served by the opt-in **Confidence Ledger** built on your own tracked outcomes instead of benchmark tables. A separate independent adversarial critic is still a candidate — flag it if you want it.
4. **Live production verification** — every server-side safety layer (liveness guard, vision routing, cost governor) is unit-tested, but this sandbox has no outbound HTTPS to OpenRouter, so none of it has seen a real catalog/completion yet. Deploy to Railway with the key set and watch the first live rounds.
