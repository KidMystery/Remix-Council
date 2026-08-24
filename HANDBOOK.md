# Remix Council — Operator's Handbook

Your whole vision, in one page. Three tabs, one assistant, all wired to server-side keys.

## The three tabs (exactly as you imagined)

| Tab | What it is | Use it for |
|---|---|---|
| **Chamber** | A panel of personalities (Skeptic, Visionary, Pragmatist…) debates your question, critiques each other, then a Chair synthesizes one answer. Long threads keep a **hierarchical memory**: recent rounds stay verbatim, older ones are condensed (window = Settings slider). | General questions, anything where you want multiple viewpoints and a verdict. You set the personalities in Settings. Export any thread as Markdown. |
| **Nexus Lab** | An autonomous loop: it runs repeated cycles of proposals + consensus toward convergence, with a rotating Chair. Each cycle now **adversarially re-examines the previous consensus** (falsify → verify → change only with justification). Now supports **Follow-up** directives. | Complex, multi-step tasks where one pass isn't enough (analysis, plans, "keep refining this"). |
| **Oracle** | Your Jarvis/Gideon. A persistent multimodal assistant that **maintains a living "Bible"** (per-thread + global memory) it reads and rewrites every turn. Runs **Direct**, **Mini Deliberation** (panel + synthesis), or **Auto-Rotate** (cycles a frontier roster turn-by-turn). | A companion that remembers everything across the conversation — and across threads via the Global Bible. |

---

## The features (and where to find them)

- **Auto-named threads** — Chamber and Nexus name themselves from your first question. Rename anytime via the pencil in the sidebar (Chamber) or the title pill (Nexus).
- **Token Governor (adaptive tokens)** — in the Oracle, the answer budget self-adjusts: if an answer gets cut off it automatically continues ("pick up where you left off") with a bigger budget, and if a short answer used only a fraction of the budget it learns to spend less next time. You'll see a small `auto-expanded tokens ×N` note when it kicks in. (Chamber uses fixed per-stage limits from Settings.)
- **Credits remaining** — a live "Credits: $X" badge in the top-right header (click to refresh), a bigger one in the Oracle header, and a full **Account & Credits** panel in Settings → Account. It reads from OpenRouter through the **server proxy**, so your API key never touches the browser.
- **Model recommendations by task** — the Chamber detects the task domain (code / math / finance / creative / general) and, when "Auto-select models" is on (Settings), assigns each panelist an appropriate model for that run. The active domain shows in the summary bar ("Domain: CODE"). Every seated model is **validated against the live OpenRouter catalog**: a delisted model is auto-substituted with the best live model for the same budget tier (free mode only ever swaps to free), and the substitution is logged. The same server-side guard runs on every chat request, so a stale model id never burns an upstream call.
- **Per-persona model health badges** — each panelist's model card shows **Live** (verified in the live catalog) or **Delisted** (not found — will auto-substitute or fail in strict mode), plus a **Vision** / **Text-only** chip from the model's architecture. Only shown when a live catalog is loaded.
- **Per-round cost ceiling (client + server)** — Settings → Advanced → "Per-Round Cost Ceiling". The Chamber stops a round when its *estimated* cost trips the ceiling, **and** the server enforces the same ceiling using *real* per-token usage it accumulates per round: once a round's actual spend reaches the ceiling, the server refuses any further calls for that round (HTTP 409) — a money backstop that holds even if the client is buggy or a stale bundle.
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
- **Attachments** — text/code files, PDFs, and ZIP/RAR codebases in Chamber + Nexus; the Oracle adds **images** (vision) + files. Large attachments warn before truncating. Image turns are modality-guarded: if the chosen model is text-only it's auto-routed to a vision model (see above).
- **Deep Document Mode (Nexus)** — turn it on in the Nexus "Autonomous Tool Matrix", pick pages-per-part (default 20), and attach a 400-page document. Nexus **splits it into ~20-page parts** (tells you the plan in the manifest card + terminal), reviews **every part** with the panel, accumulates a running ledger, then runs a **final cross-document synthesis**. This is the "20 × 20-page versions" workflow you asked for.
- **Self-correcting consensus (Nexus)** — from cycle 2 on, the Chair is handed the previous cycle's full consensus and instructed to **adversarially falsify** it: re-derive critical claims (preferring live web verification over memory), change the consensus only with substantive justification, and state exactly what changed, why, and the top remaining pitfalls. So pass 1 proposes, and later passes defend-or-overturn — the "I jumped the gun, here's why" behavior is now structural. The verdicts feed is **clean by default**: final verdict in full, earlier cycles as one-line summaries, with a "Full deliberation" toggle to expand. The runtime telemetry terminal is collapsed by default (auto-opens while a mission runs).
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

---

## Storage map

- **Chamber/Nexus sessions** → `council-sessions-v3` (localStorage) + Google Drive `appDataFolder/council-sessions.json` when signed in.
- **Oracle threads + Bibles** → `council-oracle-threads-v1` and `council-oracle-global-bible-v1` (localStorage), JSON export/import (Oracle header), **and** Google Drive `appDataFolder/council-oracle.json` when signed in (auto-syncs with a "Drive" indicator in the Oracle header).
- **Learned token budgets** → `council_token_governor_v1`.
- **Fallback event log** → `council_fallback_events_v1`.
- **Oracle custom models + Direct palette** → `council-oracle-custom-models-v1` and `council-oracle-direct-list-v1` (localStorage; included in the Oracle JSON export).

---

## Roadmap (next in line)

Done since the first pass: ✅ token governor, ✅ credits readout, ✅ task-based model recommendations, ✅ Oracle voice rotation, ✅ dictation (STT), ✅ Deep Document Mode, ✅ Oracle Drive sync, ✅ Chamber cost-ceiling enforcement, ✅ profile/identity in Account tab, ✅ `package-lock.json` regenerated (Railway fix), ✅ scratch files removed, ✅ `security_spec.md` rewritten to match reality, ✅ **owner gate** (`OWNER_EMAIL`), ✅ **rate limiting + input caps**, ✅ **voice→model rotation within budget**, ✅ **dead-code prune** (8 components, 8 libs, 2 hooks + their tests), ✅ **Apple refs removed** (`⌘` → `Ctrl`), ✅ **dynamic model layer** (live-catalog validation + delisted-model substitution, free-tier honesty, per-persona Live/Delisted/Vision badges, vision-aware routing), ✅ **Oracle Auto-Rotate + Settings-based model config (frontier-only)**, ✅ **Nexus self-correcting consensus + clean-by-default verdicts**, ✅ **Council Archivist hierarchical memory wired** (recent rounds verbatim + older condensed), ✅ **Chamber Markdown export**, ✅ **ghost-settings sweep** (single-model mode + strict no-fallback now wired; "Blind Pro Compare (Phase 2)" removed — it did nothing), ✅ **server-side cost governor** (real per-round usage tracked server-side; ceiling enforced with a 409 backstop independent of the client bundle).

Still open (honest status):
1. **Native Firebase SDK sign-in** — intentionally **not** restored. The security outcome you described ("keys server-side, profile sign-on") is now delivered via `OWNER_EMAIL` + the existing Google sign-in (Settings → Account), with no Firebase SDK, no extra 2 MB dependency, and nothing that can break the working Drive login. If you specifically want Firebase's own auth UI back, that's a follow-up requiring your Firebase project config — flag it and I'll wire it.
2. **Persistent (non-in-memory) rate limiting + cost ledger** — the rate limiter and the per-round cost ledger are in-memory (they reset on server restart). That's correct for personal use; it only matters if you go multi-user, at which point both want a small durable store.
3. **Blind Pro Compare** — the old Phase-2 toggle was a no-op and has been removed. Rebuilding it (an independent adversarial critic model that benchmarks the council's synthesis, shown as a card) is a candidate feature — flag it if you want it.
4. **Live production verification** — every server-side safety layer (liveness guard, vision routing, cost governor) is unit-tested, but this sandbox has no outbound HTTPS to OpenRouter, so none of it has seen a real catalog/completion yet. Deploy to Railway with the key set and watch the first live rounds.
