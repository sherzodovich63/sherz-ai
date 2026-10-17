# Phase 3c — Auto-approval (everything OFF by default)

## Install
1. Copy the files in this ZIP over your project (same paths). **No `prisma db push` needed** — it reuses `AgentSettings.autonomy`.
2. Restart the server (`node server.js`). Hard-refresh the page (Ctrl+F5).
3. In the chat type `/autonomy` → switch on a tool (e.g. "Create a folder").

## Files
- NEW `lib/agent/autonomy.js` — the policy engine (decides only)
- `lib/agent/gate.js` — `autoApprove()` + `undoAuto()`; `approve()` got `via:'auto'`
- `routes/agent.js` — `GET/POST /api/agent/autonomy`, `POST /autonomy/off`, `POST /:id/undo`, `makeAutonomy`
- `brain/expertTurn.js` — runs `gate.autoApprove` for plans the assistant just proposed; offers "Approve & always allow"
- `server.js` — creates the autonomy object and passes it on (5 lines; see the SEARCH/REPLACE in the chat)
- `public/index.html`, `public/sherz-modern.css` — `/autonomy` card, "⚡ Ran automatically" notice, Stop / Undo, "Approve & always allow"
- `tests/autonomy.test.mjs` (13) + 1 new harness test

## When does a plan run without a click? (ALL must be true)
1. Every step is `files.list`, `files.read` or `files.mkdir` (hard-coded; `files.write/move/delete` can never be switched on)
2. You switched that tool to **auto** in `/autonomy`
3. Every step matches a learned habit with **High** confidence (tool + folder + file type)
4. The step's folder is inside a folder you already allowed SHERZ to read
5. Helper online · kill switch off · under the hourly cap (default 20, max 60) · ≤ 5 steps
6. The plan was proposed by the assistant (not typed by you)

Medium habit → the card offers **Approve & always allow** (approves this plan and switches the tool on; it still only auto-runs once the habit is High).
Anything else → the normal Approve button.

## Safety properties (tested)
- Auto-runs go through the same `approve()` checks (pending, not expired, exact hash, kill switch, helper preflight, atomic claim); logged `via:'auto'` + `auto_approved` with the justifying habit.
- Auto-runs are NOT counted as your approvals, so they can't raise their own confidence.
- Rejecting or editing a habit lowers it below High → auto stops by itself.
- A settings row with unknown tools / bad values is ignored (normalized on every read).
- Any error in the policy → falls back to the normal approval.
- **Undo** (for created folders): only folders that did NOT exist before; it creates a normal pending `files.delete` plan (→ `.sherz-trash`) that you approve. **Stop doing this automatically** switches the tool off.
- Known limit: prompt-injection text in a read file could suggest a path, but auto needs a High habit for that exact tool+folder+type inside an allowed folder, and these tools are non-destructive.
