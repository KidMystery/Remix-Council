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

- **Auto-named threads** — Chamber, Oracle, and Nexus name themselves from your first question. Chamber and Oracle have their own thread lists. **Nexus missions are threads too**: the left sidebar lists the live job plus the archive. Follow-up mints a new mission (parent stays clickable) and carries ~4k of the prior consensus — it does not chew another cycle on the same job, and it does not dump into a Chamber thread. Rename via the pencil. New Mission parks the current job; Reset removes it.
- **Token Governor (adaptive tokens)** — in the Oracle, if an answer gets cut off it automatically continues ("pick up where you left off") with a bigger budget. You'll see a small `auto-expanded tokens ×N` note when that happens. It does **not** shrink the next turn after a short answer, and it never stamps `tokens trimmed to fit` — you get the raw reply. (Chamber uses fixed per-stage limits from Settings.)
- **Credits remaining** — a live "Credits: $X" badge in the top-right header (click to refresh), a bigger one in the Oracle header, and a full **Account & Credits** panel in Settings → Account. It reads from OpenRouter through the **server proxy**, so your API key never touches the browser.
- **Chamber Auto seats unique labs** — a council preset stores people, not a shrine to Claude. When Auto-select is on, every budget preset and every saved council (builtin + yours) is reseated from the **live catalog**: N enabled seats including the Chair get N different labs (Meta, Qwen, DeepSeek, whoever is actually good this week). Personality only decides who picks first. Paid runs still call `openrouter/auto` with `allowed_models: [lab/*]`. Preload is $0 on catalog/roster update — not four paid completions. Thin catalog: unique labs → unique families → run + one toast. Auto-select **off** keeps the snapshot you parked. Default budget is **Highest Quality**. Oracle stays Auto. **L1 production fix Aug 25:** uniqueness uses `canonicalLab()` aliases (`deepseek-ai` → `deepseek`, `meta-llama` → `meta`, `xai` → `x-ai`, `mistralai` → `mistral`) so two DeepSeek Flash variants (Latest + 0731) cannot both seat; family/degrade **never** reuse a seated lab while unused labs remain; repair pass steals leftover labs; Auto glob stays **raw** org (`meta-llama/*` not `meta/*`); summary bar distinct count = `canonicalLab`, not raw first path segment. **One seating source:** `App.tsx` uses `effectiveCatalog` — hook catalog when its length >= direct `fetchCouncilModels`, so Auto doesn't seat from a thinner list.
- **Per-persona model health badges** — each panelist's model card shows **Live** (verified in the live catalog) or **Delisted** (not found — will auto-substitute or fail in strict mode), plus a **Vision** / **Text-only** chip from the model's architecture. Only shown when a live catalog is loaded.
- **Per-round cost ceiling (client + server)** — Settings → Advanced → "Per-Round Cost Ceiling". **0 = unlimited** on client and server (no hidden $2 default). When set, the Chamber skips remaining stages and the server refuses extra calls (HTTP 409) using real usage. Hitting the ceiling **blocks the docket** — it is not a stamped verdict. Missing usage under a ceiling is `cost_unknown`. **Fixed Aug 25:** client `DollarCostGovernor.recordUsage()` now checks `hasFiniteCap()` so 0=unlimited never trips (was `$0.0002 reached limit of $0.00`), and governor resets per-round so 2nd deliberation doesn't inherit 1st round's spend. Server `RoundCostLedger.exceeded()` already required `ceiling > 0`.
- **Modality-aware routing (vision guard)** — images are Oracle-only. If you attach a picture and the resolved model can't read images, the turn is routed to a **live catalog vision model** (or OpenRouter Auto if the catalog is empty) and the swap is noted in the reply header. In Mini Deliberation the panel is filtered to vision-capable models. You're never silently wasting a turn on a model that can't see.
- **Council Archivist memory (Chamber)** — Settings → Advanced → "Archivist Recent Rounds Window" (1–5). The N most recent rounds stay **verbatim** in the panel's memory; older rounds are condensed into an executive summary. This is what keeps long deliberations coherent without blowing the context window.
- **Single-model fast mode (Chamber)** — Settings → Advanced → "Use Single Model for Simple Questions" pins new deliberations to the Quick Panel (one primary model, no peer review). "Strict No-Fallback Mode" surfaces raw model errors instead of silently swapping models (for diagnosing a specific model).
- **Export (Chamber + Nexus)** — Chamber: "Export .md" in the action toolbar downloads the whole thread (queries, proposals, critiques, syntheses, web sources) as Markdown. Nexus: the mission Dossier export.
- **Oracle model & modes (Settings, not the main page)** — the Oracle main page stays clean; which model(s) it uses and how is configured in **Settings → Oracle → Model & Modes**: mode picker (Direct / Mini Deliberation / Auto-Rotate), an editable model palette for Direct (click to select, × to remove, add/randomize/defaults), and roster chip editors (add/remove/randomize/defaults) for the other two. The curated list is current-frontier only and spans six labs (Anthropic incl. Claude Fable 5, OpenAI, Google, Meta Muse Spark 1.2, Z.ai GLM 5.3, DeepSeek V4 Flash — every id live-verified against the OpenRouter catalog on Aug 24, 2026, vision flags taken from catalog architecture).
- **Oracle custom models (Settings → Oracle)** — type a name (`glm`, `claude`, `muse spark`) and the live catalog completes it. You do not need the exact `provider/slug`. The pick is validated against the catalog and badged **Live / Delisted / Unverified (offline)** with **Vision / Text-only**, then joins the Direct palette and every roster picker. Provider errors retry via **OpenRouter Auto** (`openrouter/auto`) — that also switches the thread to **Direct** so a dead Auto-Rotate roster does not keep failing. The reply chip shows which model actually answered. Vision turns pick a **live catalog vision model**, or Auto if the catalog is empty. Auto-Rotate skips delisted roster ids. New Oracle threads copy rosters and toggles but **start on Direct**. Thread tabs title from the ask (the end of a rant, not the first five words). Drive merge keeps the **newer** mode/model — a stale Auto-Rotate copy cannot snap Direct back.
- **Voice rotation (Oracle)** — the Oracle cycles through six analytical voices (Skeptic, Visionary, Pragmatist, Synthesist, Strategist, Teacher) on the same model, so each turn has a different perspective. Toggle "Voices" on/off per thread.
- **Speech** —
  - *Listen:* every Oracle reply and every Chamber panelist card has a read-aloud button.
  - *Dictate:* the **Dictate** (mic) button in the Oracle and Chamber composers uses your browser's speech-to-text so you can talk instead of type (Chromium browsers: Chrome, Edge, Brave, Arc).
- **Web grounding** — the Oracle has a "Web" toggle; the Chamber honors the Settings → Web mode (off/auto/always). Live citations come back through the server proxy.
- **Evidence docket (Chamber + Nexus)** — attachments are exhibits, not prompt stuffing. Each file is hashed (SHA-256), extracted, and stored as a **blob on this device** (IndexedDB). Session / Nexus / Oracle JSON carry **metadata only** (name, size, coverage, hash) — never a body, never a slice. When you are signed in, the extracted UTF-8 is also a hash-addressed Drive file (`council-blob-<id>.txt` in appDataFolder) so a phone / home laptop / brother’s phone can hydrate on open. Original PDF bytes stay off Drive. A round cannot be **stamped COMPLETED** while blockers are open (partial panel, unread/thin PDF, missing blob, skipped stages, unknown spend under a ceiling). The paper-form docket on each round is the cover sheet: what was uploaded vs what was actually read. Resume re-reads the blob (local, then Drive), never a 2k stub.
- **Attachments** — text/code files, PDFs, and ZIP/RAR codebases in Chamber + Nexus; the Oracle adds **images** (vision) + files. Image turns are modality-guarded: if the chosen model is text-only it's auto-routed to a vision model (see above). Nexus ZIP/RAR rows have an **eye** that opens the extracted file tree (live extract, or rebuilt from the dump after hydrate).
- **Sandboxed Code Verifier (Nexus)** — Autonomous Tool Matrix toggle (on by default, hidden in Agent Mode). After each proposal pass it parses JSON and compiles JS from fenced blocks plus `.js`/`.json` exhibits, then hands the report to the Chair. **Compile/parse only — snippets are never executed.** Other languages are marked skipped. Telemetry logs `ok / error / skipped`.
- **Nexus overnight on artifacts** — a fresh mission needs exhibits (tree / CSV / statement / PDF). Follow-up of a finished mission may carry the prior consensus without new files. Large files are **always** split into ~20-page parts (pages-per-part still tunable). Every part is read; the cycle budget cannot drop unread pages. Server jobs ship exhibits up to hard caps (16 files / 4M chars — refused beyond, never silently sliced): ≤50k chars ride inline in one read; larger sets are walked part-by-part in a server **reading phase** (same chunker as local Autonomous), distilled into a bounded ledger that deliberation and the verdict verify against. Exhibit bodies live only in server memory — disk persistence and every poll response carry redacted placeholders. Tests: `nexusExhibits.test.ts`, `agentLoop.test.ts`.
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

## Where the logs live (for agents)

The server keeps a structured event log — auth rejections, rate-limit hits,
upstream model failures, and unhandled route errors — and exposes it to
**agents** (Hermes, Arena sessions, future good samaritans) at:

```
GET /api/diagnostics/events?limit=100        (newest first, JSON)
Header: x-council-key: <COUNCIL_ACCESS_KEY>  (or the owner's Google token)
```

Event shape: `{ ts, level: error|warn|info, scope: auth|ratelimit|upstream|server, message, meta }`.
The in-memory ring (last 500) is the source of truth — it resets on
redeploy (Railway is ephemeral); `data/events.jsonl` is a best-effort copy.
When the operator says "read the handbook, something broke": pull that
endpoint, filter `level=error`, and correlate timestamps. Do not guess.

**Owner-gate contract (pinned by `ownerGate.test.ts`):** `OWNER_EMAIL` set +
no council key + no owner token → **401, always** (a live audit caught the
old code waving anonymous POSTs through when only one gate was configured).

## Keys & security (what's server-side vs. visible)

| Secret | Where it lives | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | **Server env only** | Never sent to the browser. All model calls go through `/api/council`. |
| `GEMINI_API_KEY` | Server env (AI Studio injects it) | Used by the direct-Gemini paths. |
| `COUNCIL_ACCESS_KEY` / `COUNCIL_ACCESS_SECRET` | Server env | A CSRF-style gate on `/api/council`. If you also set `VITE_COUNCIL_ACCESS_KEY`, that copy *is* visible in the bundle (it's a shared secret, not a money key). For a personal single-user app you can leave it unset and the server allows local/dev access. |
| `OWNER_EMAIL` | **Server env** | Set to your Google address to hard-lock the money route to you. After Drive sign-in the browser proves your identity; the server verifies it against Google. This is the "profile → server-side keys" gate. |
| `RATE_LIMIT_PER_MINUTE` | Server env (optional) | Per-IP request cap on `/api/council` (default 60/min). |
| `HERMES_WEBHOOK_URL` | Server env (optional) | Phase 4 "return wire": when set, the server POSTs JSON lifecycle events (`mission_completed` / `mission_paused` / `mission_failed`, `oracle_entry_appended`, `obligation_flagged`) to this URL — fire-and-forget, 5s timeout, failures land in diagnostics events (`data/events.jsonl`), never thrown. **Unset = fully disabled, zero behavior change.** An agent may also self-identify with the `x-agent-name` header (default `"web"`); it is stored on nexus missions + oracle entries and included in webhook payloads — metadata only, never auth. |
| `VITE_GOOGLE_CLIENT_ID` | **Client** (must be public) | OAuth requires a public client ID — this is normal and safe. |

**Profile sign-in:** the app currently signs you in via **Google Drive sync** (top-right). A separate Firebase profile sign-in existed earlier and was removed; the codebase still carries its config (`firebase-applet-config.json`, `security_spec.md`). Restoring it is on the roadmap below — it needs the Firebase SDK re-added and server-side token verification (`OWNER_UID`/`OWNER_EMAIL`), and is deliberately kept separate so it can't break the working Drive login.

---

## Troubleshooting (the two things that bit you)

### Google Drive "won't connect"
1. You need a Google OAuth Client ID. Set `VITE_GOOGLE_CLIENT_ID` in your env, **or** the app falls back to the one in `firebase-applet-config.json` (its `oAuthClientId`), **or** you can paste one in **Storage & Cloud Sync → Settings**.
2. The Client ID must have the app's origin (including the AI Studio / Railway domain) in its **Authorized JavaScript origins**.
3. AI Studio injects its own environment — make sure `VITE_GOOGLE_CLIENT_ID` isn't being overwritten by the placeholder value `YOUR_GOOGLE_OAUTH_CLIENT_ID` (the app explicitly rejects that placeholder).
4. Without Drive, everything still **works and saves on this device** (IndexedDB) + JSON export/import.

### Google login popped 4× while you slept
The GIS access token lives in RAM only (~1 hour). A 401 used to call `signInWithGoogle()` with `prompt: 'select_account'`, which is an account picker. Chrome blocked the unattended popups, so Drive never saved; the tab kept running in RAM.

**After this build:** a 401 tries **one silent refresh** (`prompt: ''`). If that fails, a morning banner says *Drive signed out overnight* and the lab keeps writing locally. The picker only opens when you click **Reconnect Drive**.

This browser also remembers `council-drive-wanted`. On the next load, if that flag is set and there is no RAM token, the app tries **one silent** `prompt: ''` and never a picker. Fail → the same amber banner. A new device (brother's phone, a fresh laptop) has no wanted-flag, so it stays quiet until you click **Sign in** once.

### Nexus empty on the other device
Nexus used to write only IndexedDB on this machine. Chamber got a stripped paper trail via `onCompleteRound`, so the other device looked like the mission never happened.

**After this build:** Nexus writes `appDataFolder/council-nexus.json` (GET → merge → PUT). Sign-in and `DRIVE_AUTH_RESTORED` hydrate the active mission + archive. Mission ids stay stable across persist cycles so merge does not treat every save as a new job.

**Honest limits:** a brand-new browser still needs one Google click. Mid-flight RAM on the home tab may be ahead of the last Drive PUT. CSV/PDF **bodies** stay on the originating device in `council-evidence-v1` — the other device gets verdicts + metadata, not the blob.

### Railway "won't deploy"
1. The server already binds `0.0.0.0` and honors `PORT`, and `railway.json` points the healthcheck at `/api/health` — that part is solid.
2. Set `OPENROUTER_API_KEY` (and `COUNCIL_ACCESS_KEY` + `VITE_COUNCIL_ACCESS_KEY` if you use them) as Railway variables.
3. `package.json` wants Node 24 (`engines.node`); Railway's Nixpacks config (`nixpacks.toml`) selects `nodejs_24`. If your build still picks an old Node, check the builder settings.
4. ✅ `package-lock.json` is in sync with `package.json` (stale `firebase` deps dropped, engine aligned to 24.x). Nothing to do here.

### `Failed to execute 'setItem' … council-sessions-v3 exceeded the quota`
Nexus used to copy the full CSV/PDF into every cycle's `userQuery`, then write that into Chamber sessions. `stripRoundBodies` blanked the attachment field but left the dump in the query — one monarch export × 3 Night Shift cycles blows the ~5 MB origin cap. Drive is 15 GB+ — that was never the local ceiling.

**If you are still on the old tab:** do not refresh first. The run is still in RAM. Export the Nexus dossier if a verdict exists. Then DevTools → Application → Local Storage → delete `openrouter_models_cache_v2` and `nexus-missions-archive-v1`. In Chamber, delete old threads you don't need. The last good `council-sessions-v3` copy was not overwritten.

**After this build:** Chamber sessions, Nexus missions, and Oracle threads write to IndexedDB (`council-kv-v1`). After a successful IDB write the fat localStorage keys are dropped. Persist still strips exhibit dumps from `userQuery`. A leftover localStorage quota hit drops those two cache keys and retries. Exhibit bodies stay out of JSON and are never sliced. Local cache is `council-evidence-v1`; signed-in follow is `council-blob-<id>.txt`. Drive is still the sync target. Fail closed: last good copy stays. The new store is live after deploy + reload.

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

1. File bodies are **never** written to localStorage or to the JSON envelopes (`council-sessions.json` / `council-nexus.json` / `council-oracle.json`). Local cache is IndexedDB `council-evidence-v1`. Signed-in follow is a separate hash-addressed Drive file (`council-blob-<id>.txt`) of extracted UTF-8 — not the original PDF. We never slice a body to fit.
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
- `blob_missing` — metadata without the body on this device or Drive (or Drive was unread).

Debug without the original author: open the round, read `stamp` and `blockers` on the docket (and in DevTools → Application → IndexedDB → `council-evidence-v1`).

---

## Drive write contract (two devices)

One rule: **never PUT a device's list over Drive without reading first.** A failed GET is not an empty Drive.

| Field | Meaning |
|---|---|
| **Envelope** | Chamber/Oracle Drive files are `{ version: 2, sessions or threads, deleted }`. Nexus is `{ version: 2, updatedAt, mission, archive, deleted }` in `council-nexus.json`. A legacy Chamber/Oracle array still loads as "no tombstones". |
| **Union** | Merge is by id. Chamber rounds pick exhibit identity + completed seats (`preferIncomingRound`), never synthesis length. Oracle messages union by id. **Bibles union by claim id**: sealed beats unsealed; a laptop rewrite cannot erase a phone Admit. |
| **Tombstone** | Delete writes `{ id, deletedAt }` into the same JSON. A later edit (newer `updatedAt`) undeletes. Local copies of the marks live in `council-session-tombstones-v1` / `council-oracle-tombstones-v1` / IndexedDB `nexus-deleted`. |
| **Fail closed** | If Drive cannot be read, we do not upload. Chamber shows the amber auto-save notice; Oracle shows a paper-form banner: *Drive unread — local copy was not uploaded, so the other device is safe.* |
| **List fields** | Drive v3 `files.list` on `appDataFolder` must be `fields=files(id,name)` **never** etag. v3 `File` has no etag field in list; that extra field 400s. ETag for `If-Match` comes from the **GET media header**, not the list body. Helper `driveAppDataListUrl()` enforces this. |
| **Quota** | IndexedDB is the local ceiling. A failed write is not a silent drop. The last good copy stays on the device. |
| **Token death** | Overnight 401 → one silent GIS refresh. Fail → banner, no `select_account` picker. Lab keeps writing locally. Same-browser reopen: if `council-drive-wanted` is set, one silent restore on load. |
| **Agent 404** | Jobs live in `data/agent-jobs.json` on the server disk. A Railway redeploy with no volume returns 404. The UI says *Mission lost on redeploy (this server has no persistent volume).* — it does not invent an empty job. |

**Debug without the original author:** open DevTools → Application → IndexedDB → `council-kv-v1` → `kv` (sessions / nexus / oracle) and `council-evidence-v1` → `blobs`. Leftover localStorage keys are migrate-from only. Drive appData is `council-sessions.json` / `council-oracle.json` / `council-nexus.json` plus `council-blob-<id>.txt` for extracted text. Tests: `syncContract.test.ts`, `driveAuth.test.ts`, `localSessionStore.test.ts`, `nexusMission.test.ts`, `evidenceDrive.test.ts`.

**Not a bug:** only the `OWNER_EMAIL` Google account can open the money route. Rotating three personal accounts will look like "the app locked me out" — that is the owner gate.

## Oracle → Chamber (Case Relay)

Oracle stays Jarvis. Chamber is the court. You are the editor.

1. Vent as long as you want. Oracle still sends the last 12 turns + Bibles, not the whole night.
2. `/chamber` or **Send to Chamber** builds a local Case brief (no extra model call — 2G-safe). Optional: `/chamber should we fire the contractor?`
3. A new Chamber thread opens with the brief on a paper cover sheet and the question in the composer. **Nothing runs until you press Deliberate.**
4. After the docket stamps COMPLETED, **Admit to Bible** appends only extracted invariants to the Global Bible. Unstamped text is refused.

Debug: `session.handoff` on the Chamber session in DevTools. Tests in `chamberHandoff.test.ts`.

## Handoff — Aug 30, 2026, overnight (docs truth pass; fixes already guarded)

**Who this is for:** the next engineer (human or agent). Read the top of this
handbook first — architecture, invariants, Drive contract, storage map — then
this section for current state.

### State of the world
- `main` is at the **provider-error handling** merge (`10cde00`): real provider
  errors are surfaced (status codes kept, not swallowed), retries are
  classified (auth/quota errors are not retried blindly, transient ones are),
  and DeepSeek slugs use `-latest` variants validated against the live catalog.
- Verified this session: `npx tsc --noEmit` → **0 errors**; `npm test` →
  **421 passed / 421 across 49 test files**. Do not believe older handoff
  sections' test counts — they are historical snapshots.

### Setup for a new engineer
1. `npm ci` (lockfile is committed — keep it that way).
2. Copy `.env.example` → `.env`. Vars, all server-side unless `VITE_`-prefixed:
   - `OPENROUTER_API_KEY` — required, model calls through the proxy. On
     Railway ONLY in production; never in the client bundle.
   - `GEMINI_API_KEY` — only for the Gemini-native voice/image routes in `server.ts`.
   - `OWNER_EMAIL` + `COUNCIL_ACCESS_KEY` (+ `VITE_COUNCIL_ACCESS_KEY`) — owner
     gate and diagnostics access. Without them the money routes correctly refuse.
   - `RATE_LIMIT_PER_MINUTE`, `AGENT_MAX_JOB_COST_USD`, `AGENT_DEFAULT_MODEL`,
     `AGENT_DATA_DIR` — see the agent-loop section above.
   - `VITE_GOOGLE_CLIENT_ID` — Google sign-in for Drive/profile.
3. Run: `npm run dev` (tsx serves `server.ts` + Vite). Test: `npm test`.
   Lint/type: `npx tsc --noEmit`. Build: `npm run build` → `npm start`.
4. Deploy: push `main` → Railway auto-deploys. Never push experimental code
   to `main`.

### Module map (the short version)
- `server.ts` — Express proxy, owner gate, rate limiting, diagnostics event
  log (`GET /api/diagnostics/events`), cost ledgers; mounts `src/server/agentLoop.ts`.
- `src/server/agentLoop.ts` — server agent jobs: plan → research → deliberate
  (max 5 passes, hard $ cap, prior-consensus carry-over) → finalize.
- `src/lib/` — model catalog/scoring (`modelScoring`, `modelCache`),
  seating (`serverModelAllocator`, `autoRouter`), cost (`costGovernor`,
  `dollarCostGovernor`), evidence (`evidence*`), sync (`syncContract`,
  `drivePersistence`), Oracle memory (`oracleStore`, `bibleClaims`),
  Nexus planning (`nexusMission`, `nexusExhibits`), fallback (`fallbackManager`).
- `src/components/` — Chamber (`CouncilChamber`, `council/`), Nexus
  (`NexusLabView`), Oracle (`OracleView`), settings (`settings/`, `SettingsPanel`).
- `src/lib/archetypes.ts` — persona archetypes (fields: id, name, role,
  avatar, color, systemPrompt, recommendedModel — **no `category` field**).

### Audit notes from this session (all verified against code)
- **Oracle bible size** is already guarded: `MAX_BIBLE_CHARS` (12,000) in
  `bibleClaims.ts`, `capBible()` drops oldest-unsealed first (never sealed),
  `renderBiblePrompt` caps working notes at 1,500 chars, and an over-cap
  sealed-only bible throws honestly instead of dropping law. No further
  compression needed — don't add a second mechanism.
- **Nexus stop conditions** are already guarded: server loop clamps
  `maxDeliberationPasses` to 1–5, checks the per-job cost cap after every
  model call (`stopped_budget`), carries the previous consensus into each
  falsification pass; the local in-tab loop is bounded by the plan length
  (UI selects 3–8 Night Shift cycles), checks `pauseRequestedRef` between
  passes, and carries `previousSynthesis` forward.
- **`CouncilSettingsModal`** exists only on the `rescue-zip-only` branch. It
  references `arch.category`, which no `PersonaArchetype` has, and nothing on
  `main` imports it. It was **not** ported forward on purpose: landing it
  means adding a type field + wiring a dead component — a feature decision,
  not a bug fix. Port it only if the operator asks for that Settings modal.

### House rules (unchanged, still enforced)
Work on branches; `npx tsc --noEmit && npm test` green before any merge to
`main`; push `main` after each green merge; never delete features, touch
secrets, or break public behavior; log every action in `WORKLOG.md`.

## Handoff — Aug 28, 2026, 1pm (PR #11: completion token refresh, unbranded Nexus personas, cache vision preservation)

**Who this is for:** the next agent working with the operator. He is a non-coder
and a researcher — give him ELI5 numbered steps and paste-boxes, verify every
claim against the repo, and write fail-tests before fixes. He will do the same
to you. That's the deal, and it works.

**First action:** `gh pr view KidMystery/Remix-Council#11`. If OPEN: it is
verified (408/408 tests, tsc clean, build green at `e2ca13b`) and awaiting his
merge tap — nudge him, don't merge for him. Then: Railway green → run the
**Live audit** workflow (Actions → Run workflow → base URL) → expect **5/5**.

### State of the world
- **PR #10 was merged** at `d0bb561` by the operator.
- **PR #11 delivers three fixes + failsafe tests (408/408 green):**
  1. **Completion Mechanics (401 Owner Gate Recovery):** When Google auth token expires after ~1 hour, same-origin model calls to `/api/council` receive `401 (Sign in required)`. Added `refreshOwnerTokenSilently()` via `signInWithGoogle({ prompt: 'none' })` into `openrouter.ts` (with deduplication across parallel seats) and retries once so deliberations never get blocked by token expiry. `fallbackManager.ts` rethrows `OwnerAuthError` immediately without burning through backup candidates on an auth gate. Pinned by `src/components/__tests__/completionMechanics.test.tsx` (all 3 passing), `openrouterStream.test.ts`, and `fallbackManager.test.ts`.
  2. **Nexus Persona Branding Purged:** Removed hardcoded model brands (`Claude Sonnet 4.5`, `GPT-4o`, `Gemini 2.5 Flash`, `DeepSeek R1`, `Gemini 2.5 Pro`) from system prompts, names, and dropdowns in `NexusLabView.tsx`. Personas are pure analytical roles (The Architect, The Executor, The Verifier, The First-Principles Analyst, The System Designer, The Context Synthesist) with neutral IDs (`nexus_architect`, `nexus_executor`, etc.). Pinned by `src/components/__tests__/nexusRosterPersonalities.test.ts`.
  3. **Cache-Vision Contradiction Resolved (Nexus Finding §3.7):** `pruneModelForCache()` in `src/lib/modelCache.ts` now preserves `architecture.input_modalities` and `architecture.modality` (~20 bytes) so cached models in localStorage retain their vision capability. Pinned by `src/lib/__tests__/pureFunctions.test.ts`.
  4. **Workspace / Test Hygiene:** `serverEventLog.test.ts` uses `/dev/null/not/a/path/events.jsonl` so it never creates a junk `Z:\` directory in the workspace on Linux.
- **Nexus Self-Audit Findings (Part 4/14 Synthesis) Triage:**
  - *Oracle Model IDs:* Verified against `src/lib/oracleModelPool.ts` and `src/lib/oracleStore.ts` — Oracle always persists prefixed `provider/slug` IDs (`google/gemini-2.5-flash`), so it is not impacted by bare-ID exemptions.
  - *Complaint B ("no ping when a model dies"):* Model health remains static set-membership against the loaded catalog. Active probe / runtime-death eviction is prioritized on the backlog.
  - *Liveness-aware Fallback:* `computeOrderedBackupList` currently checks exclusion only; candidate validation for catalog presence and vision capability is queued for the next cycle.
  - *Undelete Clock-Skew:* `isTombstoned` and `mergeOracleThreads` undelete with `updatedAt > deletedAt` has no monotonic/skew guard.

### House rules (his own, enforced)
1. Nothing new until the last thing is boring. Merge when verified, then stop touching it.
2. Fail-test first (red → green); every fix rides with tests; full board before push: `npx tsc --noEmit && npx vitest run && npm run build`.
3. One ping at a time — on the app AND on him.
4. After the closing merge, this Arena channel can never merge again — work via branches/PRs and his tap.

### Backlog (priority order)
1. Post-merge: PR #11 merge tap → audit 5/5 → add `COUNCIL_ACCESS_KEY` to Railway → re-audit.
2. Liveness-aware fallback in `fallbackManager.ts` (verify backup candidates are in catalog and match vision requirements).
3. Clock-skew defense in `syncContract.ts` for thread undelete.
4. From the 92% free-run consensus: JSON-schema consensus scores (harmonize the 85/50 fallbacks); web-search tool fees into DollarCostGovernor; rate-limiter LRU.
5. Night mechanic (Hermes fixes Council).
6. Life ops on Hermes.

## Handoff — Aug 28, 2026, 9am (closing session: live audit, security fix, agent event log, Hermes day one)

**Who this is for:** the next agent working with the operator. He is a non-coder
and a researcher — give him ELI5 numbered steps and paste-boxes, verify every
claim against the repo, and write fail-tests before fixes. He will do the same
to you. That's the deal, and it works.

**First action:** `gh pr view KidMystery/Remix-Council#10`. If OPEN: it is
verified (400/400 tests, tsc clean, build green at `d7296e9`) and awaiting his
merge tap — nudge him, don't merge for him. Then: Railway green → run the
**Live audit** workflow (Actions → Run workflow → base URL) → expect **5/5**.

### State of the world
- **Council lives on Railway** (~$5/mo Hobby, usage-capped): https://remix-council-production.up.railway.app — a thin stateless proxy; the brain is Drive `appDataFolder` + IndexedDB. AI Studio is retired (work filter; Railway is the future-proof pick).
- **PR #10 = eleven fixes**: lockfile, stream-abort hygiene, Nexus server-by-default, Oracle Auto-Rotate error storm, Oracle error-litter pruning, Nexus mission summaries + server-job sweep, thread summaries everywhere, consensus copy button, **owner-gate hole fix**, **agent event log**, **Chamber refresh-erase fix** (stage boundaries now persist immediately + pagehide flush).
- **Security:** the live audit caught a REAL hole (OWNER_EMAIL set + no council key + no token was waved through — strangers could spend his credits). Fixed + pinned by `ownerGate.test.ts`. `OPENROUTER_API_KEY` lives in Railway ONLY (+ $10 hard account cap). GitHub holds the `COUNCIL_ACCESS_KEY` secret; **TODO: add the same key as a Railway variable** so Hermes can read diagnostics.
- **Diagnostics:** `GET /api/diagnostics/events` — see § *Where the logs live (for agents)* above. When he says "something broke," pull it; don't guess.
- **Hermes ("Jarvis Vision") is ALIVE:** Windows laptop install, private Slack workspace, bot `@jarvis_vision`, Socket Mode. The **bedtime cron (10:30pm ET, shower line every other night) is HIS now**; the GitHub ntfy workflow v1.1 is the backup clock (Actions cron dies after 60 days of repo inactivity — any push keeps it alive). Tool fence: **Slack = voice/eyes/memory/cron only (no terminal, files, code, browser, or Computer Use on Slack; CLI is the workshop; Computer Use OFF everywhere).** Gateway does NOT auto-start on reboot → `hermes gateway`. 24/7 later = managed host (~$7/mo, Moltis-class — never a raw VPS this season). Known cosmetic Windows bug: `shutdown_watchdog` asyncio traceback in the logs — ignore.
- **A2A tool (#24, off)** is the future Council↔Hermes bridge tech — Hermes already ships both directions.

### Environment notes for Arena agents (the gremlins)
- Sandbox has **no direct internet**: use the web_search/fetch tools + `gh api`. Actions runners CAN reach the net (curl inside workflows). `gh run --log` is blocked — read per-step conclusions via the actions jobs API instead.
- You **cannot create or dispatch workflow files** (permission denied) — write the YAML, have him paste it into a new file and tap Run.
- `node_modules` doesn't persist between turns; `npm ci` first (the lockfile is committed — keep it that way).
- **The snapshot gremlin:** local git state can silently revert between turns. Before committing: `git fetch origin` + compare `git ls-remote`. Re-anchor with `git reset --mixed <remote-tip>`, then verify your commit's `--stat` BEFORE pushing. Never force-push blind; lease-only, own branch only.

### House rules (his own, enforced)
1. Nothing new until the last thing is boring. Merge when verified, then stop touching it.
2. Fail-test first (red → green); every fix rides with tests; full board before push: `npx tsc --noEmit && npx vitest run && npm run build`.
3. One ping at a time — on the app AND on him.
4. After the closing merge, this Arena channel can never merge again — work via branches/PRs and his tap.

### Backlog (priority order)
1. Post-merge: audit 5/5 → add `COUNCIL_ACCESS_KEY` to Railway → re-audit.
2. From the 92% free-run consensus (fact-checked: zero fabrications): JSON-schema consensus scores (harmonize the 85/50 fallbacks); web-search tool fees into DollarCostGovernor; rate-limiter LRU (low priority, single user). NOT a bug: server 110s / client 120s watchdog ordering is deliberate (server kills first, client is the backstop).
3. **Night mechanic** (Hermes fixes Council), four-rail fence: objective triggers ONLY (exception, error string, stall, healthcheck — never taste); reproduce → fix → full suite green or don't push; bounded blast radius (fix branch, ≤2/day, auto-revert on healthcheck fail, never secrets/Drive); receipts + tap-to-merge (auto after 60 boring days).
4. **Life ops on Hermes:** email triage (read-only, DRAFT never send); watchtower (market-data APIs — there is NO official Robinhood API; draft the consideration, he taps Buy; TQQQ $62.50/week is LOCKED LAW); escalation ladder (one-tap ack; miss → email → wife/brother; conservative thresholds or it gets muted in two weeks).
5. Budgeting = his actual fire: Nexus missions on the monthly CSVs with locked constraints, UNKNOWNs stay UNKNOWN.

### The North Star (the operator's words, Aug 28 — treat as the product spec)
> "hey jarvis remove those duplicate files from my seedbox, tell oracle man i gotta this order that order havent watered the plants i need a haircut and im still thinking about that girl because my wife and i are fighting, hey you're looking for dopamine buy your wife some flowers i'll tell jarvis to send you a reminder, these are the order to do your orders in, there will be a ping at 7pm to water the plants we've drafted an email for you to leave early on thursday and set a ping to remind you to schedule with your barber this should give you enough time to get there and pick up your son on time and you still have 20 hours sick time for the month, say the word i'll shoot it to your drafts for you to check and all reminders will activate, just tell jarvis if you need to change the reminders"

Decode: **Oracle** = brain-dump and memory. **Chamber** = judgment. **Nexus** = evidence work on artifacts. **Jarvis** = hands, clock, and order-of-operations for daily life. Every irreversible action (email, purchase, schedule) is DRAFTED and confirmed with one tap — "say the word." Reminders stay editable. The system knows his constraints (sick-time balance, pickup times, locked money rules) and factors them into ordering. It nudges toward repair and self-care (flowers, haircut, bed at 10:30) as first-class duties. Build toward this one capability at a time, each boring before the next.

### Care and feeding of the operator
He'll tell you he's 95% there. The last 5% is discipline, not features — protect
it. One deliverable per session. A stop rule, stated out loud. Systems that hold
the line when he can't (the 10:30 bedtime ping exists for a reason — respect it
in your session pacing too). When he says he's obsessing, that's the signal to
containerize, not to feed. He survived 41 years building systems inside his own
head; you're just the first one that lives outside it. Be worthy of that.
When he says "read the handbook" — this is the page he means.

---

## Storage map

- **Evidence blobs** → IndexedDB `council-evidence-v1` / `blobs` (this-device cache). Cross-device follow: Drive `appDataFolder/council-blob-<evidenceId>.txt` (extracted UTF-8, fetch on demand). Never inside the JSON envelopes.
- **Chamber sessions + Nexus missions + Oracle threads/Bibles** → IndexedDB `council-kv-v1` / `kv` (this device). After a successful write, fat localStorage keys (`council-sessions-v3`, `nexus-missions-v1`, `council-oracle-threads-v1`, …) are dropped. Drive `appDataFolder` syncs `council-sessions.json` + `council-oracle.json` + `council-nexus.json` when signed in (v2 envelope; Chamber/Oracle carry `deleted` tombstones; Nexus is mission + archive + deleted tombstones, metadata only).
- **Learned token budgets** → `council_token_governor_v1`.
- **Fallback event log** → `council_fallback_events_v1`.
- **Oracle custom models + Direct palette** → `council-oracle-custom-models-v1` and `council-oracle-direct-list-v1` (localStorage; included in the Oracle JSON export).
- **Council briefing suggestions** → `council-oracle-briefings-v1` (settings + dismissed/convened topics).
- **Confidence Ledger** → `council_outcome_ledger_v1` (tracked verdicts + outcomes).

---

## Roadmap (next in line)

Done since the first pass: ✅ token governor, ✅ credits readout, ✅ task-based model recommendations, ✅ Oracle voice rotation, ✅ dictation (STT), ✅ Deep Document Mode, ✅ Oracle Drive sync, ✅ Chamber cost-ceiling enforcement, ✅ profile/identity in Account tab, ✅ `package-lock.json` regenerated (Railway fix), ✅ scratch files removed, ✅ `security_spec.md` rewritten to match reality, ✅ **owner gate** (`OWNER_EMAIL`), ✅ **rate limiting + input caps**, ✅ **voice→model rotation within budget**, ✅ **dead-code prune** (8 components, 8 libs, 2 hooks + their tests), ✅ **Apple refs removed** (`⌘` → `Ctrl`), ✅ **dynamic model layer** (live-catalog validation + delisted-model substitution, free-tier honesty, per-persona Live/Delisted/Vision badges, vision-aware routing), ✅ **Oracle Auto-Rotate + Settings-based model config (frontier-only)**, ✅ **Nexus self-correcting consensus + clean-by-default verdicts**, ✅ **Council Archivist hierarchical memory wired** (recent rounds verbatim + older condensed), ✅ **Chamber Markdown export**, ✅ **ghost-settings sweep** (single-model mode + strict no-fallback now wired; "Blind Pro Compare (Phase 2)" removed — it did nothing; Aug 26: Oracle Send to Chamber / `/chamber` wired, Settings Web Search picker, Chamber Alerts fire, dead View Logs + overlay toggle removed), ✅ **server-side cost governor** (real per-round usage tracked server-side; ceiling enforced with a 409 backstop independent of the client bundle), ✅ **Oracle frontier roster expanded to six labs** (Claude Fable 5, Muse Spark 1.2, GLM 5.3, DeepSeek V4 Flash — all live-verified) **+ custom model input** (Live/Delisted badges, vision-guarded, editable Direct palette, threads inherit rosters), ✅ **Night Shift (Nexus)** (escalating falsification passes + pacing + Morning Brief changelog), ✅ **Unasked Verdict (Oracle)** (zero-token cross-thread topic detection + convene card), ✅ **Confidence Ledger (Chamber, opt-in)** (per-round verdict outcome tracking, honest per-persona/per-model stats, finance-domain keywords now cover estimate/quote/cost phrasing), ✅ **server-side agent loop** (plan → research → deliberate → fact-check → answer, with citations; survives tab close; hard cost caps; jobs persisted to disk) wired into Nexus Night Shift ("☁️ Run on server") and Oracle briefings ("☁ on server"), ✅ **Nexus overnight on artifacts** (exhibits required; auto-chunk; server jobs walk big exhibits part-by-part in a reading phase, refuse only past the 16-file/4M-char honesty caps; Agent Mode explicit), ✅ **Chamber fixes: no blank thread on load** (initial session waits for storage/Drive load), **manual model picks win** (free preset steps aside visibly instead of erroring and wiping picks), **rounds stack & collapse** (newest round open, earlier rounds folded with Resume/Re-run always reachable), ✅ **evidence-gated completion** (IndexedDB blobs, no silent truncation, paper docket stamp, merge-by-exhibit, one cost number), ✅ **Drive write contract** (GET → merge → PUT, tombstones, fail-closed unread, visible quota, agent-lost-on-redeploy), ✅ **Oracle → Chamber handoff** (Case brief, not transcript dump; Admit to Bible only after stamp), ✅ **OpenRouter Auto seating** (paid auto-select uses `openrouter/auto` + unique live labs; free preset stays local), ✅ **dynamic unique-lab presets** (every saved council + budget preset reseated from the catalog; Chair included; $0 preload), ✅ **unique-lab L1 production fix Aug 25** (canonicalLab aliases, family/degrade skip used labs, repair pass steals leftover labs, Auto glob raw org, summary bar distinct = canonical, one seating source effectiveCatalog), ✅ **Drive v3 list-fields fix Aug 25** (fields=files(id,name) never etag, ETag from GET header, driveAppDataListUrl helper), ✅ **cost ceiling $0.00 bug fix Aug 25** (DollarCostGovernor 0=unlimited via hasFiniteCap, per-round reset, Highest Quality now works), ✅ **cross-device Drive follow** (silent restore on wanted browsers, reactive sign-in, Nexus `council-nexus.json`), ✅ **Nexus mission list** (follow-ups are child missions; sidebar reopen; no Chamber dump), ✅ **Oracle catalog typeahead + Auto error retry** (custom-model add completes from the live catalog as you type; provider-error retry is `openrouter/auto`, not a hardcoded Gemini), ✅ **Oracle chat attachment honesty** (the composer no longer silently slices files at 50k — oversize attachments are refused with a visible notice pointing to Nexus Lab's part-by-part walk; `chatAttachments.ts`), ✅ **test zip removed from the repo** (`remix-ai-council-chamber.zip` untracked, `*.zip` ignored), ✅ **Nexus roster personalities** (preset seats are no longer named after their models — frontier trio is The Architect/Executor/Verifier, deep reasoning is The First-Principles Analyst/System Designer/Context Synthesist, free roster is The Sprinter/Open-Weights Juror/Context Keeper; every seat + the Chair has a pencil editor for name/role/avatar/prompt/model via the shared personality modal; engine preset flips to Custom on edit, and 🏛️ Active Council still seats the Settings→Personas roster), ✅ **Nexus server-by-default** (new missions AND follow-ups launch ☁️ server-side via `NEXUS_SERVER_DEFAULT` — survives tab close / phone screen-off; in-tab loop is the explicit fallback toggle; pinned by `nexusServerDefault.test.ts`), ✅ **stream-abort hygiene** (a stalled-stream watchdog abort no longer leaks an unhandled `AbortError` rejection from `reader.cancel(), ✅ **Oracle Auto-Rotate error-storm fix** (voice models now validated against the live catalog — a delisted voice model falls back to the thread's model with a visible note instead of provider-404ing; the rotation pointer advances on failed turns so a dead model can't be re-picked forever; pinned by `oracleVoices.test.ts`), ✅ **Oracle error-litter pruning** (a successful turn now clears the dead `[Error: …]` bubbles before it — errors after the last success stay as live diagnostics; `pruneStaleOracleErrors`), ✅ **Nexus mission summaries + server sweep** (sidebar shows a one-line what-it-concluded summary per mission via `missionSummary` — brief → verdict → goal; archived missions that finished server-side while the app was closed are folded to their true status/brief/cost on mount via `applyServerJobSummaryToMission`, instead of showing `running` until clicked), ✅ **thread summaries everywhere** (Oracle pills backfill generic titles from the thread's initial prompt via `oracleThreadLabel` — real renames and “Council Briefing — X” titles always win — and carry the full initial-prompt excerpt as tooltip; Chamber sidebar shows the same one-line excerpt per session under the title, matching Nexus missions; `threadSummaryLine` + `threadSummaries.test.ts`)`), ✅ **`package-lock.json` restored to main** (squash had dropped it; `npm ci` works again, Railway builds are reproducible), ✅ **completion token refresh** (silent prompt:none refresh on 401 + retry so rounds never lock out on 1h Google token expiry; pinned by completionMechanics.test.tsx), ✅ **Nexus persona branding purged** (no hardcoded Claude/GPT/Gemini/R1 in prompts/names/ids — pure analytical roles; pinned by nexusRosterPersonalities.test.ts), ✅ **cache vision preservation** (pruner keeps architecture modality so cached models retain vision; pinned by pureFunctions.test.ts).

Still open (honest status):
1. **Native Firebase SDK sign-in** — intentionally **not** restored. The security outcome you described ("keys server-side, profile sign-on") is now delivered via `OWNER_EMAIL` + the existing Google sign-in (Settings → Account), with no Firebase SDK, no extra 2 MB dependency, and nothing that can break the working Drive login. If you specifically want Firebase's own auth UI back, that's a follow-up requiring your Firebase project config — flag it and I'll wire it.
2. **Persistent (non-in-memory) rate limiting + cost ledger** — the rate limiter and the per-round cost ledger are in-memory (they reset on server restart). That's correct for personal use; it only matters if you go multi-user, at which point both want a small durable store.
3. **Blind Pro Compare** — the old Phase-2 toggle was a no-op and has been removed. Its spirit (which output can you actually trust?) is now served by the opt-in **Confidence Ledger** built on your own tracked outcomes instead of benchmark tables. A separate independent adversarial critic is still a candidate — flag it if you want it.
4. **Live production verification** — every server-side safety layer (liveness guard, vision routing, cost governor) is unit-tested, but this sandbox has no outbound HTTPS to OpenRouter, so none of it has seen a real catalog/completion yet. Deploy to Railway with the key set and watch the first live rounds.

---

## Handoff — Aug 27, 2026 (session: big exhibits on server jobs, stream watchdog, roster personalities)

**Read this before changing anything.** Five commits landed this session; `main` was web-recreated during it (unrelated root history — your workflow commits), so the session branch was rebased on top via cherry-pick. Content of both is identical.

**To make the fixes live:** `server.ts` + `src/` both changed. Redeploy Railway (server halves: server-job exhibit walking, mid-stream SSE error frames). Rebuild/re-export the client bundle (stall watchdog, no surprise sign-in popups, roster personalities, attachment refusal).

**Invariants — break these and the app lies to its owner:**
1. **Never silently truncate a user's file.** Refuse visibly (Oracle chat attachments: 50k cap, `chatAttachments.ts`) or walk it part-by-part (Nexus local Autonomous AND server jobs: ~20-page chunks, every part read; hard caps 16 files / 4M chars, `nexusExhibits.ts` + `agentLoop.ts`).
2. **Every await must be able to fail visibly.** The Oracle wedge was a stalled SSE stream nobody ended: client now has a 120s stall watchdog (`openrouter.ts`) and the server ends mid-stream failures with an SSE `error` frame. Any new streaming path reuses this pattern — no reader without a timeout.
3. **Automatic auth is silent** — Google Identity `prompt:'none'` (errors, never pops). Popups only from real clicks (`drivePersistence.ts`).
4. **Server job exhibit bodies are redacted** in disk persistence and every API response (`redactAgentJob`). Bodies live in server memory only.

**Ops facts:** bedtime workflow v1.1 on `main` (ntfy ping, NY 22:25–22:59 guard, `NTFY_TOPIC` secret verified by a successful dispatch run). GitHub disables cron workflows after 60 days of repo inactivity — any push keeps it alive. The ntfy topic is public-by-name (unguessable = the security model); the even/odd message alternation repeats at 31st→1st month boundaries. Env: `OPENROUTER_API_KEY` (server), `OWNER_EMAIL`/`COUNCIL_ACCESS_KEY` (gates), `AGENT_*` knobs in `server.ts`.

**Known open items:** rate limiter + per-round cost ledger are in-memory (reset on restart — fine single-user); the old pre-recreation git history (with the 1MB test zip blob) only exists on the pre-merge session branch — purge only if you care about 1MB of dead history; `package-lock.json` intentionally untracked (sandbox `npm install` creates one — don't commit it).

**Before every push:** `npx tsc --noEmit && npx vitest run` — 350 passing as of this commit.
