# SHERZ Agent — Phase 1: Confirmation Gate

## Install (3 steps)
1. Append `prisma/AgentAction.prisma.txt` to the end of your `prisma/schema.prisma`, then run `npx prisma db push`
   (until you do, the server falls back to an in-memory store and prints a warning — plans are lost on restart).
2. Copy these into your project (same folders): `server.js`, `brain/expertTurn.js`, `brain/brain.js`,
   `lib/agent/` (new), `routes/agent.js` (new), `public/index.html`, `public/sherz-modern.css`, `public/script.js`, `lib/chatImage.js`, `lib/messages.js`.
3. Restart the server, hard-refresh the page (Ctrl+F5).

## Try it
Type:  `/agent save a note called ideas.md with three startup ideas`
→ SHERZ answers and a plan card appears: steps, risk badges, **Approve & Execute / Edit / Reject**.
Nothing is written until you press Approve. Files go to `./agent_sandbox/<your id>/` (override with `SHERZ_AGENT_SANDBOX`).
No Expert Mode toggle exists yet — the `/agent ` prefix turns it on for that one message.
You can also create a plan without the AI: `POST /api/agent/propose {title, steps:[{tool,args}]}`.

## How the safety works (all enforced on the server, not in the prompt)
- The model's only tool is `propose_action_plan` — it stores a PENDING plan. It cannot approve or run.
- `approve` needs: status pending · not expired (30 min) · the exact `planHash` the user saw · an atomic pending→executing claim (double-click runs once).
- Editing a plan changes its hash, so an earlier approval can't apply to the edited steps.
- Every action is declared in `lib/agent/registry.js` with risk + reversible + strict argument validation; anything undeclared can't run.
  Phase 1 tools: `sandbox.write_note` (low), `sandbox.list_notes` (low), `sandbox.delete_note` (medium, irreversible). Filenames are `[A-Za-z0-9._-]+.(md|txt)`, 20 KB max, confined to your sandbox folder.
- The admin kill switch ('expert' scope) pauses execution; steps stop at the first failure and the rest are marked skipped.
- Every state change is appended to `AgentAction.history` — the log Phase 2 (adaptive trust) will learn from.

## Tests
`node --test tests/*.test.mjs` (agent.test.mjs: 13 tests — gate, validation, concurrency, expiry, HTTP routes).

## Earlier hotfixes still included
multimodal image send, CSP blob preview, dev `req.user`, stream-close fix (see README-multimodal.md).
