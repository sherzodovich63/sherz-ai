// node apply_server_patch_solutions.mjs [path/to/server.js]
// Surgical edits in server.js (nothing else is touched; safe to run twice):
//   1) imports for shared learning   2) one line before loadWorkMode() in runBrainFlow: "it worked" / "it didn't" feedback
//   3) after the /api/spaces mount: the service, the Work Space provider and the /api/solutions routes
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('createSolutionsRuntime')) { console.log('already patched: ' + file); process.exit(0); }
const fail = (m) => { console.error(m); process.exit(1); };

// 1) imports
const IMP = "import { loadWorkMode } from './lib/spaces.js';";
if (!s.includes(IMP)) fail("import of loadWorkMode from './lib/spaces.js' not found — send me that line as it is in your server.js");
s = s.replace(IMP, "import { loadWorkMode, setSolutionsProvider } from './lib/spaces.js';\n" +
  "import { createSharedSolutions } from './lib/sharedSolutions.js';          // opt-in shared learning (Work Space roles)\n" +
  "import { createSolutionsRuntime } from './lib/solutionsRuntime.js';\n" +
  "import { solutionsRouter } from './routes/solutions.js';");

// 2) feedback hook (one line, before the work mode is loaded for a turn)
const LOAD = "    const workMode = await loadWorkMode(prisma, userId, conv, clean);";
const li = s.indexOf(LOAD);
if (li < 0) fail('the line "const workMode = await loadWorkMode(prisma, userId, conv, clean);" was not found in runBrainFlow — send me that part of your server.js');
s = s.slice(0, li) + "    if (conv) solutionsRuntime.onUserTurn({ userId, conv, text: clean });   // shared learning: \"it worked\" / \"it didn't\" (opt-in, fire-and-forget)\n" + s.slice(li);

// 3) service + provider + routes, right after the /api/spaces mount
const MOUNT = "app.use('/api/spaces', spacesRouter(";
const mi = s.indexOf(MOUNT);
if (mi < 0) fail("app.use('/api/spaces', spacesRouter(...)) not found — send me that line as it is in your server.js");
const eol = s.indexOf('\n', mi);
const BLOCK = `
// ── Shared learning (opt-in, Work Space roles only): needs prisma/SharedSolutions.prisma.txt appended to schema.prisma + \`npx prisma db push\` ──
const solutionsService = createSharedSolutions({
  prisma,
  embed: async (text) => (await openai.embeddings.create({ model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small', input: text }, { timeout: 8000 })).data?.[0]?.embedding || null,
  llm: async ({ system, user }) => {
    const r = await openai.chat.completions.create({
      model: process.env.SHERZ_DISTILL_MODEL || process.env.SHERZ_FAST_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' }, temperature: 0, max_tokens: 600,
    }, { timeout: 20000 });
    return r.choices?.[0]?.message?.content || '';
  },
});
const solutionsRuntime = createSolutionsRuntime({ prisma, service: solutionsService });
setSolutionsProvider(solutionsRuntime.provider);
if (!solutionsService.ready()) console.warn('[solutions] SharedSolution tables missing — shared learning is off. Append prisma/SharedSolutions.prisma.txt to schema.prisma and run: npx prisma db push && npx prisma generate');
app.use('/api/solutions', solutionsRouter({ service: solutionsService, isProd, ensureUser: ensureGuestUser }));`;
s = s.slice(0, eol) + BLOCK + s.slice(eol);
fs.writeFileSync(file, s);
console.log('patched ' + file);
