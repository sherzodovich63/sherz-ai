// routes/spaces.js — mounted at /api/spaces (behind the global JWT guard in server.js)
//   GET    /api/spaces                      my Work Space (+ presets); `needsPick:true` when an older account still has several Spaces
//   POST   /api/spaces/pick                 { id, secondId? } keep one Space (optionally another as its 2nd role); the rest are archived
//   PUT    /api/spaces/:id/role2            set the second role · DELETE = remove it · POST /:id/active-role { role: 1|2 } switches
//   POST   /api/spaces                      { name, role?, instructions?, preset?, icon?, color?, style? }
//   PATCH  /api/spaces/:id                  edit profile
//   DELETE /api/spaces/:id                  archive (default) · ?permanent=1 = delete Space, skills and chats
//   POST   /api/spaces/:id/open             { fresh? } → { space, conversation }  (newest chat, or a new one)
//   GET    /api/spaces/:id/skills           · POST = teach { name, summary, body, triggers? }
//   PATCH  /api/spaces/:id/skills/:sid      · DELETE · POST /:sid/feedback { value: 1|-1 }
import { Router } from 'express';
import { listSpaces, createSpace, updateSpace, archiveSpace, deleteSpace, openSpaceConversation, getSpace, setSecondRole, removeSecondRole, setActiveRole, pickSpace, needsPick, MAX_SPACES, MAX_ROLES, PRESETS, ICONS, COLORS, STYLES, CATEGORIES } from '../lib/spaces.js';
import { generateSpace } from '../lib/spaceGenerator.js';
import { listSkills, teachSkill, updateSkill, deleteSkill, thumbs, toClient as skillToClient } from '../lib/skills.js';

export const GENERATE_PER_HOUR = 12;
export function spacesRouter({ prisma, isProd = false, ensureUser = async () => {}, llm = null, now = () => Date.now() } = {}) {
  const gen = new Map();      // userId → timestamps of recent generator calls (cost control)
  const r = Router();
  const uid = (req) => req.user?.id || (!isProd ? String(req.query?.userId || req.body?.userId || 'u1') : null);
  const ready = () => !!(prisma && prisma.workSpace && prisma.skill && prisma.skillEvent);
  const wrap = (fn) => async (req, res) => {
    try {
      const userId = uid(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
      if (!ready()) return res.status(503).json({ ok: false, error: 'Work Spaces need a database update: run `npx prisma db push` on the server.' });
      await ensureUser(userId);
      await fn(req, res, userId);
    } catch (e) {
      if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
      if (/Unknown (argument|field)[^\n]*(role2|activeRole)|(role2|activeRole)[^\n]*(does not exist|Unknown)/i.test(String(e?.message || ''))) { console.error('[spaces] role columns not visible to this server process (restart the server so it loads the regenerated Prisma client):', e?.message); return res.status(503).json({ ok: false, error: 'Could not save the role. Restart the server and try again.' }); }
      console.error('[spaces] route error:', e);
      res.status(500).json({ ok: false, error: 'Work Spaces error' });
    }
  };
  const mine = async (userId, id) => { const s = await getSpace(prisma, userId, id); return s && !s.archivedAt ? s : null; };
  const nf = (res) => res.status(404).json({ ok: false, error: 'not found' });

  r.get('/', wrap(async (_req, res, userId) => { const list = await listSpaces(prisma, userId); res.json({ ok: true, spaces: list, needsPick: needsPick(list), limits: { spaces: MAX_SPACES, roles: MAX_ROLES }, presets: PRESETS, categories: CATEGORIES, styles: STYLES, aiGenerator: typeof llm === 'function', icons: ICONS, colors: COLORS }); }));
  r.post('/generate', wrap(async (req, res, userId) => {
    const recent = (gen.get(userId) || []).filter((t) => now() - t < 3600000);
    if (recent.length >= GENERATE_PER_HOUR) return res.status(429).json({ ok: false, error: 'Too many generations this hour. Pick a role from the list or try again later.' });
    recent.push(now()); gen.set(userId, recent);
    const out = await generateSpace({ description: req.body?.description, llm });
    res.json({ ok: true, ...out });
  }));
  r.post('/pick', wrap(async (req, res, userId) => {
    const s = await pickSpace(prisma, userId, { id: req.body?.id, secondId: req.body?.secondId || null });
    return s ? res.json({ ok: true, space: s, spaces: await listSpaces(prisma, userId) }) : nf(res);
  }));
  r.put('/:id/role2', wrap(async (req, res, userId) => { const s = await setSecondRole(prisma, userId, req.params.id, req.body); return s ? res.json({ ok: true, space: s }) : nf(res); }));
  r.delete('/:id/role2', wrap(async (req, res, userId) => { const s = await removeSecondRole(prisma, userId, req.params.id); return s ? res.json({ ok: true, space: s }) : nf(res); }));
  r.post('/:id/active-role', wrap(async (req, res, userId) => { const s = await setActiveRole(prisma, userId, req.params.id, req.body?.role); return s ? res.json({ ok: true, space: s }) : nf(res); }));
  r.post('/', wrap(async (req, res, userId) => res.status(201).json({ ok: true, space: await createSpace(prisma, userId, req.body) })));
  r.patch('/:id', wrap(async (req, res, userId) => { const s = await updateSpace(prisma, userId, req.params.id, req.body); return s ? res.json({ ok: true, space: s }) : nf(res); }));
  r.delete('/:id', wrap(async (req, res, userId) => {
    const ok = req.query.permanent === '1' ? await deleteSpace(prisma, userId, req.params.id) : await archiveSpace(prisma, userId, req.params.id);
    return ok ? res.json({ ok: true }) : nf(res);
  }));
  r.post('/:id/open', wrap(async (req, res, userId) => { const o = await openSpaceConversation(prisma, userId, req.params.id, { fresh: req.body?.fresh === true }); return o ? res.json({ ok: true, ...o }) : nf(res); }));

  r.get('/:id/skills', wrap(async (req, res, userId) => {
    if (!(await mine(userId, req.params.id))) return nf(res);
    res.json({ ok: true, skills: (await listSkills(prisma, userId, req.params.id)).filter((s) => s.status !== 'archived').map(skillToClient) });
  }));
  r.post('/:id/skills', wrap(async (req, res, userId) => {
    if (!(await mine(userId, req.params.id))) return nf(res);
    res.status(201).json({ ok: true, skill: skillToClient(await teachSkill(prisma, userId, req.params.id, req.body)) });   // taught by the user → active
  }));
  r.patch('/:id/skills/:sid', wrap(async (req, res, userId) => {
    if (!(await mine(userId, req.params.id))) return nf(res);
    const s = await updateSkill(prisma, userId, req.params.id, req.params.sid, req.body); return s ? res.json({ ok: true, skill: skillToClient(s) }) : nf(res);
  }));
  r.delete('/:id/skills/:sid', wrap(async (req, res, userId) => (await mine(userId, req.params.id)) && (await deleteSkill(prisma, userId, req.params.id, req.params.sid)) ? res.json({ ok: true }) : nf(res)));
  r.post('/:id/skills/:sid/feedback', wrap(async (req, res, userId) => {
    if (!(await mine(userId, req.params.id))) return nf(res);
    const s = await thumbs(prisma, userId, req.params.id, req.params.sid, req.body?.value); return s ? res.json({ ok: true, skill: skillToClient(s) }) : nf(res);
  }));
  return r;
}
