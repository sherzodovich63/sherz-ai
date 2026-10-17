# Phase 3d — Conventions (inferred) + Pinned rules

## Install
1. Add ONE line to the `AgentSettings` model in `prisma/schema.prisma` (also in `prisma/AgentAction.prisma.txt`):
   `prefs Json @default("{}")`
   then run `npx prisma db push` and restart. (Without it, `/rules` shows an error and nothing is learned — nothing else breaks.)
2. Copy the files in this ZIP over your project (same paths), restart, hard-refresh (Ctrl+F5).
3. In the chat type `/rules`.

## What it does
- **Pinned rules** (you write them, max 12 × 160 chars): "Name files in kebab-case", "Reports go in docs/reports". They beat inferred conventions.
- **Inferred conventions** — learned only from plans YOU approved (never automatic runs, failed steps, or file contents). Shapes only: name style (kebab/snake/camel/Pascal/spaces), date-prefix format, which folder each file type goes in, folder-name style. A convention needs ≥ 4 approvals and ≥ 70 % agreement. File names are never stored. "Pin as rule" turns one into a pinned rule; "Forget" wipes them; habits "Forget all" wipes them too.
- Both reach the model as ONE block (≤ 1500 chars ≈ 375 tokens), pinned first. They are advice only — they cannot skip an approval, and the model cannot write rules.

## Files
NEW `lib/agent/conventions.js` · `lib/agent/trust.js` (learns conventions from approvals) · `lib/agent/consent.js` (default `prefs`) · `routes/agent.js` (`GET/POST /rules`, `DELETE /rules/:id`, `DELETE /conventions`) · `brain/expertTurn.js` · `server.js` (4 lines) · `public/index.html` (`/rules` card) · tests (10 + 1).
