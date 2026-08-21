# Remix Council — Operator's Handbook

Your whole vision, in one page. Three tabs, one assistant, all wired to server-side keys.

## The three tabs (exactly as you imagined)

| Tab | What it is | Use it for |
|---|---|---|
| **Chamber** | A panel of personalities (Skeptic, Visionary, Pragmatist…) debates your question, critiques each other, then a Chair synthesizes one answer. | General questions, anything where you want multiple viewpoints and a verdict. You set the personalities in Settings. |
| **Nexus Lab** | An autonomous loop: it runs repeated cycles of proposals + consensus toward convergence, with a rotating Chair. Now supports **Follow-up** directives. | Complex, multi-step tasks where one pass isn't enough (analysis, plans, "keep refining this"). |
| **Oracle** | Your Jarvis/Gideon. A persistent multimodal assistant that **maintains a living "Bible"** (per-thread + global memory) it reads and rewrites every turn. | A companion that remembers everything across the conversation — and across threads via the Global Bible. |

---

## The features (and where to find them)

- **Auto-named threads** — Chamber and Nexus name themselves from your first question. Rename anytime via the pencil in the sidebar (Chamber) or the title pill (Nexus).
- **Token Governor (adaptive tokens)** — in the Oracle, the answer budget self-adjusts: if an answer gets cut off it automatically continues ("pick up where you left off") with a bigger budget, and if a short answer used only a fraction of the budget it learns to spend less next time. You'll see a small `auto-expanded tokens ×N` note when it kicks in. (Chamber uses fixed per-stage limits from Settings.)
- **Credits remaining** — a live "Credits: $X" badge in the top-right header (click to refresh), a bigger one in the Oracle header, and a full **Account & Credits** panel in Settings → Account. It reads from OpenRouter through the **server proxy**, so your API key never touches the browser.
- **Model recommendations by task** — the Chamber detects the task domain (code / math / finance / creative / general) and, when "Auto-select models" is on (Settings), assigns each panelist an appropriate model for that run. The active domain shows in the summary bar ("Domain: CODE").
- **Voice rotation (Oracle)** — the Oracle cycles through six analytical voices (Skeptic, Visionary, Pragmatist, Synthesist, Strategist, Teacher) on the same model, so each turn has a different perspective. Toggle "Voices" on/off per thread.
- **Speech** —
  - *Listen:* every Oracle reply and every Chamber panelist card has a read-aloud button.
  - *Dictate:* the **Dictate** (mic) button in the Oracle and Chamber composers uses your browser's speech-to-text so you can talk instead of type (Chromium browsers: Chrome, Edge, Brave, Arc).
- **Web grounding** — the Oracle has a "Web" toggle; the Chamber honors the Settings → Web mode (off/auto/always). Live citations come back through the server proxy.
- **Attachments** — text/code files, PDFs, and ZIP/RAR codebases in Chamber + Nexus; the Oracle adds **images** (vision) + files. Large attachments warn before truncating.
- **Deep Document Mode (Nexus)** — turn it on in the Nexus "Autonomous Tool Matrix", pick pages-per-part (default 20), and attach a 400-page document. Nexus **splits it into ~20-page parts** (tells you the plan in the manifest card + terminal), reviews **every part** with the panel, accumulates a running ledger, then runs a **final cross-document synthesis**. This is the "20 × 20-page versions" workflow you asked for.
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
4. ⚠️ `package-lock.json` is out of sync with `package.json` (still lists removed `firebase` deps and an old engine range). Regenerate it (`rm package-lock.json && npm install`) before your next deploy so the builder installs what `package.json` actually declares.

---

## Storage map

- **Chamber/Nexus sessions** → `council-sessions-v3` (localStorage) + Google Drive `appDataFolder/council-sessions.json` when signed in.
- **Oracle threads + Bibles** → `council-oracle-threads-v1` and `council-oracle-global-bible-v1` (localStorage), JSON export/import (Oracle header), **and** Google Drive `appDataFolder/council-oracle.json` when signed in (auto-syncs with a "Drive" indicator in the Oracle header).
- **Learned token budgets** → `council_token_governor_v1`.
- **Fallback event log** → `council_fallback_events_v1`.

---

## Roadmap (next in line)

Done since the first pass: ✅ token governor, ✅ credits readout, ✅ task-based model recommendations, ✅ Oracle voice rotation, ✅ dictation (STT), ✅ Deep Document Mode, ✅ Oracle Drive sync, ✅ Chamber cost-ceiling enforcement, ✅ profile/identity in Account tab, ✅ `package-lock.json` regenerated (Railway fix), ✅ scratch files removed, ✅ `security_spec.md` rewritten to match reality, ✅ **owner gate** (`OWNER_EMAIL`), ✅ **rate limiting + input caps**, ✅ **voice→model rotation within budget**, ✅ **dead-code prune** (8 components, 8 libs, 2 hooks + their tests), ✅ **Apple refs removed** (`⌘` → `Ctrl`).

Still open (honest status):
1. **Native Firebase SDK sign-in** — intentionally **not** restored. The security outcome you described ("keys server-side, profile sign-on") is now delivered via `OWNER_EMAIL` + the existing Google sign-in (Settings → Account), with no Firebase SDK, no extra 2 MB dependency, and nothing that can break the working Drive login. If you specifically want Firebase's own auth UI back, that's a follow-up requiring your Firebase project config — flag it and I'll wire it.
2. **Persistent (non-in-memory) rate limiting** — only matters if you ever go multi-user.
3. **Server-side cost governor** — today the Chamber enforces ceilings client-side.
