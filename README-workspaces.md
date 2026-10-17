# Work Spaces & Skills (Phase 4, part 1)

A **Work Space** is a reusable job profile (role, rules, work style) with its own chat and its own **skills**.
Skills are procedures you teach; SHERZ uses the ones that match your message. Levels (Learning → Competent → Proficient → Expert)
are **computed from your approvals** (approved plan +1, edited −1, rejected −2, 👍/👎 on the card), never from SHERZ's own opinion.
Skills and Space text are advice only: they can never skip an approval or change safety rules.

## Install
1. **Database** — add the models from `prisma/WorkSpaces.prisma.txt` to `prisma/schema.prisma` (the file lists the 3 models and the 2 small edits to `User` and `Conversation`), then:
   `npx prisma db push`
   Until you do, `/api/spaces` answers 503 and the sidebar section stays hidden. Nothing else breaks.
2. **Files** — copy over: `server.js`, `lib/skills.js`, `lib/spaces.js`, `lib/conversations.js`, `routes/spaces.js`, `routes/agent.js`,
   `brain/spaceContext.js`, `brain/workMode.js`, `brain/expertTurn.js`, `public/index.html`, `public/sherz-modern.css`.
3. **server.js changes** (already applied in the supplied file): imports for `spacesRouter`, `loadWorkMode`, `recordDecision`; `runBrainFlow` and `agentBuildTurn`
   call `loadWorkMode(...)` instead of `workModeFor(conv)`; `app.use('/api/spaces', spacesRouter(...))`; `agentRouter(... evidence: ...)`.

## API
`GET/POST /api/spaces` · `PATCH/DELETE /api/spaces/:id` (`?permanent=1` deletes chats and skills) · `POST /api/spaces/:id/open` ·
`GET/POST /api/spaces/:id/skills` · `PATCH/DELETE /api/spaces/:id/skills/:sid` · `POST /api/spaces/:id/skills/:sid/feedback {value:1|-1}`

## Prompt order (highest authority first)
base persona + safety → trust rules → Space profile (≤2000 chars) → top 3 skills (1500 / 600 / 600 chars) + index of up to 15 names → memory → mode block.
General Spaces get a professional work block; the Developer preset (`style: engineering`) keeps the code block.

## Tests
`node --test tests/*.test.mjs` (skills, spaces, routes, evidence flow, expertTurn harness). Browser test: `tests/fe/spaces.e2e.test.mjs` (needs the mock server from the earlier phases).

## Not in this part yet
Space-scoped memory (needs `memory/memoryRag.js`), researched skills (always as reviewed drafts), DOCX/XLSX/PPTX/PDF tools.

## Update: Space Hub, role catalog, AI role generator, 5 work styles
- **Sidebar**: the Work Spaces block is now a *Space Hub* card (violet, profile switcher with Skills / Edit chips and a "Create a Work Space" row), visually separate from the green Projects list.
- **Creator**: "Describe your role" box (AI writes name, role, instructions, style; falls back to a template if AI is unavailable or fails) + 5 categories (Logistics, Finance & Economics, Software Engineering, Creative & Marketing, Academic) with 3-4 roles each. Everything is editable before saving.
- **Work styles**: Balanced, Analytical, Technical / Code, Fast operational, Formal corporate. Old rows with `engineering` are treated as Technical.
- **Dropdown contrast bug**: the sheet now uses colour tokens for dark and light, and selects/options get explicit colours.
- **New files**: `lib/roleCatalog.js`, `lib/spaceGenerator.js`. **Changed**: `lib/spaces.js`, `routes/spaces.js` (`POST /api/spaces/generate`, `GET` now returns `categories` and `styles`), `brain/workMode.js`, `server.js` (passes the generator model call), `public/index.html`, `public/sherz-modern.css`.
- **No new db push** is needed beyond the earlier WorkSpace/Skill/SkillEvent models.
- **Env (optional)**: `SHERZ_SPACE_GEN_MODEL` (default `SHERZ_FAST_MODEL` or `gpt-4o-mini`). The generator is limited to 12 calls per user per hour. Generated text is sanitized: lines that try to waive approvals or safety are dropped.
