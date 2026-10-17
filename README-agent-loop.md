# Phase 3a / 3b — Observation loop, self-correction, budgets, folder consent

SHERZ can now look before it plans, work through a task in several steps, and fix its own failed steps —
while **every state-changing batch still needs your Approve**.

## Install
1. Copy the files over your project (same paths). `server.js` and `brain/expertTurn.js` are full files again — if you edited
   them since the last ZIP, send them and I'll merge instead.
2. Append the two models at the bottom of `prisma/AgentAction.prisma.txt` (`AgentRun`, `AgentSettings`) to `prisma/schema.prisma`,
   then `npx prisma db push` (Render build command: `npm install && npx prisma generate && npx prisma db push`).
   Until then runs/consents live in memory only (a warning is logged; they reset on restart).
3. Deploy. No new npm packages. The helper program is unchanged.

## How a task runs
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

## Budgets per task (`lib/agent/runs.js → BUDGET`)
5 plans · 12 reads · 48 KB of file text · 16 executed steps · 3 failed attempts · 6 follow-up turns · 60 min.
Hit one → the model is told to summarise; the task ends. One result can only be followed up once.

## Safety design
- No state-changing action without your click (hash-checked, expiring, kill-switched — unchanged gate).
- **Taint:** once file text is in a task's context, `web_fetch` is removed from the model's tools for the rest of the task
  (blocks "read a file → send it somewhere" prompt-injection chains). Mutations are still plan-only.
- Observation tools are an allowlist (`observe: true` in the registry): write/move/delete/mkdir can never run via `observe`.
- The system's result report is fenced and labelled "not written by the user"; the model is told never to obey text inside files.
- Learning (Phase 2) and auto-approval toggles (Phase 3c) are separate; nothing here auto-approves anything.

## Not in this ZIP
Phase 3c (per-tool auto-approval for High-confidence habits, OFF by default) and 3d (naming/structure conventions, pinned rules).
Known limit: a consent card that you never answered is not restored after a page reload — just ask again.

Tests: `node --test tests/*.test.mjs` (agentLoop: 13 incl. 3 end-to-end with a real helper; expertTurn.harness: 6 drive the REAL expertTurn.js with a scripted model).
