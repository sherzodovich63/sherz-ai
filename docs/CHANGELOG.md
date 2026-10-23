# SHERZ — documentation

This file replaces the separate `README-*.md` and `SERVER_PATCH_*.md` files that used to sit in the project root. Only `README.md` stays in the root. The original files are in `docs/archive/` (with their full SEARCH/REPLACE patches). **New changes are added to this file, not to a new README.**

## How to add a change
Append a section at the END of "Changelog" (newest last):
```
### YYYY-MM-DD — short title
What changed and why (2–6 lines) · files · database change? (`npx prisma db push`) · how to test.
```

## Architecture at a glance
- **Stack:** Node.js/Express, OpenAI (chat, Whisper, vision), ElevenLabs TTS (OpenAI TTS fallback), Prisma (PostgreSQL), Server-Sent Events for streaming, JWT auth with Google sign-in, plain HTML/JS/CSS frontend (`public/`).
- **Chat path:** `/api/chat-stream` → skills (`runSkillCandidates`) → brain (`brain/brain.js`, memory, emotion, tone) or Expert Mode (`brain/expertTurn.js`, tool calling). Expert Mode switches on by itself when the user asks for a file.
- **Agent safety:** every outside action is a plan that goes through the Approval Gate (`lib/agent/gate.js`). Only `approve()` executes anything. Boundary rules (`lib/agent/intentGrant.js`) decide when an explicit file request may run without a click. Trust learning, observation loop, autonomy settings (off by default), conventions and the kill switch sit around it.
- **Work Space:** one per user, up to two roles; skills, chats and files belong to the whole Space (`lib/spaces.js`, `lib/skills.js`, `lib/roleCatalog.js`).
- **Files:** Excel, Word, PDF and PowerPoint tools (`lib/docs/`), per-user quota, owner-only downloads.
- **Proactive:** check-in engine with a curiosity layer (`proactive/`), dynamic greeting (`lib/greeting.js`).
- **Helper:** a small Node program on the user's computer (`helper/`) for files in one shared folder.

## Changelog (oldest first)

### 2026-10-10 — Menu, search and speech-to-text server patches

#### server.js — 2 surgical edits (dev mode ignored the login token)

Server patch notes (SEARCH/REPLACE edits already applied). Full text: `docs/archive/`.

### 2026-10-11 — Projects (multi-conversation sidebar)

#### SERVER_PATCH_PROJECTS — Companion thread + Projects (Work mode)

Applies **on top of** `SERVER_PATCH_MENU.md` (multi-conversation backend). If you have not applied that one yet, skip step 3 and just
replace `server.js` with `server.projects.js` from this zip — it already contains both.

What changes on the server:
- Every user has exactly **one Companion thread** (created on demand; adopts old messages, proactive messages and any chats created by the previous Menu build; can't be renamed or deleted).
- **Projects** are conversations with `kind = "project"`, created by name (+ optional goal/stack).
- A turn inside a project runs in **Work/Engineering mode**: the friend-mode overlay is replaced by an engineering block (complete code, surgical SEARCH/REPLACE, root cause first, no invented APIs), the work model + a longer timeout + a longer context window are used. Persona (honesty/independent judgment), safety gate and long-term memory are unchanged.
- Env (optional): `SHERZ_WORK_MODEL` (default: `SHERZ_BRAIN_MODEL`, else `gpt-4.1`).

### 2026-10-12 — Delete messages

#### Message deletion — server step (about 1 minute, no database migration)

1. Extract the ZIP over your project folder. It adds/overwrites:
   - `public/index.html`, `public/script.js`, `public/sherz-modern.css`
   - `lib/messages.js` (new)
   - `apply_server_patch_messages.mjs` (new)
   - `tests/messages.test.mjs` (new, optional)

2. In the project folder run:

       node apply_server_patch_messages.mjs server.js

   It checks every edit first, writes nothing unless all match, and keeps a backup
   (`server.js.bak-<time>`). Safe to run twice.

3. Restart the server (`node server.js`). No `prisma migrate` needed — the `Message` table already exists.

New routes (signed-in owner only; someone else's id behaves like "not found"):

| Method | Path | Body | Result |
|---|---|---|---|
| DELETE | `/api/messages/:id` | – | `{ok:true, deleted:[id]}` or 404 |
| POST | `/api/messages/delete` | `{ids:[…]}` (max 200) | `{ok:true, deleted:[…], count}` |

Deleted rows are removed from Postgres/SQLite and also disappear from what the model sees,
because the chat context is read from the same table.

If the UI shows "Deleting messages needs the server update", this step has not been applied
(or the server was not restarted) — the message reappears in the chat instead of vanishing.

Optional test: `node --test tests/messages.test.mjs` (the HTTP test needs `npm i express`).

### 2026-10-12 — Multimodal: send an image with text

#### SHERZ AI — multimodal fix (image + text in one message)

#### Install
1. `npm install multer`   (the only new dependency)
2. Copy over your project, keeping folders:
   - `server.js`  (project root)
   - `lib/chatImage.js`, `lib/messages.js`  (new `lib/` folder next to server.js)
   - `public/index.html`, `public/script.js`, `public/sherz-modern.css`
3. Restart `node server.js`. No database migration.

> `server.js` here includes the Projects + message-delete work. If you hand-edited server.js,
> don't overwrite it — run `node apply_server_patch_multimodal.mjs server.js` instead (idempotent, makes a backup).

#### What was wrong
The live send path is `sendToServer()` in index.html (not `sendMessage` in script.js). It only ever posted JSON text,
so the attached picture was never read. An old handler in script.js also fired a second send; it is now disabled.

#### What changed
- Send now builds `FormData` (`image` + `message` + `userId` + `conversationId`) when a picture is attached, JSON otherwise.
- Big photos are shrunk to max 1600px JPEG before upload.
- Preview + textarea clear only after the server accepts the request; if it rejects (400/413/415) the error shows and the picture stays for retry.
- Image-only messages work.
- Server: multer (memory, 10 MB cap in lib/chatImage.js), type checked by magic bytes, passed to the vision model as a data URL.
- Prisma stores text only: history keeps `📷 [image]` + your text (shown as a small "Rasm" chip after reload). Image bytes are not stored.

Tests: `node --test tests/*.test.mjs`

#### Hotfix (preview + req.user)
- Preview showed only "Prevyu": the server's CSP `img-src` had no `blob:`, so the object-URL thumbnail was blocked. Preview and chat thumbnail now use `data:` URLs (script.js, index.html), and `blob:` was added to `img-src` in server.js.
- `TypeError … reading 'id'` (server.js:526): in dev (`NODE_ENV` != production) the global `/api` guard skipped auth completely, so `req.user` was never set. It now runs `optionalAuth` (decodes the token if sent), and the 4 routes that used `req.user.id` directly (`/api/facts/:userId`, `/api/daily-briefing`, `POST /api/todo`, `GET /api/todos`) fall back to the dev user id; in production they still require the JWT.

#### Hotfix 2 (reply never arrives after an image)
- `brain/brain.js`: the image was attached to the message *before* the context analyzer ran, which turned it into "[object Object]" in recent-messages. Now attached right before the model call.
- `server.js`: logs `[chat-stream] image turn …` / `reply ready …` so you can see in the terminal where an image turn stops.
*…(rest of the notes: `docs/archive/`)*

### 2026-10-12 — Agent Phase 1: Approval Gate

#### SHERZ Agent — Phase 1: Confirmation Gate

#### Install (3 steps)
1. Append `prisma/AgentAction.prisma.txt` to the end of your `prisma/schema.prisma`, then run `npx prisma db push`
   (until you do, the server falls back to an in-memory store and prints a warning — plans are lost on restart).
2. Copy these into your project (same folders): `server.js`, `brain/expertTurn.js`, `brain/brain.js`,
   `lib/agent/` (new), `routes/agent.js` (new), `public/index.html`, `public/sherz-modern.css`, `public/script.js`, `lib/chatImage.js`, `lib/messages.js`.
3. Restart the server, hard-refresh the page (Ctrl+F5).

#### Try it
Type:  `/agent save a note called ideas.md with three startup ideas`
→ SHERZ answers and a plan card appears: steps, risk badges, **Approve & Execute / Edit / Reject**.
Nothing is written until you press Approve. Files go to `./agent_sandbox/<your id>/` (override with `SHERZ_AGENT_SANDBOX`).
No Expert Mode toggle exists yet — the `/agent ` prefix turns it on for that one message.
You can also create a plan without the AI: `POST /api/agent/propose {title, steps:[{tool,args}]}`.

#### How the safety works (all enforced on the server, not in the prompt)
- The model's only tool is `propose_action_plan` — it stores a PENDING plan. It cannot approve or run.
- `approve` needs: status pending · not expired (30 min) · the exact `planHash` the user saw · an atomic pending→executing claim (double-click runs once).
- Editing a plan changes its hash, so an earlier approval can't apply to the edited steps.
- Every action is declared in `lib/agent/registry.js` with risk + reversible + strict argument validation; anything undeclared can't run.
  Phase 1 tools: `sandbox.write_note` (low), `sandbox.list_notes` (low), `sandbox.delete_note` (medium, irreversible). Filenames are `[A-Za-z0-9._-]+.(md|txt)`, 20 KB max, confined to your sandbox folder.
- The admin kill switch ('expert' scope) pauses execution; steps stop at the first failure and the rest are marked skipped.
- Every state change is appended to `AgentAction.history` — the log Phase 2 (adaptive trust) will learn from.

#### Tests
`node --test tests/*.test.mjs` (agent.test.mjs: 13 tests — gate, validation, concurrency, expiry, HTTP routes).

#### Earlier hotfixes still included
multimodal image send, CSP blob preview, dev `req.user`, stream-close fix (see README-multimodal.md).

### 2026-10-13 — Helper app (files on the user's computer)

#### SHERZ Helper + file tools

The model can now propose file actions on YOUR computer. Nothing runs until you press **Approve & Execute**,
and the work is done by a small program you start yourself, limited to ONE folder.

#### Install (server)
1. Copy the files in this ZIP over your project (same paths). NOTE: `server.js` and `brain/expertTurn.js`
   are the full versions from the previous Agent Gate delivery plus the helper wiring — if you edited those two
   files yourself since then, tell me and I'll merge instead of you overwriting.
2. Append the `HelperDevice` model from `prisma/AgentAction.prisma.txt` to `prisma/schema.prisma`, then `npx prisma db push`.
   (If you already added `AgentAction`, only add the new model.)
3. Deploy / restart. No new npm packages.

#### Run the helper (your PC, Node 18+)
1. In SHERZ chat type `/helper` → you get a one-time code (valid 10 min) and the exact command.
2. In a terminal (folder with `helper/sherz-helper.mjs`):
   `node helper/sherz-helper.mjs --server https://sherz-ai.onrender.com --folder "C:\SherzFiles" --code ABCD-1234`
   The pairing is saved in `~/.sherz-helper.json`; next time just `node helper/sherz-helper.mjs`
   (`--forget` removes the pairing). Ctrl+C stops it — the server then refuses file plans.
3. Try: `/agent list the files in my folder`, `/agent read notes.txt`, `/agent create a folder called ideas and write plan.md in it`.

#### Tools
| tool | risk | note |
|---|---|---|
| files.list / files.read / files.mkdir | low | read ≤100 KB, list ≤500 entries |
| files.write | medium | overwrite only if `overwrite:true`; old copy goes to trash |
| files.move | medium | never overwrites |
| files.delete | medium | moves to `<folder>/.sherz-trash/<time>/…` — recoverable |

#### Safety
- The helper only connects OUT to your server (no open ports). Revoke any time (`DELETE /api/helper/devices/:id`).
- All paths are relative to the one folder; `..`, absolute paths, symlink escapes, drive roots and `.sherz-trash` are refused — enforced by the helper itself, not just the server.
- Server checks too: exact plan hash, 30-min expiry, kill switch, first failure stops the plan; helper offline → approval is refused and the plan stays pending.

*…(rest of the notes: `docs/archive/`)*

### 2026-10-13 — Google login fix

#### Google sign-in: "Error 400: invalid_request" — fix + diagnostics

Your Console settings are fine. Google returns invalid_request (not redirect_uri_mismatch) when the redirect_uri it
RECEIVES is malformed. The old code sent `process.env.GOOGLE_REDIRECT` raw (it never read GOOGLE_CALLBACK_URL).
A value pasted into Render with quotes/spaces, as a Markdown link "[https://…](https://…)", with http://, or the old
localhost value from .env is enough to trigger it.

#### What changed (routes/auth.js + new lib/googleOAuthConfig.js)
- The redirect_uri is cleaned (quotes, spaces, markdown link), validated (https unless localhost, has a path, no IP) and,
  if the env value is unusable, derived from the request host: https://sherz-ai.onrender.com/api/auth/google/callback.
- The token exchange in the callback uses the SAME value (Google requires it to be identical).
- Render logs now print: `[auth/google] redirecting to Google · redirect_uri=… (from GOOGLE_REDIRECT|derived)`.
- NEW  GET /api/auth/google/debug  → shows exactly what is sent (no secrets) + warnings.
- Callback now redirects to FRONTEND_URL (if set) so the login token lands on your Vercel site, not on onrender.com.

#### Do this
1. Copy `routes/auth.js` and `lib/googleOAuthConfig.js` into the project, push, let Render redeploy.
2. Render → Environment: set
   GOOGLE_REDIRECT = https://sherz-ai.onrender.com/api/auth/google/callback   (plain text, no quotes, no brackets)
   FRONTEND_URL    = https://sherz-ai.vercel.app
   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET = from the "Web application" OAuth client you registered the URIs on.
3. Open https://sherz-ai.onrender.com/api/auth/google/debug — `redirectUri` must be one of your Authorized redirect URIs,
   `clientIdLooksRight` must be true, `warnings` should be empty.
4. Click Sign in with Google again. If it still fails, click "error details" on the Google page and send me that text.

### 2026-10-13 — Agent Phase 2: trust and habit learning

#### Phase 2 — Trust & Habit Learning

SHERZ now learns from what you DECIDE about plans, shows how sure it is, and tells the model your habits.
**It never skips or weakens an approval** — a "High confidence" plan still waits for Approve & Execute (tested).

#### Install
1. Copy the files over your project (same paths). `server.js` and `brain/expertTurn.js` are full files again —
   if you edited them since the last ZIP, send them to me and I'll merge instead.
2. Append the `UserPattern` model (bottom of `prisma/AgentAction.prisma.txt`) to `prisma/schema.prisma`, then `npx prisma db push`
   (Render build command: `npm install && npx prisma generate && npx prisma db push`). Until you do, habits live in memory only and reset on restart (a warning is logged).
3. Deploy.

#### What is learned
A pattern = tool + folder + file type, e.g. `files.write | notes | .md`. Counters only — no file contents, no message text.
- Approve → +1 (`approvals`) if the step succeeded, `failures` if it failed
- Reject → `rejections` (counts double against confidence)
- Edit → if you move a step to another folder/type: the old shape gets `corrected`, the new one `preferred`, and the old one remembers `redirectTo` ("you usually change docs/ to notes/")
- Confidence = approvals + preferred − 2·rejections − corrected → 2+ "Learning", 4+ "Growing confidence", 8+ "High confidence"

#### Where you see it
- Plan cards: `🧠 Learned habit • High confidence` on steps (and on the card when every step is a known habit)
- `/habits` in chat: everything learned, with Forget (one) and Forget all. API: `GET/DELETE /api/agent/habits[/:id]`
- Model: `brain/expertTurn.js` appends a "Learned habits of THIS user" block (max 8 patterns). Names are reduced to a safe charset so a file name can't act as an instruction.

#### Phase 3 (not built)
The confidence level is the input for later "low-risk routine → run and notify". Nothing auto-runs today.

Tests: `node --test tests/*.test.mjs` (trust.test.mjs: 11 tests incl. the gate-still-required test).

### 2026-10-14 — Agent Phase 3a/3b: observe, act, check loop

#### Phase 3a / 3b — Observation loop, self-correction, budgets, folder consent

SHERZ can now look before it plans, work through a task in several steps, and fix its own failed steps —
while **every state-changing batch still needs your Approve**.

#### Install
1. Copy the files over your project (same paths). `server.js` and `brain/expertTurn.js` are full files again — if you edited
   them since the last ZIP, send them and I'll merge instead.
2. Append the two models at the bottom of `prisma/AgentAction.prisma.txt` (`AgentRun`, `AgentSettings`) to `prisma/schema.prisma`,
   then `npx prisma db push` (Render build command: `npm install && npx prisma generate && npx prisma db push`).
   Until then runs/consents live in memory only (a warning is logged; they reset on restart).
3. Deploy. No new npm packages. The helper program is unchanged.

#### How a task runs
1. You: `/agent tidy my inbox folder`.
2. SHERZ (model) calls **observe** (read-only: `files.list`, `files.read`, `sandbox.list_notes`).
   First time in a folder → a **permission card**: "Allow SHERZ to read the folder `inbox`?" (once per folder, covers sub-folders,
   `.` = whole shared folder). Until you click Allow nothing is read. Revoke any time in `/habits`.
3. With permission, results go back to the model as **untrusted data** (≤ 8000 chars per read, fences stripped).
4. The model proposes **one batch** → plan card → you Approve. Dependent steps go in a later plan (`then` = what comes next).
5. After the plan runs SHERZ gets one more turn **with the results**:
   - success + more to do → it proposes the next batch (new card, new approval)
   - **failure** → it receives the exact error + "attempts left", must change approach (an identical failed plan is refused), and proposes a corrected plan
   - done → it says so
6. Reject, or "No thanks" on a permission card, stops the task.

#### Budgets per task (`lib/agent/runs.js → BUDGET`)
5 plans · 12 reads · 48 KB of file text · 16 executed steps · 3 failed attempts · 6 follow-up turns · 60 min.
Hit one → the model is told to summarise; the task ends. One result can only be followed up once.

#### Safety design
- No state-changing action without your click (hash-checked, expiring, kill-switched — unchanged gate).
- **Taint:** once file text is in a task's context, `web_fetch` is removed from the model's tools for the rest of the task
  (blocks "read a file → send it somewhere" prompt-injection chains). Mutations are still plan-only.
*…(rest of the notes: `docs/archive/`)*

### 2026-10-14 — Agent Phase 3c: autonomy (auto-approval, off by default)

#### Phase 3c — Auto-approval (everything OFF by default)

#### Install
1. Copy the files in this ZIP over your project (same paths). **No `prisma db push` needed** — it reuses `AgentSettings.autonomy`.
2. Restart the server (`node server.js`). Hard-refresh the page (Ctrl+F5).
3. In the chat type `/autonomy` → switch on a tool (e.g. "Create a folder").

#### Files
- NEW `lib/agent/autonomy.js` — the policy engine (decides only)
- `lib/agent/gate.js` — `autoApprove()` + `undoAuto()`; `approve()` got `via:'auto'`
- `routes/agent.js` — `GET/POST /api/agent/autonomy`, `POST /autonomy/off`, `POST /:id/undo`, `makeAutonomy`
- `brain/expertTurn.js` — runs `gate.autoApprove` for plans the assistant just proposed; offers "Approve & always allow"
- `server.js` — creates the autonomy object and passes it on (5 lines; see the SEARCH/REPLACE in the chat)
- `public/index.html`, `public/sherz-modern.css` — `/autonomy` card, "⚡ Ran automatically" notice, Stop / Undo, "Approve & always allow"
- `tests/autonomy.test.mjs` (13) + 1 new harness test

#### When does a plan run without a click? (ALL must be true)
1. Every step is `files.list`, `files.read` or `files.mkdir` (hard-coded; `files.write/move/delete` can never be switched on)
2. You switched that tool to **auto** in `/autonomy`
3. Every step matches a learned habit with **High** confidence (tool + folder + file type)
4. The step's folder is inside a folder you already allowed SHERZ to read
5. Helper online · kill switch off · under the hourly cap (default 20, max 60) · ≤ 5 steps
6. The plan was proposed by the assistant (not typed by you)

Medium habit → the card offers **Approve & always allow** (approves this plan and switches the tool on; it still only auto-runs once the habit is High).
Anything else → the normal Approve button.

#### Safety properties (tested)
- Auto-runs go through the same `approve()` checks (pending, not expired, exact hash, kill switch, helper preflight, atomic claim); logged `via:'auto'` + `auto_approved` with the justifying habit.
- Auto-runs are NOT counted as your approvals, so they can't raise their own confidence.
- Rejecting or editing a habit lowers it below High → auto stops by itself.
- A settings row with unknown tools / bad values is ignored (normalized on every read).
- Any error in the policy → falls back to the normal approval.
- **Undo** (for created folders): only folders that did NOT exist before; it creates a normal pending `files.delete` plan (→ `.sherz-trash`) that you approve. **Stop doing this automatically** switches the tool off.
*…(rest of the notes: `docs/archive/`)*

### 2026-10-15 — Agent Phase 3d: conventions and pinned rules

#### Phase 3d — Conventions (inferred) + Pinned rules

#### Install
1. Add ONE line to the `AgentSettings` model in `prisma/schema.prisma` (also in `prisma/AgentAction.prisma.txt`):
   `prefs Json @default("{}")`
   then run `npx prisma db push` and restart. (Without it, `/rules` shows an error and nothing is learned — nothing else breaks.)
2. Copy the files in this ZIP over your project (same paths), restart, hard-refresh (Ctrl+F5).
3. In the chat type `/rules`.

#### What it does
- **Pinned rules** (you write them, max 12 × 160 chars): "Name files in kebab-case", "Reports go in docs/reports". They beat inferred conventions.
- **Inferred conventions** — learned only from plans YOU approved (never automatic runs, failed steps, or file contents). Shapes only: name style (kebab/snake/camel/Pascal/spaces), date-prefix format, which folder each file type goes in, folder-name style. A convention needs ≥ 4 approvals and ≥ 70 % agreement. File names are never stored. "Pin as rule" turns one into a pinned rule; "Forget" wipes them; habits "Forget all" wipes them too.
- Both reach the model as ONE block (≤ 1500 chars ≈ 375 tokens), pinned first. They are advice only — they cannot skip an approval, and the model cannot write rules.

#### Files
NEW `lib/agent/conventions.js` · `lib/agent/trust.js` (learns conventions from approvals) · `lib/agent/consent.js` (default `prefs`) · `routes/agent.js` (`GET/POST /rules`, `DELETE /rules/:id`, `DELETE /conventions`) · `brain/expertTurn.js` · `server.js` (4 lines) · `public/index.html` (`/rules` card) · tests (10 + 1).

### 2026-10-16 — Work Spaces (v2: Space Hub, role catalog, AI role generator, work styles)

#### Work Spaces & Skills (Phase 4, part 1)

A **Work Space** is a reusable job profile (role, rules, work style) with its own chat and its own **skills**.
Skills are procedures you teach; SHERZ uses the ones that match your message. Levels (Learning → Competent → Proficient → Expert)
are **computed from your approvals** (approved plan +1, edited −1, rejected −2, 👍/👎 on the card), never from SHERZ's own opinion.
Skills and Space text are advice only: they can never skip an approval or change safety rules.

#### Install
1. **Database** — add the models from `prisma/WorkSpaces.prisma.txt` to `prisma/schema.prisma` (the file lists the 3 models and the 2 small edits to `User` and `Conversation`), then:
   `npx prisma db push`
   Until you do, `/api/spaces` answers 503 and the sidebar section stays hidden. Nothing else breaks.
2. **Files** — copy over: `server.js`, `lib/skills.js`, `lib/spaces.js`, `lib/conversations.js`, `routes/spaces.js`, `routes/agent.js`,
   `brain/spaceContext.js`, `brain/workMode.js`, `brain/expertTurn.js`, `public/index.html`, `public/sherz-modern.css`.
3. **server.js changes** (already applied in the supplied file): imports for `spacesRouter`, `loadWorkMode`, `recordDecision`; `runBrainFlow` and `agentBuildTurn`
   call `loadWorkMode(...)` instead of `workModeFor(conv)`; `app.use('/api/spaces', spacesRouter(...))`; `agentRouter(... evidence: ...)`.

#### API
`GET/POST /api/spaces` · `PATCH/DELETE /api/spaces/:id` (`?permanent=1` deletes chats and skills) · `POST /api/spaces/:id/open` ·
`GET/POST /api/spaces/:id/skills` · `PATCH/DELETE /api/spaces/:id/skills/:sid` · `POST /api/spaces/:id/skills/:sid/feedback {value:1|-1}`

#### Prompt order (highest authority first)
base persona + safety → trust rules → Space profile (≤2000 chars) → top 3 skills (1500 / 600 / 600 chars) + index of up to 15 names → memory → mode block.
General Spaces get a professional work block; the Developer preset (`style: engineering`) keeps the code block.

#### Tests
`node --test tests/*.test.mjs` (skills, spaces, routes, evidence flow, expertTurn harness). Browser test: `tests/fe/spaces.e2e.test.mjs` (needs the mock server from the earlier phases).

#### Not in this part yet
Space-scoped memory (needs `memory/memoryRag.js`), researched skills (always as reviewed drafts), DOCX/XLSX/PPTX/PDF tools.

#### Update: Space Hub, role catalog, AI role generator, 5 work styles
- **Sidebar**: the Work Spaces block is now a *Space Hub* card (violet, profile switcher with Skills / Edit chips and a "Create a Work Space" row), visually separate from the green Projects list.
- **Creator**: "Describe your role" box (AI writes name, role, instructions, style; falls back to a template if AI is unavailable or fails) + 5 categories (Logistics, Finance & Economics, Software Engineering, Creative & Marketing, Academic) with 3-4 roles each. Everything is editable before saving.
- **Work styles**: Balanced, Analytical, Technical / Code, Fast operational, Formal corporate. Old rows with `engineering` are treated as Technical.
*…(rest of the notes: `docs/archive/`)*

### 2026-10-17 — File tools: Excel, Word, PDF, PowerPoint

#### SHERZ — File tools (Excel & Word) — Phase 5

The AI can now **create Excel (.xlsx) and Word (.docx) files** and **read** files you upload. Every created file goes through the Approval Gate: you see what will be made, approve, then get a Download button. Nothing is made without a click, and these tools are never auto-approved (3c allowlist is files.list/read/mkdir only).

#### Install (3 steps)
1. `npm install exceljs docx mammoth jszip pdfkit pptxgenjs pdfjs-dist@4`
2. Add the model from `prisma/Files.prisma.txt` to `schema.prisma` (including `generatedFiles GeneratedFile[]` on `User`), then `npx prisma db push`.
   Without it the server still boots and files live in memory (lost on restart) — a warning is logged.
3. Copy the files in this ZIP over your project (full files; `server.js` has two small additions: the `/api/files` router and the store).

#### How it works
- The model only writes **structured JSON**; server code builds the file. No macros, images, links or external references.
- Formulas: allowlisted plain functions only (SUM, AVERAGE, IF, ROUND, VLOOKUP, SUMIF …). `HYPERLINK`, `INDIRECT`, other files, `[ ] { } @ # |` are rejected.
- Limits: xlsx ≤10 sheets, ≤5000 rows, ≤40 columns; docx ≤400 blocks, ≤120k chars; file ≤5 MB; **40 files / 60 MB per user** (you get an error and delete via `/files` — nothing is removed silently).
- Reading: `docs.list` / `docs.read` (observation tools). Text is returned as untrusted data, clipped, with `<<<`/`>>>` stripped; the network tool is switched off once file text is in the run (same exfiltration guard as `files.read`).
- Uploads: `.xlsx/.docx` only, zip-guarded (magic bytes, entry count, unpacked size, macros refused).
- Download: owner-only, `Content-Disposition: attachment`, `nosniff`, sandbox CSP.

#### Using it
- Chat: “make an Excel budget for October”, “write a one-page project brief in Word”. In `/agent` mode you get a plan card → **Approve** → **⬇ Download**.
- `/files` shows your files, usage, Upload, Download, Delete.
- “Summarise my file budget.xlsx” → the AI reads it with `docs.read`. To change a file it reads it and makes a new corrected file.

#### Tests
`node --test tests/*.test.mjs` → 253 pass (new: `tests/docs.test.mjs`, 12 tests). Browser: `tests/fe/files.e2e.test.mjs` (10 checks). Generated files were also opened in LibreOffice.

#### Changed / new files
New: `lib/docs/{spec,zipguard,xlsx,docx,store,tools}.js`, `routes/files.js`, `prisma/Files.prisma.txt`, tests.
Changed: `server.js`, `lib/agent/{registry,react,expertBridge}.js`, `brain/expertTurn.js`, `public/index.html`, two assertion updates in `tests/agent.test.mjs` / `tests/agentLoop.test.mjs`.

#### Update: file requests no longer need "/agent"
Tools only exist in Expert Mode. `server.js` now turns Expert Mode on by itself when the message asks for an Excel/Word file
(`lib/docs/intent.js`, e.g. "make an Excel budget", "word fayl tayyorla", "сделай эксель"). A plain "show a table" stays normal chat.

*…(rest of the notes: `docs/archive/`)*

### 2026-10-17 — Curiosity layer (proactive messages)

#### SHERZ — Curiosity & own voice

#### What changed
1. `brain/corePersona.js` — new section 5 "Curiosity and a voice of your own" (persistence is now section 6). It is injected by `buildFullSystemContext()`, so normal chat, voice and Expert Mode all get it. SHERZ may start questions or share thoughts on its own, drops stock service phrases, stays honest that it is an AI, asks at most one question, lets the user ignore it, and stays quiet about it when the user is stressed, busy or in crisis. Personal questions stay light (no health, money, relationships, politics, religion).
2. `proactive/curiosity.js` (new) — five flavors: philosophical, technical, personal_light, observation, wonder. `decideIntent`: stress or a guarded relationship tone => `support` (never a curious ping); otherwise `curiosity` (default 60%, `config.curiosityRate`) or plain `checkin`.
3. `proactive/proactivePolicy.js` — the decision now also carries `intent` and `curiosity: { flavor, directive }`. **Thresholds, quiet hours, cooldown, daily cap, boundary/respect mode and the kill switch are untouched** and still decide WHETHER SHERZ writes.

#### One step left on your side
`proactive/proactiveMessageGenerator.js` was not in my copy, so it does not read the new fields yet. In `generateProactiveMessage({ signals, decision })`, add the directive to the prompt, e.g.:

    const curious = decision?.intent === 'curiosity' && decision.curiosity?.directive;
    // append to the system/instruction text:
    if (curious) instruction += '\n\nTHIS CHECK-IN: ' + decision.curiosity.directive;

Send me that file and I will wire it in and test it.

#### Tests
`node --test tests/*.test.mjs` -> 260 pass (new: `tests/curiosity.test.mjs`).

### 2026-10-20 — Boundary intelligence: when SHERZ may act without asking

#### SHERZ — "Why may I act without asking?"  (boundary reasoning)

#### What changed in behaviour

| The user says… | Where does the effect land? | What SHERZ does |
|---|---|---|
| "Excel fayl yaratib ber", "xarajatlarni PDF qilib ber", "make a Word doc…" | Only inside the user's own SHERZ file area, and they asked for it | Creates it **at once**. The card shows ✓ *Created — you asked for it in this chat*, a Download button, and the file is **saved to the PC automatically** |
| (anything that reads/changes/deletes files on the PC or phone) | The user's device | **Asks** (Approve card), says why |
| (anything that sends something to someone / acts outside the chat) | The outside world | **Asks** |
| (SHERZ wants to do something nobody asked for) | — | **Asks** |
| File contents or web text *tell* SHERZ to create something | Not the user's wish | **Asks** (the run is "tainted" once it has read files) |

#### The reasoning lives in three places (and only one of them is the authority)

1. **System prompt** — `brain/corePersona.js`, new section **6. Acting versus asking: reason about WHERE an action lands**. SHERZ is told to think:
   *"The user asked me for this here. Producing requested content inside our chat is expected, safe and requested, so no permission is needed."* vs.
   *"This touches the user's device, the outside world or personal data, or nobody asked for it, so I must ask first."*
   (Persistence is now section 7.)
2. **Tool description** — `lib/agent/expertBridge.js`: the model is told to think about where the effect lands, and to follow the tool result.
3. **The server (the real authority)** — `lib/agent/intentGrant.js`. A model's belief is never enough: a prompt-injected file could make it "believe" the user asked. The server re-checks facts the model cannot write:
   - the user's **real message** matches a file request (`wantsDocFile`), never the system's own `[AGENT RESULT …]` report
   - every step is a tool that **declares `scope:'chat'`** (`docs.create_xlsx/docx/pdf/pptx`). A tool that declares nothing can never auto-run → default is ASK
   - the plan came from the assistant, ≤ 3 steps, and the run is **not tainted** (SHERZ has not read the user's files)
   - an own hourly cap (30) — separate from the habit-based autonomy cap
   - then it goes through the normal `gate.approve()` (hash, expiry, **kill switch**, atomic claim). It is logged as `auto_approved` with `grant:'explicit_request'` and the reasoning sentence.
   - it needs **no autonomy settings**: the Phase 3c habit system for device tools is untouched and still OFF by default.

The model also gets an honest tool result (`runs_automatically` or `awaiting_user_approval` + the reason), so it says "I'm creating it" instead of "waiting for approval", and never prints a Markdown table or Python instead.

#### Auto-download to the PC
`public/index.html`: when a plan arrives already executed with `grant:'explicit_request'`, each file is downloaded once (sessionStorage guard, so a reload never re-downloads). The Download button stays as a fallback.
- `/autodownload off` / `/autodownload on` / `/autodownload` (shows the state). Stored in this browser only.
- The browser may ask "allow multiple downloads" the first time you create 2+ files in one go.

*…(rest of the notes: `docs/archive/`)*

### 2026-10-20 — Dynamic, curious greeting

#### SHERZ — a fresh, curious greeting for an empty chat

The fixed `INTROS` list in `public/index.html` is no longer what the user sees. When a chat is empty, the page asks the server for **one opening line written for this moment**. The old list stays only as an **offline fallback** (model down, no network, slow answer).

#### What the greeting is built from  (`lib/greeting.js`)
- **Time of day and weekday in the user's own zone** (the browser sends its time zone). It shapes the line; it does not read the clock out loud.
- **How long since they last wrote** and a short hint of **what the last message was about**.
- **Their preferred name** (at most once) and **up to a few remembered facts** — used only if natural, never health, money, relationships, politics or religion, never stated as certain.
- **The Curiosity Layer** (`proactive/curiosity.js`): a flavor — philosophical, technical, light personal, observation, wonder — rotating so it does not repeat. If the latest emotion log (last 36 h) says the user is stressed, it switches to a **gentle support opening** (calm, no jokes, no probing).
- **The last 6 greetings it gave this user**, which it must not repeat or paraphrase.
- Rules from the persona: honest that it is an AI, no invented facts, at most one question, no stock service phrases, same language/script as the user's last message (Uzbek Latin by default).

#### Safety nets
- A reload within 20 s reuses the same greeting (no extra model call). `?fresh=1` forces a new one.
- Max 12 model calls per user per hour; a hard 6 s server timeout; the page itself gives up after 7 s.
- Any problem (error, timeout, empty or "How can I help you?"-style output, rate limit, no API key) → `source:'fallback'` → the page shows its built-in line. **No error is ever shown to the user**, and a model problem never returns a 5xx.
- Output is cleaned: plain text, ≤ 3 lines, ≤ 240 characters, no markdown, no quotes or "SHERZ:" label.
- Owner-scoped (uses the logged-in user's id only). Guests work too, with less context.
- Model: `SHERZ_GREETING_MODEL`, else `SHERZ_BRAIN_MODEL`, else `gpt-4.1-mini`. Roughly 150–250 tokens in, ≤ 90 out per greeting.

#### Files in this ZIP
NEW: `lib/greeting.js`, `routes/greeting.js`, `tests/greeting.test.mjs`, `tests/fe/greeting.e2e.test.mjs`, `README-greeting.md`
CHANGED: `public/index.html` (full file; or use patch 2 below)
**Not included: `server.js`** — apply patch 1 (two imports and one line), so I never overwrite your own edits.

Tests: full suite 290 passing (281 + 9); browser check 10 passed (fresh greeting shown, new one each time, time zone + login sent, model error / empty / 9 s slow → built-in line, chat with history never asks).

---

### 2026-10-21 — Fixes: profile menu, "haqida" context loss, fake file links

#### SHERZ — three fixes: profile popup, "haqida" context loss, fake file links

#### What was wrong and what changed

1. **Profile menu** — the popup was part of the sidebar footer, so opening it made the footer taller and pushed *Log out* off-screen. It is now an overlay that opens **upwards** from the profile button (opaque, scrolls inside itself). On short windows the upper part of the sidebar scrolls and the footer stays pinned. Browser check: 36 passed (desktop dark/light, short window, phone).
2. **"Xarajatlar haqida"** — two causes: (a) the word *haqida* sent the message to the web-lookup skill before the chat model saw it; (b) the short answer did not look like a file request, so the file tools were off. Now, when SHERZ's last message was a question and one of the last user messages asked for a file, the short answer is treated as part of that file task: skills are skipped, file tools are on, and the original request counts as the user's explicit request (so the file is built right away, no extra click). Cancel words (yo'q, kerak emas, bekor…) and long new messages are not treated as answers.
3. **Fake links** (`sandbox:/…xlsx`) — three layers: the Expert prompt now forbids links and says to call the file tool; if a draft still contains a made-up link and no plan was proposed, the model is sent back **once** to call `docs.create_*` (the fake draft is dropped from its context); whatever still gets through is stripped from the reply (normal chat too, with a short honest note that no file was made). Real links (`/api/files/<id>/download`) are untouched.

Tests: full suite 296 passing (6 new). No new packages.

#### Files
NEW: `lib/docs/followup.js`, `tests/docFollowup.test.mjs`, `profile-popup.css`
CHANGED: `brain/expertTurn.js` (full file), `tests/boundaryTurn.harness.test.mjs` (full file)
Patch by hand: `server.js` (below), `public/sherz-modern.css` (append the block from `profile-popup.css` to the very END of the file)

### 2026-10-21 — One Work Space per user, up to two roles

#### SHERZ — ONE Work Space per user, up to TWO roles inside it

#### What changed
- **One Work Space per user.** Creating a second one is refused (`you already have your Work Space — edit it or add a second role instead`).
- **Up to two roles inside it.** Role 1 is the Space itself; role 2 is stored in a new `role2` column. The user switches the active role from the sidebar card. Switching changes the profile SHERZ uses (name, role, instructions, work style); **skills, chats and files stay shared by the whole Work Space.** The chat title follows the active role. Editing while role 2 is active edits role 2. "Remove this role" brings back role 1 only.
- **Older accounts with several Spaces** get a "Choose your Work Space" dialog when they open the app (once per visit; "Later" is allowed). They keep one, and can use one other as the second role. **Nothing is merged or deleted automatically:** the others are archived, and the second Space's skills move into the kept one (a skill with the same name keeps the original). Until they choose, all their Spaces keep working.
- No new packages.

Tests: full suite **299 passing** (spaces: 15, 3 new groups: roles, migration, routes). Browser: 39 (existing Space flow, updated for roles) + 14 (the new "choose" dialog: opens by itself, Later, keep + second role, nothing deleted, never shows again, phone fit) + 36 (profile popup, from the last zip).

#### Files
NEW: `tests/fe/oneSpace.e2e.test.mjs`, `one-space.css`
CHANGED (full files): `lib/spaces.js`, `routes/spaces.js`, `tests/spaces.test.mjs`, `tests/helpers/spacesDb.mjs`, `tests/fe/spaces.e2e.test.mjs`
By hand: `prisma/schema.prisma` (1 edit), `public/sherz-modern.css` (append `one-space.css` at the very END), `public/index.html` (14 edits below). `server.js` needs **no change**.

### 2026-10-21 — Sidebar clean-up: no Create row, one scrollbar, system keys hidden

#### SHERZ — sidebar clean-up: no Create row, ONE scrollbar, no system keys

This goes **on top of `sherz-onespace.zip`** (it edits code that zip adds).

#### What changed
1. **No "+ Create a Work Space" in the dropdown.** The dropdown now lists only your role(s). With no Work Space yet, the card itself says "Create your Work Space" and opens the creator. The second role is added with a **"+ 2nd role"** chip next to Skills / Edit profile (it disappears at 2 roles). Older accounts see a "Keep one…" chip instead.
2. **One scrollbar.** The sidebar (`.menu-inner`) is now the only scroll container. The project list, the Hub and the facts list no longer scroll on their own, so the three nested scrollbars are gone. The profile button and Log out stay pinned at the bottom. The Hub (appearance, voice, facts, reminders) opens in the same scroll above them and is brought into view. The facts list shows 5 entries with "Show all (N)" so it cannot grow without limit.
   *This replaces the drop-up popup from `sherz-fixes.zip` (the profile menu opened as an overlay with its own scroll). The old popup rules stay in the CSS but no longer match anything; you can delete that block if you like.*
3. **System keys hidden.** `proactive_*`, `learn:*`, `last_*`, `skill:*`, `system:*`, `internal:*`, `tmp:*`, `cache:*`, `state:*`, `tone:*`, `conversation_summary` and keys starting with `_` are never shown in "Knowledge (Facts)". Your own facts still show. The data itself is untouched.

Browser checks: 50 for the sidebar (desktop, short window, light theme, phone: exactly one scroll container, Log out always visible, no system keys, no create row, Show all works), plus the two Space tests updated (39 + 14). `server.js` and the database are unchanged.

#### Files
NEW: `sidebar.css`, `tests/fe/sidebar.e2e.test.mjs` (needs the one-line `/api/facts/` route in your test mock, see the end)
CHANGED: `tests/fe/spaces.e2e.test.mjs`, `tests/fe/oneSpace.e2e.test.mjs`
By hand: `public/index.html` (14 edits below), `public/sherz-modern.css` (append `sidebar.css` at the very END)

#### `public/index.html`

### 2026-10-22 — Live generation status, TXT/MD files, picture generation
**Status:** while a file or picture is being made the chat shows a live line ("⏳ Generating Xarajatlar_Jadvali.xlsx…", "🎨 Generating the picture…" with a timer); the server streams a new `progress` event (`running` → `done|failed|cancelled`), only for plans that really run by themselves. **New tools:** `docs.create_text` (`.txt` / `.md`, content written exactly as given) and `docs.create_image` (OpenAI Images; model from `IMAGE_MODEL`, default `dall-e-3`, `gpt-image-1` also works; max `IMAGES_PER_HOUR` per user, default 10; the picture is saved as a PNG in the user's files and shown inside the plan card, fetched with the login header — no public link, no auto-download). `docs.read` can now read `.txt`/`.md`. **Safety:** a picture only auto-runs when the user's own message asked for a picture (`wantsImage`); an Excel request cannot be used to draw one; made-up `![](sandbox:/x.png)` / `[..](notes.md)` links are stripped. PDF, Word and PowerPoint already existed (`docs.create_pdf|docx|pptx`). Files: `lib/docs/{spec,tools,image,intent,followup}.js`, `lib/agent/{intentGrant,expertBridge}.js`, `brain/expertTurn.js`, `server.js` (6 small edits), `public/{index.html,sherz-modern.css}` · no database change · env: optional `IMAGE_MODEL`, `IMAGE_QUALITY`, `IMAGES_PER_HOUR` · test: "Yangi logo yarat", "menga eslatma.md fayl yozib ber".
