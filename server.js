// server.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
import RRuleModule from 'rrule';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

import registerMvpEndpoints from './mvp_endpoints.js';
import { apiLimiter } from './middleware/limits.js';
import { notFound, errorHandler } from './middleware/error.js';
import { authRequired } from './middleware/auth.js';

import { runNluForMemory } from './nlu/runNluForMemory.js';          
import { saveMemoryFactsForUser } from './nlu/saveMemoryFacts.js';   
import { addTodo, listTodos } from './brain/todoService.js';
import { runSkill } from './brain/skillsRouter.js';
import { runBrain } from './brain/brain.js'; // ✅ FIX: Wire the GPT brain
import { openai } from './llm/openaiClient.js'; // ✅ FIX: was referenced (search.qa synthesis) but never imported — latent ReferenceError
import { startProactiveRunner } from './proactive/proactiveRunner.js';
import { streamRoute } from './routes/stream.js';
import { authRouter }  from './routes/auth.js';
import { ttsRouter } from './routes/tts.js';
import { cleanupRateLimitBuckets } from './services/rateLimiter.js';
import { memoryRoute } from './routes/memory.js';
// ───────── Common setup ─────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dayjs.extend(utc);
dayjs.extend(tz);

const { RRule } = RRuleModule;
const DEFAULT_TZ = 'Asia/Tashkent';
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1); // ✅ Render/Vercel sit behind a reverse proxy — needed for correct req.ip/req.secure and rate limiting
streamRoute(app);

setInterval(cleanupRateLimitBuckets, 60 * 60_000);

// Memory NLU helper: har bir user matnidan fact chiqarib, DBga saqlaydi
async function processUserMemory(userId, text) {
  try {
    if (!userId || !text || !text.trim()) return;

    const nlu = await runNluForMemory(text);
    if (!nlu.facts || !nlu.facts.length) return;

    await saveMemoryFactsForUser(prisma, userId, nlu.facts);
  } catch (err) {
    console.error('processUserMemory error:', err);
  }
}


// Helmet (devda inline scriptga ruxsat — UI ishlashi uchun)
function makeHelmet() {
  const csp = {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:", "https:"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "connect-src": ["'self'", "https:", "http:"], // Google/Wiki/SerpAPI/fetch uchun
      "media-src": ["'self'", "data:", "blob:"],  // ✅ FIX: blob: needed for TTS Blob URL audio playback
      "font-src": ["'self'", "data:"],
      // Agar UI CDN script ishlatsa, devda inline ga ruxsat
      ...(isProd
        ? { "script-src": ["'self'"] }
        : { "script-src": ["'self'", "'unsafe-inline'", "https:"], "script-src-attr": ["'unsafe-inline'"] }),
    },
  };
  return helmet({ contentSecurityPolicy: csp, crossOriginEmbedderPolicy: false });
}

// Middlewares (tartib)
app.use(morgan('dev'));
app.use(makeHelmet());
// ✅ CORS_ORIGIN env var — comma-separated list of allowed frontend origins,
// e.g. "https://sherz.vercel.app,https://sherz-git-main.vercel.app"
// Unset/empty = allow all origins (current behavior, fine for local dev).
// Set this in Render's dashboard once the Vercel domain is known to lock it down.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server / curl / no Origin header
    if (allowedOrigins.length === 0) return callback(null, true); // not configured yet — allow all
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn('[cors] blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json());
app.use('/api', apiLimiter);


// So'rov logger (konsolga)
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// ───────── Prisma & Safe storage fallback ─────────
const prisma = new PrismaClient();

const MEM = { reminders: [], facts: [] }; // RAM fallback

function hasModel(modelName) {
  const m = prisma?.[modelName];
  return m && typeof m.create === 'function';
}
function uid(prefix = 'mem') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ✅ AUTH ROUTES — mounted BEFORE the global JWT guard so /register and /login are public
app.use('/api/auth', authRouter(prisma));

// ── Google OAuth legacy redirect shim ────────────────────────────────────────
// .env has GOOGLE_REDIRECT=http://localhost:3000/google/oauth2callback
// This redirects it to the canonical /api/auth/google/callback handler in auth.js
// so you don't need to change the .env or the Google Console redirect URI.
app.get('/google/oauth2callback', (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect('/api/auth/google/callback' + (qs ? '?' + qs : ''));
});
app.use('/api/tts', ttsRouter());

// ── DEV BOOTSTRAP: auto-login endpoint (returns JWT for user 'u1') ──────────
// Removes the need for a login UI during development.
// ALWAYS DISABLE THIS IN PRODUCTION by checking NODE_ENV.
// The issued token is real: it is verified by authRequired just like any other JWT.
app.post('/api/auth/dev-token', async (req, res) => {
  if (isProd) {
    return res.status(404).json({ ok: false, error: 'Not available in production' });
  }
  try {
    const { signJwt } = await import('./middleware/auth.js');
    // Upsert the dev user so req.user.id resolves to a real DB row
    const user = await prisma.user.upsert({
      where:  { id: 'u1' },
      update: {},
      create: { id: 'u1', name: 'Dev User', email: 'dev@sherz.local' },
    }).catch(() => ({ id: 'u1', name: 'Dev User', email: 'dev@sherz.local' }));

    const token = signJwt({ id: user.id, email: user.email, name: user.name });
    console.log('[dev-token] issued JWT for user:', user.id);
    return res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[dev-token] error:', err.message);
    return res.status(500).json({ ok: false, error: 'dev-token failed: ' + err.message });
  }
});

// ✅ SECURITY: all /api/* routes require a valid JWT token.
// Public endpoints (/health, /handle-intent, static files) are outside /api/.
// Exempt: /api/stt/ping (UI status check, no data exposed)
app.use('/api', (req, res, next) => {
  // ── Always-public endpoints ──────────────────────────────────────
  if (req.path === '/stt/ping')          return next(); // STT health
  if (req.path === '/tts/health')        return next(); // TTS health
  if (req.path.startsWith('/auth/'))     return next(); // auth self-manages
  if (req.path === '/search/diag')       return next(); // search diagnostics
  if (req.path.startsWith('/google/'))   return next(); // Google OAuth callback

  // ── DEV-only: skip auth if NODE_ENV !== 'production' ─────────────
  // This lets the browser use the app before the login UI is built.
  // Remove (or tighten) this block before going live.
  if (!isProd) return next();

  return authRequired(req, res, next);
});

// Reminders (SAFE)
async function reminderCreateSafe(data) {
  if (hasModel('reminder')) {
    // dueAt bilan kelgan bo'lsa, scheduledFor ga map qilamiz
    const prismaData = { ...data };
    if (prismaData.dueAt && !prismaData.scheduledFor) {
      prismaData.scheduledFor = prismaData.dueAt;
      delete prismaData.dueAt;
    }
    if (!prismaData.status) {
      prismaData.status = 'pending'; // oldingi 'scheduled' o‘rniga
    }
    return prisma.reminder.create({ data: prismaData });
  }

  // In-memory fallback (Prisma bo‘lmasa)
  const r = {
    id: uid('r'),
    status: data.status ?? 'pending',  // bu yerda ham 'pending'
    createdAt: new Date(),
    ...data,
  };
  MEM.reminders.push(r);
  return r;
}
async function reminderFindManySafe(opts = {}) {
  // Agar Prisma modeli mavjud bo'lsa — dueAt ni scheduledFor ga map qilib yuboramiz
  if (hasModel('reminder')) {
    const prismaOpts = { ...opts };

    if (prismaOpts.where?.dueAt) {
      prismaOpts.where = {
        ...prismaOpts.where,
        scheduledFor: prismaOpts.where.dueAt, // filterni shu ustunga o‘tkazamiz
      };
      delete prismaOpts.where.dueAt;
    }

    if (prismaOpts.orderBy?.dueAt) {
      prismaOpts.orderBy = { scheduledFor: prismaOpts.orderBy.dueAt };
    }

    return prisma.reminder.findMany(prismaOpts);
  }

  // In-memory fallback (Prisma yo‘q bo‘lsa)
  let list = [...MEM.reminders];

  if (opts?.where?.status) {
    list = list.filter((x) => x.status === opts.where.status);
  }
  if (opts?.where?.dueAt?.lte) {
    list = list.filter((x) => x.dueAt <= opts.where.dueAt.lte);
  }
  if (opts?.orderBy?.dueAt === 'asc') {
    list.sort((a, b) => a.dueAt - b.dueAt);
  }

  return list;
}
async function reminderFindUniqueSafe(where) {
  if (hasModel('reminder')) return prisma.reminder.findUnique({ where });
  return MEM.reminders.find(x => x.id === where.id) || null;
}
async function reminderUpdateSafe({ where, data }) {
  if (hasModel('reminder')) return prisma.reminder.update({ where, data });
  const i = MEM.reminders.findIndex(x => x.id === where.id);
  if (i < 0) throw new Error('not found');
  MEM.reminders[i] = { ...MEM.reminders[i], ...data };
  return MEM.reminders[i];
}
async function reminderDeleteSafe({ where }) {
  if (hasModel('reminder')) return prisma.reminder.delete({ where });
  const i = MEM.reminders.findIndex(x => x.id === where.id);
  if (i >= 0) MEM.reminders.splice(i, 1);
  return { ok: true };
}

// Facts (SAFE)
async function factCreateSafe(data) {
  if (hasModel('fact')) return prisma.fact.create({ data });
  const f = { id: uid('f'), createdAt: new Date(), ...data };
  MEM.facts.push(f);
  return f;
}
async function factFindManySafe(opts = {}) {
  if (hasModel('fact')) return prisma.fact.findMany(opts);
  let list = [...MEM.facts];
  if (opts?.where?.userId) list = list.filter(x => x.userId === opts.where.userId);
  if (opts?.orderBy?.createdAt === 'desc') list.sort((a, b) => b.createdAt - a.createdAt);
  if (opts?.take) list = list.slice(0, opts.take);
  return list;
}
async function factDeleteSafe({ where }) {
  if (hasModel('fact')) return prisma.fact.delete({ where });
  const i = MEM.facts.findIndex(x => x.id === where.id);
  if (i >= 0) MEM.facts.splice(i, 1);
  return { ok: true };
}

// Short-term session memory
const SESSION = new Map(); // Map<userId, Map<key,{value,expireAt}>>
function stSet(userId, key, value, ttlMs = 15 * 60 * 1000) {
  const bucket = SESSION.get(userId) || new Map();
  bucket.set(key, { value, expireAt: Date.now() + ttlMs });
  SESSION.set(userId, bucket);
}
function stGet(userId, key) {
  const b = SESSION.get(userId);
  if (!b) return;
  const rec = b.get(key);
  if (!rec) return;
  if (Date.now() > rec.expireAt) {
    b.delete(key);
    return;
  }
  return rec.value;
}

// Skill metrics (oddiy)
const METRICS = { skills: Object.create(null) };
function skillScore(name) {
  const m = METRICS.skills[name] || { ok: 0, fail: 0, last: 0 };
  return (m.ok - m.fail) + (m.last ? 0.1 : 0);
}
function learnSkillHit(name, ok = true) {
  const m = METRICS.skills[name] || (METRICS.skills[name] = { ok: 0, fail: 0, last: 0 });
  ok ? m.ok++ : m.fail++;
  m.last = Date.now();
}
async function logSkillFact(userId, name, ok) {
  try {
    await factCreateSafe({
      userId,
      key: `learn:skill:${name}`,
      value: ok ? 'ok' : 'fail',
      type: 'learning',
      time: new Date().toISOString(),
      rating: ok ? 1 : -1
    });
  } catch { }
}

// RRule helper
function nextFromRRule(rruleStr, from = new Date(), timezone = DEFAULT_TZ) {
  try {
    const base = dayjs(from).tz(timezone).toDate();
    const rule = RRule.fromString(rruleStr);
    const next = rule.after(base, true);
    if (!next) return null;
    const d = dayjs(next).tz(timezone);
    return new Date(d.toDate().getTime());
  } catch (e) {
    console.error('RRULE parse error:', e);
    return null;
  }
}

// ───────── Upload (STT) ─────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ───────── Health ─────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ───────── Reminders API ─────────
app.post('/api/reminders', async (req, res) => {
  try {
    const { title, dueAt, notes, channel } = req.body || {};
    if (!title || !dueAt) return res.status(400).json({ ok: false, error: 'title va dueAt shart' });
    const r = await reminderCreateSafe({
      title,
      notes: notes ?? null,
      channel: channel ?? 'local',
      dueAt: new Date(dueAt)
    });
    res.json({ ok: true, reminder: r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'create failed' });
  }
});

app.get('/api/reminders', async (_req, res) => {
  try {
    const list = await reminderFindManySafe({ orderBy: { dueAt: 'asc' } });
    res.json({ ok: true, reminders: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'list failed' });
  }
});

app.patch('/api/reminders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, dueAt, notes, status, channel } = req.body || {};
    const r = await reminderUpdateSafe({
      where: { id },
      data: {
        ...(title ? { title } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(channel ? { channel } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt) } : {}),
        ...(status ? { status } : {}),
      }
    });
    res.json({ ok: true, reminder: r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'update failed' });
  }
});

app.delete('/api/reminders/:id', async (req, res) => {
  try {
    await reminderDeleteSafe({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'delete failed' });
  }
});

app.get('/api/reminders/:id/ics', async (req, res) => {
  try {
    const r = await reminderFindUniqueSafe({ id: req.params.id });
    if (!r) return res.status(404).send('Not found');

    const pad = n => String(n).padStart(2, '0');
    const fmt = d =>
      d.getUTCFullYear().toString() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      'Z';

    const dt = new Date(r.dueAt);
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SHERZ//Reminder//UZ',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${r.id}@sherz.local`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(dt)}`,
      `DTEND:${fmt(new Date(dt.getTime() + 30 * 60 * 1000))}`,
      `SUMMARY:${String(r.title).replace(/\n/g, ' ')}`,
      r.notes ? `DESCRIPTION:${String(r.notes).replace(/\n/g, ' ')}` : 'DESCRIPTION:SHERZ reminder',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=reminder-${r.id}.ics`);
    res.send(ics);
  } catch (e) {
    console.error(e);
    res.status(500).send('ICS error');
  }
});

// ───────── Facts API (batch yoki single) ─────────
app.post('/api/facts', async (req, res) => {
  try {
    const body = req.body;
    const items = Array.isArray(body) ? body : [body];
    const results = [];

    if (!hasModel('fact')) {
      for (const it of items) {
        const { userId = req.user?.id || 'unknown', key, value, type = null, time = null, rating = null } = it || {}; // ✅
        if (!key || !value) return res.status(400).json({ error: 'key va value shart' });
        results.push(await factCreateSafe({ userId, key, value, type, time, rating }));
      }
      return res.status(201).json({ inserted: results.length, facts: results });
    }

    for (const it of items) {
      const { userId, key, value } = it || {};
      if (!userId || !key || !value) return res.status(400).json({ error: 'userId, key, value required' });

      const tagNames = (it.tags || []).map(t => String(t).trim()).filter(Boolean);
      const tagRecords = await Promise.all(
        tagNames.map(name =>
          prisma.factTag.upsert({ where: { name }, update: {}, create: { name } })
        )
      );

      const created = await prisma.fact.create({
        data: {
          userId: it.userId,
          key: it.key,
          value: it.value,
          type: it.type ?? null,
          time: it.time ?? null,
          rating: it.rating ?? null,
          tags: { create: tagRecords.map(tr => ({ tagId: tr.id })) }
        },
        include: { tags: { include: { tag: true } } }
      });

      results.push(created);
    }
    res.status(201).json({ inserted: results.length, facts: results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

app.get('/api/facts/:userId', async (req, res) => {
  // ✅ SECURITY: users can only read their own facts
  if (req.params.userId !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  try {
    const facts = await factFindManySafe({
      where: { userId: req.params.userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.json({ ok: true, facts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'fact list failed' });
  }
});

app.delete('/api/facts/:id', async (req, res) => {
  try {
    await factDeleteSafe({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'fact delete failed' });
  }
});

app.get('/api/facts/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const tagsParam = (req.query.tags || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const userId = (req.query.userId || '').toString().trim();

    if (!hasModel('fact')) {
      let list = MEM.facts.filter(x => !userId || x.userId === userId);
      if (q) list = list.filter(x => (x.key + ' ' + x.value).toLowerCase().includes(q.toLowerCase()));
      return res.json({ count: Math.min(limit, list.length), facts: list.slice(0, limit) });
    }

    const where = {};
    if (userId) where.userId = userId;
    if (q)
      where.OR = [
        { key: { contains: q, mode: 'insensitive' } },
        { value: { contains: q, mode: 'insensitive' } }
      ];

    const tags = tagsParam ? tagsParam.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (tags.length) where.tags = { some: { tag: { name: { in: tags } } } };

    const facts = await prisma.fact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { tags: { include: { tag: true } } },
    });

    res.json({ count: facts.length, facts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
});

// ───────── Habits helpers/parsers ─────────
const TIME_ALIASES = {
  'ertalab': '08:00',
  'tongda': '06:30',
  'tushda': '12:30',
  'peshinga': '12:30',
  'kechqurun': '19:00',
  'kechasi': '22:00'
};
function normalizeUz(str = '') {
  return String(str)
    .toLowerCase()
    .replaceAll('’', "'")
    .replaceAll('‘', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractClock(t) {
  const m1 = t.match(/\b(\d{1,2})\s*[:.]\s*(\d{2})\b/);
  if (m1) {
    const hh = Math.min(23, Math.max(0, parseInt(m1[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m1[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const m2 = t.match(/\bsoat\s*(\d{1,2})\b/);
  if (m2) {
    const hh = Math.min(23, Math.max(0, parseInt(m2[1], 10)));
    return `${String(hh).padStart(2, '0')}:00`;
  }
  return null;
}
function extractAlias(t) {
  for (const k of Object.keys(TIME_ALIASES)) {
    if (t.includes(k)) return TIME_ALIASES[k];
  }
  return null;
}
function parseHabitSentence(raw = '') {
  const text = normalizeUz(raw);
  if (!/^har\s+kuni\b/.test(text)) return null;
  const clock = extractClock(text) || extractAlias(text);
  if (!clock) return null;

  let action = text
    .replace(/^har\s+kuni\b/, '')
    .replace(/\bsoat\s*\d{1,2}[:.]\d{2}\b/, '')
    .replace(/\bsoat\s*\d{1,2}\b/, '')
    .replace(/\b(ertalab|tongda|tushda|peshinga|kechqurun|kechasi)\b/, '')
    .replace(/\b(qilaman|qilamiz|qilmoqchiman|qilay|qilayman|qilamanmi)\b/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!action) action = 'odat';
  return { action, timeStr: clock };
}

function nextDueAtFromClock(clock) {
  const [h, m] = clock.split(':').map(Number);
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (due <= now) due.setDate(due.getDate() + 1);
  return due;
}

// ───────── Context Memory / Profile helpers & skills ─────────

// Profil uchun bitta qiymat yozish (yoqtirgan taom, uyg'onish vaqti va hok.)
async function saveProfileValue(userId, key, value, extra = {}) {
  if (!userId) userId = 'unknown_user'; // ✅ never default to a shared userId
  return factCreateSafe({
    userId,
    key,
    value,
    type: extra.type || 'profile',
    time: new Date().toISOString(),
    rating: extra.rating ?? null,
  });
}

// Profilni o'qish (profile:* va pref:like/dislike:* larni yig'ib chiqamiz)
async function loadProfileSummary(userId) {
  const facts = await factFindManySafe({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const profile = {
    favoriteFoods: [],
    wakeTimes: [],
    workSchedules: [],
    interests: [],
    likes: [],
    dislikes: [],
    favoriteMusic: [],      // 🎧 qo‘shildi
    favoritePerson: [],     // ❤️ qo‘shildi
  };

  for (const f of facts) {
    const k = String(f.key || '');
    const v = String(f.value || '').trim();
    if (!k || !v) continue;

    if (k === 'profile:favorite_food') {
      profile.favoriteFoods.push(v);

    } else if (k === 'profile:wake_time') {
      profile.wakeTimes.push(v);

    } else if (k === 'profile:work_schedule') {
      profile.workSchedules.push(v);

    } else if (k === 'profile:interest') {
      profile.interests.push(v);

    } else if (k === 'profile:favorite_music') {     // 🎧 MUSIQA
      profile.favoriteMusic.push(v);
    } else if (k.startsWith('pref:like:')) {
      profile.likes.push(v);

    } else if (k.startsWith('pref:dislike:')) {
      profile.dislikes.push(v);
    }
  }

  const uniq = arr => Array.from(new Set(arr));
  profile.favoriteFoods = uniq(profile.favoriteFoods);
  profile.wakeTimes = uniq(profile.wakeTimes);
  profile.workSchedules = uniq(profile.workSchedules);
  profile.interests = uniq(profile.interests);
  profile.likes = uniq(profile.likes);
  profile.dislikes = uniq(profile.dislikes);
  profile.favoriteMusic = uniq(profile.favoriteMusic);     // qo‘shildi
  profile.favoritePerson = uniq(profile.favoritePerson);   // qo‘shildi

  return profile;
}

// "Mening yoqtirgan taomim osh", "uyg'onish vaqtim soat 7:30" va hok. ni ushlaydigan skill
async function runSkillProfileSet({ clean, lower, userId }) {
  const text = clean.trim();

  // 1) Yoqtirgan taom
  let m = text.match(/yoqtirgan\s+taom(im)?\s*(?:bu|:)?\s*(.+)$/i);
  if (m) {
    const food = m[2].trim();
    if (food) {
      await saveProfileValue(userId, 'profile:favorite_food', food);
      return { said: `Super, eslab qoldim: sening yoqtirgan taoming — ${food}.` };
    }
  }
  // 2) Uyg'onish vaqti
  if (/uyg[oʼo'’]nish\s+vaqt(im)?/i.test(text)) {
    const norm = normalizeUz(text);
    const clock = extractClock(norm) || extractAlias(norm);
    const value = clock || text.replace(/.*uyg[oʼo'’]nish\s+vaqt(im)?/i, '').replace(/^(bu|:)\s*/i, '').trim() || text;

    await saveProfileValue(userId, 'profile:wake_time', value);
    const humanTime = clock || value;
    return { said: `Eslab qoldim: odatda ${humanTime} atrofida uyg'onishingni yozib qo'ydim.` };
  }

  // 3) Ish jadvali / ish grafigi
  if (/ish\s+(jadvalim|grafigim)/i.test(text)) {
    const schedule = text
      .replace(/.*ish\s+(jadvalim|grafigim)/i, '')
      .replace(/^(bu|:)\s*/i, '')
      .trim() || text;

    await saveProfileValue(userId, 'profile:work_schedule', schedule);
    return { said: `Ish jadvalingni eslab qoldim: ${schedule}.` };
  }

  // 4) Qiziqadigan mavzular
  m =
    text.match(/men\s+(.+?)\s+mavzulariga\s+(judayam\s+)?qiziq(a(man|man)?|aman)/i) ||
    text.match(/men\s+(.+?)\s+ga\s+(judayam\s+)?qiziq(a(man|man)?|aman)/i);

  if (m) {
    const topic = m[1].trim();
    if (topic) {
      await saveProfileValue(userId, 'profile:interest', topic);
      return { said: `Zo'r, ${topic} mavzusiga qiziqishingni eslab qoldim.` };
    }
  }

  // 5) "Menga ... yoqadi"
  m = text.match(/menga\s+(.+?)\s+yoqadi\b/i);
  if (m) {
    const thing = m[1].trim();
    await saveProfileValue(userId, `pref:like:${thing.toLowerCase()}`, thing, {
      type: 'preference',
      rating: 1,
    });
    return { said: `Yodda tutdim: senga ${thing} yoqadi.` };
  }

// 6) "Menga ... yoqmaydi"
  m = text.match(/menga\s+(.+?)\s+yoqmaydi\b/i);
  if (m) {
    const thing = m[1].trim();
    await saveProfileValue(userId, `pref:dislike:${thing.toLowerCase()}`, thing, {
      type: 'preference',
      rating: -1,
    });
    return { said: `Tushundim, ${thing} yoqmasligini eslab qoldim.` };
  }

  // 7) Yoqtirgan musiqa  ✅ FUNKSIYA ICHIDA
  m = text.match(/yoqtirgan\s+musiqa(m)?\s*(?:bu|:)?\s*(.+)$/i);
  if (m) {
    const music = m[2].trim();
    if (music) {
      await saveProfileValue(userId, 'profile:favorite_music', music, {
        type: 'preference',
        rating: 1,
      });
      return { said: `Super, eslab qoldim: sening yoqtirgan musiqang — ${music}.` };
    }
  }
  // fallback
  return null;
}
// "Profilimni ko'rsat", "context memory" kabilar uchun skill
async function runSkillProfileShow({ userId }) {
  const profile = await loadProfileSummary(userId);

  const parts = [];

  if (profile.favoriteFoods.length) {
    parts.push(`🍽 Yoqtirgan taomlaring: ${profile.favoriteFoods.join(', ')}`);
  }
  if (profile.wakeTimes.length) {
    parts.push(`⏰ Odatdagi uyg'onish vaqting: ${profile.wakeTimes.join(', ')}`);
  }
  if (profile.workSchedules.length) {
    parts.push(`💼 Ish jadvaling: ${profile.workSchedules.join(' | ')}`);
  }
  if (profile.interests.length) {
    parts.push(`📚 Qiziqadigan mavzularing: ${profile.interests.join(', ')}`);
  }
  if (profile.likes.length) {
    parts.push(`✅ Senga yoqadigan narsalar: ${profile.likes.join(', ')}`);
  }
  if (profile.dislikes.length) {
    parts.push(`🚫 Senga yoqmaydigan narsalar: ${profile.dislikes.join(', ')}`);
  }
  if (profile.favoriteMusic && profile.favoriteMusic.length) {
  parts.push(`🎵 Yoqtirgan musiqalaring: ${profile.favoriteMusic.join(', ')}`);
  }
  if (!parts.length) {
    return {
      said:
        "Hali sen haqingda uzoq muddatli ma'lumotlar juda kam. " +
        "Masalan: \"yoqtirgan taomim osh\", \"uyg'onish vaqtim soat 7:00\", \"menga kofe yoqadi\" deb yozsang, eslab qolaman.",
    };
  }

  const text =
    "Sening context memory (uzoq muddatli profil) bo‘yicha biladiganlarim:\n\n" +
    parts.join('\n');

  return { said: text };
}

// ───────── To-do / Reja parser ─────────
function parseTodoSentence(raw = '') {
  if (!raw) return null;
  const lowerRaw = raw.toLowerCase();
  // Savol bo'lsa yoki 'kerak' / 'qilmoqchiman' yo'q bo'lsa — to-do emas
  if (lowerRaw.includes('?')) return null;
  if (!/\bkerak\b/i.test(lowerRaw) && !/\bqilmoqchiman\b/i.test(lowerRaw)) return null;

  const text = normalizeUz(raw);

  // Sana: bugun / ertaga / indinga
  let dayOffset = 0;
  if (/\bertaga\b/.test(text)) dayOffset = 1;
  if (/\bindinga\b/.test(text)) dayOffset = 2;
  const hasTodayWord = /\bbugun(gi)?\b/.test(text);

  // Soat: "soat 4", "soat 16:30", aliaslar
  const clock = extractClock(text) || extractAlias(text) || '18:00';
  const [hh, mm] = clock.split(':').map(Number);

  const now = new Date();
  const due = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    hh,
    mm,
    0,
    0
  );

  // Action / vazifa matnini ajratamiz
  let action = text;
  action = action
    .replace(/\bbugun(gi)?\b/g, '')
    .replace(/\bertaga\b/g, '')
    .replace(/\bindinga\b/g, '')
    .replace(/\bsoat\s*\d{1,2}[:.]\d{2}\b/g, '')
    .replace(/\bsoat\s*\d{1,2}\b/g, '')
    .replace(/\b(ertalab|tongda|tushda|peshinga|kechqurun|kechasi)\b/g, '')
    .replace(/\b(qilishim\s*kerak|qilish\s*kerak|qilmoqchiman|qilaman|qilib\s*qo['’]yaman|qib\s*qo['’]yaman)\b/g, '')
    .replace(/\b(vazifa|reja|plan|to-do)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!action) return null;

  return { title: action, dueAt: due, hasTodayWord };
}

// ───────── Skills: wiki/search helpers ─────────
const CSE_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_KEY || '';
const CSE_CX = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CSE_CX || process.env.CSE_CX || '';
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';

// fetch polyfill (guard)
if (typeof fetch === 'undefined') {
  const { default: nodeFetch } = await import('node-fetch');
  // @ts-ignore
  globalThis.fetch = nodeFetch;
}

// timeout helper
async function withTimeout(promise, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort('timeout'), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(id);
  }
}

const WIKI_CACHE = new Map();
async function wikiSummary(title, preferLang = 'uz') {
  if (!title) return null;
  const key = `${preferLang}:${title.toLowerCase()}`;
  if (WIKI_CACHE.has(key)) return WIKI_CACHE.get(key);
  const langs = [preferLang, 'en'];
  for (const lang of langs) {
    try {
      const enc = encodeURIComponent(title);
      const j = await withTimeout(async (signal) => {
        const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`, { signal });
        if (!r.ok) return null;
        return r.json();
      });
      const text = (j?.extract || '').replace(/\s+/g, ' ').trim();
      if (text) {
        const capped = text.length > 500 ? text.slice(0, 500) + '…' : text;
        WIKI_CACHE.set(key, capped);
        return capped;
      }
    } catch { }
  }
  return null;
}
function cleanSearchSnippet(s = '') {
  return (s || '')
    .replace(/^\s*\d+\s+(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\s+…\s*/i, '')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}
function toTwoSentences(text, maxLen = 800) {
  if (!text) return '';
  let t = text.replace(/\s+/g, ' ').trim();
  const parts = t.split(/(?<=[.!?])\s+/).slice(0, 4);
  t = parts.join(' ');
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).trimEnd() + '…';
  return t;
}
async function randomWikiFact(preferLang = 'uz') {
  const langs = [preferLang, 'en'];
  for (const lang of langs) {
    try {
      const j = await withTimeout(async (signal) => {
        const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`, { signal });
        if (!r.ok) return null;
        return r.json();
      });
      const text = (j?.extract || '').replace(/\s+/g, ' ').trim();
      if (text) return toTwoSentences(text, 300);
    } catch { }
  }
  return null;
}

// Provider: Google CSE
async function searchGoogleCSE(query, num = 5) {
  if (!(CSE_KEY && CSE_CX)) return [];
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', CSE_KEY);
  url.searchParams.set('cx', CSE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(num));
  url.searchParams.set('safe', 'active');
  try {
    const data = await withTimeout(async (signal) => {
      const r = await fetch(url.toString(), { signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || 'Google CSE error');
      return j;
    });
    return (data.items || []).map(it => ({
      title: it.title,
      link: it.link,
      snippet: (it.snippet || '').replace(/\s+/g, ' ').trim(),
      displayLink: it.displayLink || (it.link ? new URL(it.link).hostname : ''),
    }));
  } catch (e) {
    console.warn('Google CSE failed:', String(e));
    return [];
  }
}

// Provider: SerpAPI
async function searchSerpApi(query, num = 5) {
  if (!SERPAPI_KEY) return [];
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('api_key', SERPAPI_KEY);
  url.searchParams.set('num', String(num));
  try {
    const data = await withTimeout(async (signal) => {
      const r = await fetch(url.toString(), { signal });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'SerpAPI error');
      return j;
    });
    return (data.organic_results || []).slice(0, num).map(it => ({
      title: it.title,
      link: it.link,
      snippet: (it.snippet || (it.snippet_highlighted_words || []).join(' ') || '').replace(/\s+/g, ' ').trim(),
      displayLink: it.displayed_link || (it.link ? new URL(it.link).hostname : ''),
    }));
  } catch (e) {
    console.warn('SerpAPI failed:', String(e));
    return [];
  }
}

// Autoselect + retry
async function webSearch(query, num = 5) {
  // 1) Google CSE
  let items = await searchGoogleCSE(query, num);
  if (items.length) return { provider: 'google_cse', items };

  // 2) SerpAPI fallback
  items = await searchSerpApi(query, num);
  if (items.length) return { provider: 'serpapi', items };

  // 3) no external provider → empty
  return { provider: 'none', items: [] };
}

async function buildBriefAnswer(query) {
  // Wiki birinchi
  const wiki = await wikiSummary(query, 'uz');
  if (wiki) return toTwoSentences(wiki);

  // Web search (Google/SerpAPI)
  const { items } = await webSearch(query, 5);
  if (items.length) {
    const snippets = items
      .map(i => cleanSearchSnippet(i.snippet))
      .filter(Boolean)
      .slice(0, 2)
      .join(' ');
    const brief = toTwoSentences(snippets);
    if (brief) return brief;
  }

  // Random wiki (oxirgi fallback)
  const rnd = await randomWikiFact('uz');
  return rnd || null;
}

// ───────── Skills router (/handle-intent) ─────────
async function runSkillHabit({ clean, userId }) {
  const parsed = parseHabitSentence(clean);
  if (!parsed) return null;
  const { action, timeStr } = parsed;
  await factCreateSafe({
    userId,
    key: `habit:${action}`,
    value: timeStr,
    type: 'habit',
    time: timeStr,
    rating: 1
  });
  const dueAt = nextDueAtFromClock(timeStr);
  await reminderCreateSafe({
    title: `Odat: ${action}`,
    notes: `habit:daily @ ${timeStr}`,
    channel: 'habit',
    dueAt
  });
  return {
    said: `Qabul qildim! "${action}" odatingni har kuni ${timeStr} da eslatib turaman. Birinchi eslatma ${dueAt.toLocaleString()} uchun qo‘yildi.`
  };
}

async function runSkillRemember({ clean, lower, userId }) {
  const m = clean.match(/(?:^|\b)(?:eslab\s*qol|remember)\s*[:\-]?\s*(.+)$/i);
  if (!m) return null;
  let factText = m[1].trim();
  if (!factText) return { said: 'Nimani eslab qolishim kerak?' };
  let key = 'note', value = factText;
  const kv = factText.match(/^([^:]+):\s*(.+)$/);
  if (kv) { key = kv[1].trim(); value = kv[2].trim(); }
  await factCreateSafe({ userId, key, value });
  return { said: `Esladim: ${key} → ${value}` };
}

async function runSkillFactsList({ lower, userId }) {
  if (!/nimalarni\s+bilasan|men\s+haqimda/i.test(lower)) return null;
  const facts = await factFindManySafe({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  // ✅ FIX: filter out internal system/learning/state facts — never show these to user
  const userFacts = facts.filter(f =>
    f.type !== 'learning' &&
    f.type !== 'state' &&
    !String(f.key || '').startsWith('learn:') &&
    !String(f.key || '').startsWith('proactive_') &&
    !String(f.key || '').startsWith('last_state') &&
    !String(f.key || '').startsWith('feedback:')
  );
  if (!userFacts.length) return { said: 'Hali hech narsa eslab qolmaganmiz.' };
  return { said: userFacts.map(f => `• ${f.key}: ${f.value}`).join('\n') };
}

// ───────── Journal skills ─────────
async function runSkillJournalSave({ clean, lower, userId }) {
  // Trigger faqat kayfiyat/jurnal uchun: oddiy "bugun ..." rejani ushlamasin
  if (!/(bugungi\s+kunim\b|jurnalga\s+yoz|kundaligimga\s+yoz|jurnal\s+yoz)/i.test(lower)) return null;

  // Agar gap "bugungi kunim" bilan boshlangan bo'lsa, boshidan olib tashlaymiz
  let content = clean.replace(/^bugungi\s+kunim\s*/i, '').trim();
  if (!content) {
    return { said: "Bugungi kuning qanday o'tdi? Biroz batafsilroq yozib bera olasanmi?" };
  }

  await factCreateSafe({
    userId,
    key: 'journal',
    value: content,
    type: 'journal',
    time: new Date().toISOString(),
    rating: null
  });

  return { said: "Yaxshi, bugungi kuningni jurnalga yozib qo'ydim 😊" };
}

async function runSkillJournalSummary({ lower, userId }) {
  // Trigger: hafta / oxirgi 7 kun / jurnalni ko'rsat
  if (!/jurnal|kunlik\s+jurnal|hafta|oxirgi\s+7\s+kun/i.test(lower)) return null;

  const since = Date.now() - 7 * 24 * 60 * 60 * 1000; // oxirgi 7 kun
  const facts = await factFindManySafe({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  const journal = facts.filter(f => {
    const isJournal = f.type === 'journal' || f.key === 'journal';
    const t = f.createdAt ? new Date(f.createdAt).getTime() : Date.now();
    return isJournal && t > since;
  });

  if (!journal.length) {
    return { said: "Oxirgi 7 kun uchun jurnal topilmadi. Bugundan boshlab yozishni boshlashimiz mumkin 😊" };
  }

  const lines = journal
    .map(f => {
      const d = f.createdAt ? new Date(f.createdAt) : new Date();
      const dateStr = d.toLocaleDateString();
      return `• ${dateStr} — ${f.value}`;
    })
    .join('\n');

  return { said: `Oxirgi 7 kunlik jurnal yozuvlaring:\n${lines}` };
}

// ───────── To-do / Reja skills ─────────
async function runSkillTodoCreate({ clean, lower, userId }) {
  const parsed = parseTodoSentence(clean);
  if (!parsed) return null;

  const { title, dueAt } = parsed;

  const r = await reminderCreateSafe({
    title,
    notes: 'todo',
    channel: 'todo',
    status: 'todo_pending',
    dueAt,
    userId,
  });

  const whenStr = dueAt.toLocaleString();
  return {
    said: `Rejangni eslab qoldim: "${title}" — ${whenStr} uchun qo‘shdim.`
  };
}

async function runSkillTodoListToday({ userId }) {
  const all = await reminderFindManySafe({});

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const todays = all
    .filter(r => {
      if (!r.dueAt) return false;
      const d = new Date(r.dueAt);
      if (d < start || d > end) return false;
      if (r.channel !== 'todo') return false;
      if (r.userId && userId && r.userId !== userId) return false;
      return true;
    })
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  if (!todays.length) {
    return { said: 'Bugungi rejangda hali vazifalar yo‘q.' };
  }

  const lines = todays.map((t, i) => {
    const d = new Date(t.dueAt);
    const timeStr = d.toTimeString().slice(0, 5); // "HH:MM"
    const done = t.status === 'todo_done';
    const marker = done ? '✅' : '⏳';
    return `${i + 1}. ${marker} ${timeStr} — ${t.title}`;
  }).join('\n');

  return {
    said: `Bugungi rejang:\n${lines}`
  };
}

async function runSkillTodoMarkDone({ clean, lower, userId }) {
  // "montaj qilishni bajarildi deb belgilab qo'y"
  const m = clean.match(
    /(.+?)\s*(ni|ning)?\s*(bajarildi\s+deb\s+belgilab\s+qo['’]?y|bajarildi\s+deb\s+belgilab\s+qoy|bajarildi\s+deb\s+qoy|done\s+deb\s+belgilab\s+qo['’]?y|done\s+deb\s+qoy)/i
  );
  if (!m) return null;

  const namePart = m[1].trim();
  if (!namePart) {
    return { said: 'Qaysi vazifani bajarildi deb belgilashim kerak?' };
  }

  // Barcha TODO vazifalarni olamiz
  const all = await reminderFindManySafe();
  const candidates = all.filter(r => {
    if (r.channel !== 'todo') return false;
    if (r.status === 'todo_done') return false;
    if (userId && r.userId && r.userId !== userId) return false;
    return true;
  });

  if (!candidates.length) {
    return { said: 'Hozircha bajarilmagan vazifalar topilmadi.' };
  }

  const lowerName = namePart.toLowerCase();
  const tokens = lowerName
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2);

  let best = null;
  for (const r of candidates) {
    const titleLower = String(r.title || '').toLowerCase();
    if (!titleLower) continue;

    // To‘liq fraza bo‘yicha moslik
    if (titleLower.includes(lowerName) || lowerName.includes(titleLower)) {
      best = r;
      break;
    }

    // Kamida bitta "montaj" kabi so‘z mos kelsa
    if (tokens.some(t => titleLower.includes(t))) {
      best = r;
      break;
    }
  }

  if (!best) {
    return {
      said: `"${namePart}" ga o‘xshash vazifa topmadim. Iltimos, matnini aniqroq aytib ko‘r.`
    };
  }

  await reminderUpdateSafe({
    where: { id: best.id },
    data: { status: 'todo_done' }
  });

  return { said: `"${best.title}" vazifasini bajarildi deb belgiladim.` };
}

// ───────── Daily Briefing helper & skill ─────────
function getTodayRange(tz = DEFAULT_TZ) {
  const now = dayjs().tz(tz);
  const start = now.startOf('day').toDate();
  const end = now.endOf('day').toDate();
  return { start, end };
}

async function collectTodayTodos(userId) {
  const all = await reminderFindManySafe({});
  const { start, end } = getTodayRange(DEFAULT_TZ);

  return all
    .filter(r => {
      if (!r.dueAt) return false;
      const d = new Date(r.dueAt);
      if (d < start || d > end) return false;
      if (r.channel !== 'todo') return false;
      if (userId && r.userId && r.userId !== userId) return false;
      return true;
    })
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

async function collectTodayReminders(userId) {
  const all = await reminderFindManySafe({});
  const { start, end } = getTodayRange(DEFAULT_TZ);

  return all
    .filter(r => {
      if (!r.dueAt) return false;
      const d = new Date(r.dueAt);
      if (d < start || d > end) return false;
      if (r.channel === 'todo') return false;
      if (userId && r.userId && r.userId !== userId) return false;
      return true;
    })
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

async function buildDailyBriefing({ userId = 'unknown_user' } = {}) {
  const { start } = getTodayRange(DEFAULT_TZ);
  const dateStr = start.toLocaleDateString('uz-UZ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const todos = await collectTodayTodos(userId);
  const reminders = await collectTodayReminders(userId);

  // Qiziq faktni mavjud skil orqali olamiz
  const factOut = await runSkillInterestingFact({
    clean: 'qiziq fakt ayt',
    lower: 'qiziq fakt ayt',
    userId
  });
  const factText = factOut?.said || null;

  // Havo haqida hozircha stub (keyin API qo'shamiz)
  const weatherText = "Havo ma'lumotlari hali ulanmagan. Keyinroq real ob-havo qo'shamiz.";

  const todosText = todos.length
    ? todos.map((t, i) => {
      const d = new Date(t.dueAt);
      const timeStr = d.toTimeString().slice(0, 5);
      return `${i + 1}. ${timeStr} — ${t.title}`;
    }).join('\n')
    : "Bugungi to-do ro'yxatingda vazifa yo'q.";

  const remText = reminders.length
    ? reminders.map((r, i) => {
      const d = new Date(r.dueAt);
      const timeStr = d.toTimeString().slice(0, 5);
      return `${i + 1}. ${timeStr} — ${r.title}`;
    }).join('\n')
    : "Bugungi eslatmalar yo'q.";

  const moodQuestion = "Bugungi kayfiyating qanday? 😊";
  const whatDoQuestion = "Bugun nima qilmoqchisan?";

  let text = "";
  text += `Salom! Bugun ${dateStr}.\n\n`;
  text += "📝 Bugungi rejalaring:\n" + todosText + "\n\n";
  text += "🔔 Bugungi eslatmalar:\n" + remText + "\n\n";
  text += "🌤 Havo:\n" + weatherText + "\n\n";
  if (factText) {
    text += "🔍 Qiziqarli fakt:\n" + factText + "\n\n";
  }
  text += moodQuestion + "\n";
  text += whatDoQuestion + "\n";

  return {
    date: dateStr,
    todos,
    reminders,
    weatherText,
    factText,
    moodQuestion,
    whatDoQuestion,
    text,
  };
}

async function runSkillDailyBriefing({ userId }) {
  const b = await buildDailyBriefing({ userId });
  return { said: b.text };
}

// ───────── Other skills ─────────
async function runSkillReminderSimple({ lower }) {
  if (!/eslat|remind/i.test(lower)) return null;
  return { said: 'Eslatma tayyor (lokal). Kalendar navbatda.' };
}

async function runSkillInterestingFact({ clean, lower, userId }) {
  if (!/qiziq\s+fakt\s+ayt(?:\s+(.+))?|interesting\s+fact(?:\s+(.+))?/i.test(lower)) return null;
  const mUz = clean.match(/qiziq\s+fakt\s+ayt(?:\s+(.+))?/i);
  const mEn = clean.match(/interesting\s+fact(?:\s+(.+))?/i);
  const topic = (mUz?.[1] || mEn?.[1] || '').trim();
  let factText = null;
  if (topic) {
    factText = await wikiSummary(topic, 'uz') || await buildBriefAnswer(`interesting fact about ${topic}`);
  } else {
    factText = await randomWikiFact('uz') || await buildBriefAnswer('random interesting fact');
  }
  if (!factText) return { said: 'Uzr, hozir fakt topa olmadim.' };
  stSet(userId, 'last:factTopic', topic || 'general', 30 * 60 * 1000);
  return { said: factText };
}

async function runSkillFeedbackLike({ lower, userId }) {
  if (!(/^\s*\byoqdi\b\.?\s*$/i.test(lower) || /^\s*\blike\b\s*$/i.test(lower))) return null;
  const topic = stGet(userId, 'last:factTopic') || 'general';
  await factCreateSafe({
    userId,
    key: `feedback:${topic}`,
    value: 'like',
    type: 'feedback',
    time: new Date().toISOString(),
    rating: 1
  });
  stSet(userId, 'pref:facts', { liked: true, tags: [topic] }, 60 * 60 * 1000);
  return { said: `Qabul qilindi! "${topic}" mavzusi yoqqanini eslab qoldim.` };
}

async function runSkillFeedbackDislike({ lower, userId }) {
  if (!(/^\s*\byoqmadi\b\.?\s*$/i.test(lower) || /^\s*\bdislike\b\s*$/i.test(lower))) return null;
  const topic = stGet(userId, 'last:factTopic') || 'general';
  await factCreateSafe({
    userId,
    key: `feedback:${topic}`,
    value: 'dislike',
    type: 'feedback',
    time: new Date().toISOString(),
    rating: -1
  });
  stSet(userId, 'pref:facts', { liked: false, tags: [] }, 60 * 60 * 1000);
  return { said: `Tushunarli. Keyingi safar "${topic}" o‘rniga boshqa mavzuni tanlayman.` };
}

async function runSkillSearchQA({ clean, lower }) {
  const hasSearchTrigger =
    /\bhaqida\b/i.test(lower) || /\bqidir(ish|ib)?\b/i.test(lower) || /\bsearch\b/i.test(lower) ||
    /\bwho\b/i.test(lower) || /\bwhen\b/i.test(lower) || /\bwhere\b/i.test(lower) ||
    /\bwhat\b/i.test(lower) || /\babout\b/i.test(lower) || /\bfind\b/i.test(lower) ||
    /\bkim\b/i.test(lower) || /\bnima\b/i.test(lower) || /\bqachon\b/i.test(lower) ||
    /\bqayerda\b/i.test(lower) || /\bqancha\b/i.test(lower) || /\bma(?:'|')nosi\b/i.test(lower) ||
    /\bizla\b/i.test(lower) || /\bgoogle\b/i.test(lower);

  if (hasSearchTrigger) {
    const refined = clean
      .replace(/\bqidir(ish|ib)?\b/gi, ' ')
      .replace(/\bhaqida\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const query = refined || clean;
    const brief = await buildBriefAnswer(query);

    // Junk filter — same as before
    const isJunk = !brief
      || brief.trim().length < 40
      || (brief.match(/\.\.\./g) || []).length >= 3
      || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i.test(brief.trim())
      || /^\d{1,2}\s+(yan|fev|mar|apr|may|iyn|iyl|avg|sen|okt|noy|dek)/i.test(brief.trim());

    if (isJunk) {
      console.warn(`[search.qa] junk detected for query="${query}", falling through to brain.llm`);
      return null;
    }

    // ✅ KEY CHANGE: never return raw snippet — synthesize via LLM
    console.log(`[search.qa] snippet found for "${query}", synthesizing via LLM...`);

    try {
      const synthesis = await openai.chat.completions.create(
        {
          model: process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini',
          temperature: 0.5,
          messages: [
            {
              role: 'system',
              content: `Sen SHERZ — do'stona, aqlli, qisqa javob beradigan AI yordamchisan.
Sana quyida veb-qidiruv natijasi beriladi. Undan foydalanib, foydalanuvchiga natural, insoniy, va aniq javob ber.
QOIDALAR:
- Hech qachon xom snippet'ni copy-paste qilma
- TikTok, Twitter, Instagram kabi ijtimoiy tarmoq izlarini tilga olma
- Faqat real, foydali faktlarni ajrat
- Javob 2-4 jumladan iborat bo'lsin
- O'zbek yoki ingliz tilida, foydalanuvchi qaysi tilda yozgan bo'lsa shunda javob ber`,
            },
            {
              role: 'user',
              content: `Savol: "${query}"\n\nQidiruv natijasi:\n${brief}\n\nShu ma'lumotga asoslanib, qisqa va tabiiy javob ber.`,
            },
          ],
        },
        { timeout: 12000, maxRetries: 1 }
      );

      const synthesized = synthesis.choices[0]?.message?.content?.trim();

      if (!synthesized || synthesized.length < 10) {
        console.warn('[search.qa] LLM synthesis returned empty, falling through to brain.llm');
        return null;
      }

      console.log(`[search.qa] synthesis done: "${synthesized.slice(0, 80)}..."`);
      return { said: synthesized };

    } catch (err) {
      // If synthesis LLM call times out or fails, fall through to brain.llm
      console.warn('[search.qa] synthesis LLM failed, falling through to brain.llm:', err?.message);
      return null;
    }
  }

  const onlyGreeting = /\b(salom|assalomu alaykum|assalomu|salomlar|rahmat|ok|ha)\b/i.test(lower);
  const looksQuestion =
    /[?]/.test(clean) ||
    /\b(kim|nima|qachon|qayer|qancha|nega|nimaga|qanday|ma(?:'|')nosi|what|who|when|where|why|how|meaning)\b/i.test(lower);

  if (!onlyGreeting && looksQuestion) {
    const brief = await buildBriefAnswer(clean);
    if (brief) return { said: brief };
  }

  return null;
}

function runSkillGreeting() { return { said: 'Salom, qanday yordam bera olaman?' }; }

// ── Shared: skill-candidate matching (used by /handle-intent and /api/chat-stream) ──
// Pure extraction from /handle-intent — logic is byte-for-byte identical to
// before, just made callable from more than one route.
async function runSkillCandidates(clean, lower, userId) {
  const candidates = [
    // Odat skil
    { name: 'habit',            test: () => !!parseHabitSentence(clean),                           run: () => runSkillHabit({ clean, userId }) },

    // Context Memory / profilga yozish
    {
  name: 'profile.set',
  test: () =>
    /yoqtirgan\s+taomim/i.test(lower) ||
    /yoqtirgan\s+musiqa(m)?/i.test(lower) ||         // ← MUSIQA TRIGGER
    /uyg[oʼo'’]nish\s+vaqtim/i.test(lower) ||
    /ish\s+(jadvalim|grafigim)/i.test(lower) ||
    /menga\s+.+\s+yoqadi\b/i.test(lower) ||
    /menga\s+.+\s+yoqmaydi\b/i.test(lower) ||
    /qiziqaman\b/i.test(lower),

  run: () => runSkillProfileSet({ clean, lower, userId }),
},


    // Profilni ko'rsatish
    {
      name: 'profile.show',
      test: () =>
        /profilimni\s+ko['’]?rsat/i.test(lower) ||
        /\bprofilim\b/i.test(lower) ||
        /context\s+memory/i.test(lower) ||
        /uzoq\s+muddatli\s+xotira/i.test(lower),
      run: () => runSkillProfileShow({ userId })
    },

    // Eslab qolish / faktlar
    { name: 'remember',         test: () => /(?:^|\b)(?:eslab\s*qol|remember)\b/i.test(lower),     run: () => runSkillRemember({ clean, lower, userId }) },
    { name: 'facts.list',       test: () => /nimalarni\s+bilasan|men\s+haqimda/i.test(lower),      run: () => runSkillFactsList({ lower, userId }) },

    // To-do / reja skil-lari
    {
      name: 'todo.markDone',
      test: () => /(bajarildi\s+deb\s+belgilab\s+qo['’]y|bajarildi\s+deb\s+belgilab\s+qoy|bajarildi\s+deb\s+qoy|done\s+deb\s+belgilab\s+qo['’]y|done\s+deb\s+qoy)/i.test(lower),
      run: () => runSkillTodoMarkDone({ clean, lower, userId })
    },
    {
      name: 'todo.listToday',
      test: () => /(bugungi\s+reja|bugungi\s+plan|bugungi\s+rejani\s+ko['’]rsat|bugungi\s+rejam|bugungi\s+planim)/i.test(lower),
      run: () => runSkillTodoListToday({ userId })
    },
    { name: 'todo.create',      test: () => !!parseTodoSentence(clean),                           run: () => runSkillTodoCreate({ clean, lower, userId }) },

    // Jurnal
    {
      name: 'journal.save',
      // ✅ FIX: only trigger when user explicitly wants to save — not on plain "kayfiyat" mentions
      test: () => /(bugungi\s+kunim\b|jurnalga\s+yoz|kundaligimga\s+yoz)/i.test(lower),
      run: () => runSkillJournalSave({ clean, lower, userId })
    },
    {
      name: 'journal.summary',
      // ✅ FIX: require explicit "show journal" intent — not just the word "jurnal"
      test: () => /jurnal(ni)?\s+ko['']rsat|kunlik\s+jurnal|hafta\s+jurnal|oxirgi\s+7\s+kun/i.test(lower),
      run: () => runSkillJournalSummary({ lower, userId })
    },

    // Daily briefing
    {
      name: 'daily.briefing',
      test: () => /kunlik\s+sharh|daily\s+briefing|bugungi\s+sharh/i.test(lower),
      run: () => runSkillDailyBriefing({ userId })
    },

    // Boshqa skill-lar
    { name: 'reminder.simple',  test: () => /eslat|remind/i.test(lower),                           run: () => runSkillReminderSimple({ lower }) },
    { name: 'fact.random',      test: () => /qiziq\s+fakt\s+ayt|interesting\s+fact/i.test(lower),  run: () => runSkillInterestingFact({ clean, lower, userId }) },
    {
      name: 'feedback.like',
      test: () => /^\s*\byoqdi\b\.?\s*$/i.test(lower) || /^\s*\blike\b\s*$/i.test(lower),
      run: () => runSkillFeedbackLike({ lower, userId })
    },
    {
      name: 'feedback.dislike',
      test: () => /^\s*\byoqmadi\b\.?\s*$/i.test(lower) || /^\s*\bdislike\b\s*$/i.test(lower),
      run: () => runSkillFeedbackDislike({ lower, userId })
    },

    // search.qa: tries wiki + web search for explicit search queries.
    // Returns null for plain conversation — brain.llm handles those below.
    { name: 'search.qa', test: () => true, run: () => runSkillSearchQA({ clean, lower }) },
  ].sort((a, b) => skillScore(b.name) - skillScore(a.name));

  for (const c of candidates) {
    try {
      if (!c.test()) continue;
      const out = await c.run();
      if (out && out.said) {
        learnSkillHit(c.name, true);
        await logSkillFact(userId, c.name, true);
        return { said: out.said, skillName: c.name };
      } else {
        learnSkillHit(c.name, false);
        await logSkillFact(userId, c.name, false);
      }
    } catch (e) {
      console.error(`skill ${c.name} error:`, e);
      learnSkillHit(c.name, false);
      await logSkillFact(userId, c.name, false);
    }
  }
  return null; // no skill matched — caller falls through to brain.llm
}

// ── Shared: LLM brain fallback flow (used by /handle-intent and /api/chat-stream) ──
// Pure extraction from /handle-intent's brain.llm block — same history load,
// same runBrain call, same persistence, same memory extraction, same error
// fallback strings. Accepts an optional onToken callback; when provided,
// runBrain streams real OpenAI tokens through it as they arrive.
async function runBrainFlow(userId, clean, image, { onToken } = {}) {
  console.log(`[brain.llm] No specialist matched for userId=${userId}, routing to GPT brain`);
  try {
    // Load last 20 messages from DB for context window
    let history = [];
    try {
      const dbMessages = await prisma.message.findMany({
        where:   { userId },
        orderBy: { createdAt: 'asc' },
        take:    20,
      });
      history = dbMessages.map(m => ({ role: m.role, content: String(m.content || m.text || '') })).filter(m => m.content);
    } catch (histErr) {
      console.warn('[brain.llm] history load failed (non-fatal):', histErr.message);
    }

    const messages = [
      ...history,
      { role: 'user', content: clean },
    ];

    const brainResult = await runBrain({ userId, messages, prisma, image: image ?? null, onToken });

    const said = brainResult?.content || brainResult?.said || null;
    if (!said) {
      console.error('[brain.llm] runBrain returned empty content:', JSON.stringify(brainResult));
      return { said: 'Hmm, bir oz qiyin bo\'ldi. Iltimos qayta urinib ko\'ring.' };
    }

    try {
      await prisma.message.create({ data: { userId, role: 'user',      content: clean } });
      await prisma.message.create({ data: { userId, role: 'assistant', content: said  } });
    } catch (saveErr) {
      console.warn('[brain.llm] message save failed (non-fatal):', saveErr.message);
    }

    processUserMemory(userId, clean).catch(() => {});

    learnSkillHit('brain.llm', true);
    await logSkillFact(userId, 'brain.llm', true);
    return { said };

  } catch (brainErr) {
    console.error('[brain.llm] runBrain threw:', brainErr);
    learnSkillHit('brain.llm', false);
    await logSkillFact(userId, 'brain.llm', false);
    return { said: 'Kechirasiz, hozir javob bera olmayapman. Iltimos bir oz kutib qayta urinib ko\'ring.' };
  }
}

// Legacy & new: birlashtirilgan /handle-intent
app.post('/handle-intent', async (req, res) => {
  const { text = '' } = req.body || {};
  const userId = req.user?.id && req.user.id !== 'anonymous' ? req.user.id : (isProd ? 'anonymous' : 'u1'); // ✅ dev fallback
  const clean = text.trim();
  const lower = clean.toLowerCase();

  if (!clean) return res.json({ ok: true, said: runSkillGreeting().said });

  const skillResult = await runSkillCandidates(clean, lower, userId);
  if (skillResult) {
    return res.json({ ok: true, said: skillResult.said });
  }

  // ── brain.llm: true LLM fallback — runs when NO specialist skill matched ──
  // This is the SHERZ GPT-4 brain. It has full memory context and emotion
  // awareness. It runs for all conversational input that specialists don't handle.
  const { said } = await runBrainFlow(userId, clean, req.body?.image);
  return res.json({ ok: true, said });
});

// Moslik uchun /api/ask → /handle-intent
// ── /api/chat alias: script.js calls this; proxies to /handle-intent ─────────
app.post('/api/chat', async (req, res) => {
  try {
    // Extract text from both naming conventions used by the frontend
    const text = String(req.body?.message || req.body?.text || '').trim();
    const userId = req.user?.id || req.body?.userId || 'u1';
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // ✅ Direct in-process call — was previously a self-fetch to
    // http://localhost:${PORT}/handle-intent, which is a fragile pattern to
    // carry into a hosted deployment. Uses the exact same shared logic
    // /handle-intent uses (runSkillCandidates/runBrainFlow), so behavior is
    // unchanged — just no internal HTTP hop.
    let said;
    if (!clean) {
      said = runSkillGreeting().said;
    } else {
      const skillResult = await runSkillCandidates(clean, lower, userId);
      said = skillResult ? skillResult.said : (await runBrainFlow(userId, clean, req.body?.image)).said;
    }

    return res.json({ ok: true, reply: said, said });
  } catch (e) {
    console.error('/api/chat error:', e);
    res.status(500).json({ ok: false, error: 'chat failed' });
  }
});

// ── /api/chat-stream: real SSE token streaming ─────────
// Reuses the exact same runSkillCandidates/runBrainFlow that /handle-intent
// uses, so tone engine, facts, and memory logic are byte-for-byte identical
// to the non-streaming path — this endpoint only changes HOW the final text
// reaches the client, not how it's produced.
app.post('/api/chat-stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) { /* client likely disconnected — ignore */ }
  };

  let closed = false;
  req.on('close', () => { closed = true; });

  const keepAlive = setInterval(() => { if (!closed) send('ping', {}); }, 15000);

  try {
    const text = String(req.body?.message || req.body?.text || '').trim();
    const userId = req.user?.id && req.user.id !== 'anonymous'
      ? req.user.id
      : (isProd ? 'anonymous' : (req.body?.userId || 'u1'));
    const clean = text.trim();
    const lower = clean.toLowerCase();

    if (!clean) {
      const said = runSkillGreeting().said;
      send('chunk', { delta: said });
      send('done', { text: said });
      return res.end();
    }

    const skillResult = await runSkillCandidates(clean, lower, userId);
    if (skillResult) {
      send('chunk', { delta: skillResult.said });
      send('done', { text: skillResult.said });
      return res.end();
    }

    const { said } = await runBrainFlow(userId, clean, req.body?.image, {
      onToken: (delta) => { if (!closed) send('chunk', { delta }); },
    });

    if (!closed) send('done', { text: said });

  } catch (e) {
    console.error('/api/chat-stream error:', e);
    if (!closed) send('error', { error: e.message || 'stream failed' });
  } finally {
    clearInterval(keepAlive);
    if (!closed) { try { res.end(); } catch (e) {} }
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const text = String(req.body?.text || req.body?.message || '').trim();
    const userId = req.user?.id || req.body?.userId || 'u1';
    const clean = text.trim();
    const lower = clean.toLowerCase();

    let said;
    if (!clean) {
      said = runSkillGreeting().said;
    } else {
      const skillResult = await runSkillCandidates(clean, lower, userId);
      said = skillResult ? skillResult.said : (await runBrainFlow(userId, clean, req.body?.image)).said;
    }

    res.json({ ok: true, said });
  } catch (e) {
    console.error('/api/ask error:', e);
    res.status(500).json({ ok: false, error: 'ask failed' });
  }
});

// STT ping
app.get('/api/stt/ping', (_req, res) => {
  const ready = !!process.env.OPENAI_API_KEY;
  res.json({ ok: true, provider: ready ? 'openai-whisper' : 'none', ready });
});

// STT endpoint (OpenAI Whisper)
app.post('/api/stt', upload.single('file'), async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
    if (!OPENAI_API_KEY) return res.status(501).json({ ok: false, error: 'STT disabled (OPENAI_API_KEY yo‘q)' });

    const lang = (req.body?.lang || 'uz').toString().slice(0, 5);
    let fileBuf = null, mime = null, filename = null;

    if (req.file?.buffer) {
      fileBuf = req.file.buffer;
      mime = req.file.mimetype || 'audio/webm';
      filename = req.file.originalname || `audio.${mime.split('/')[1] || 'webm'}`;
    } else if (req.body?.audio) {
      const m = String(req.body.audio).match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i);
      if (!m) return res.status(400).json({ ok: false, error: 'audio (base64 data URL) noto‘g‘ri format' });
      mime = m[1];
      fileBuf = Buffer.from(m[2], 'base64');
      filename = `audio.${(mime.split('/')[1] || 'webm')}`;
    } else {
      return res.status(400).json({ ok: false, error: 'Fayl topilmadi: multipart "file" yoki JSON "audio" kerak' });
    }

    const fd = new FormData();
    const blob = new Blob([fileBuf], { type: mime || 'application/octet-stream' });
    fd.append('file', blob, filename);
    fd.append('model', 'whisper-1');
    fd.append('language', lang);

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd
    });
    const j = await r.json();
    if (!r.ok) {
      console.error('Whisper error:', j);
      return res.status(r.status).json({ ok: false, error: j.error?.message || 'whisper failed' });
    }

    return res.json({ ok: true, text: (j?.text || '').trim(), lang });
  } catch (e) {
    console.error('STT error:', e);
    res.status(500).json({ ok: false, error: 'stt failed' });
  }
});

// ───────── Search diagnostics & manual endpoint ─────────
app.get('/api/search/diag', (_req, res) => {
  res.json({
    providers: {
      google_cse: !!(CSE_KEY && CSE_CX),
      serpapi: !!SERPAPI_KEY,
    },
    env: {
      GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
      GOOGLE_CSE_ID: !!process.env.GOOGLE_CSE_ID,
      SERPAPI_KEY: !!process.env.SERPAPI_KEY,
    }
  });
});

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    const { provider, items } = await webSearch(q, 5);
    res.json({ provider, count: items.length, items });
  } catch (e) {
    console.error('search endpoint error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ───────── Daily Briefing API ─────────
app.get('/api/daily-briefing', async (req, res) => {
  try {
    const userId = req.user.id; // ✅ from JWT
    const briefing = await buildDailyBriefing({ userId });
    res.json({ ok: true, briefing });
  } catch (e) {
    console.error('daily-briefing error:', e);
    res.status(500).json({ ok: false, error: 'daily briefing failed' });
  }
});

// MVP custom endpoints (agar bo‘lsa)
registerMvpEndpoints(app, prisma);

// ✅ SSE stream route (proactive realtime uchun)
streamRoute(app);
memoryRoute(app, prisma);

// ───────── Static ─────────
app.use(express.static(path.join(__dirname, 'public')));

// 🔧 DEBUG: skill'ni to'g'ridan-to'g'ri test qilish uchun endpoint
app.post('/debug/run-skill', async (req, res) => {
  try {
    const { userId = req.user?.id || 'debug_user', name, args = {} } = req.body || {}; // ✅ prefer JWT

    if (!name) {
      return res.status(400).json({ ok: false, error: 'MISSING_SKILL_NAME' });
    }

    const result = await runSkill({
      userId,
      name,
      args,
      prisma,
    });

    res.json(result);
  } catch (err) {
    console.error('❌ /debug/run-skill error:', err);
    res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', details: String(err.message || err) });
  }
});

// ───────── CRON (reminder trigger) ─────────
let stopCron = null;
function startCron() {
  const task = cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const due = await reminderFindManySafe({ where: { status: 'scheduled', dueAt: { lte: now } } });
      for (const r of due) {
        console.log(`🔔 Reminder fired: ${r.title} (${r.id}) ${new Date(r.dueAt).toISOString()}`);
        await reminderUpdateSafe({ where: { id: r.id }, data: { status: 'fired' } });

        if (r.rrule) {
          const next = nextFromRRule(r.rrule, new Date(r.dueAt), r.timezone || DEFAULT_TZ);
          if (next) {
            await reminderUpdateSafe({ where: { id: r.id }, data: { dueAt: next, status: 'scheduled' } });
            console.log(`↻ Rescheduled via RRULE to: ${next.toISOString()}`);
          }
        }

        if ((r.channel === 'habit') || /habit:daily/i.test(r.notes || '')) {
          const next = new Date(r.dueAt);
          next.setDate(next.getDate() + 1);
          await reminderCreateSafe({ title: r.title, notes: r.notes, channel: r.channel, dueAt: next });
          console.log(`↻ Rescheduled habit for next day: ${next.toISOString()}`);
        }
      }
    } catch (e) { console.error('cron error', e); }
  });
  stopCron = () => task.stop();
}

// 🔍 DEBUG: Memory NLU + Fact saqlashni test qilish
app.get('/debug/memory-save-demo', async (req, res) => {
  try {
    const user = await prisma.user.upsert({
      where: { id: 'DEBUG_MEMORY_USER' },
      update: {},
      create: {
        id: 'DEBUG_MEMORY_USER',
        name: 'Debug Memory User',
      },
    });

    const text =
      "Mening eng sevimli taomim osh. Odatda ertalab 7:30 da uyg'onaman va latte ichishni yoqtiraman.";

    const nlu = await runNluForMemory(text);
    await saveMemoryFactsForUser(prisma, user.id, nlu.facts);

    return res.json({
      ok: true,
      user: user.id,
      extractedFacts: nlu.facts,
    });
  } catch (err) {
    console.error('debug/memory-save-demo error:', err);
    res.status(500).json({ ok: false, error: 'memory demo failed' });
  }
});

startCron();

// ───────── SIMPLE TODO API (frontend uchun) ─────────

// Todo qo‘shish
app.post('/api/todo', async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user.id; // ✅ from JWT

    if (!text || !String(text).trim()) {
      return res
        .status(400)
        .json({ ok: false, error: 'text is required' });
    }

    const todo = await addTodo(prisma, userId.toString(), text.toString());

    return res.json({ ok: true, todo });
  } catch (e) {
    console.error('TODO create error:', e);
    return res
      .status(500)
      .json({ ok: false, error: 'todo_create_failed' });
  }
});

// Todo ro‘yxatini olish
app.get('/api/todos', async (req, res) => {
  try {
    const userId = req.user.id; // ✅ from JWT — ignore any ?userId= param

    const todos = await listTodos(prisma, userId, {
      includeDone: false,
      limit: 50,
    });

    return res.json({ ok: true, todos });
  } catch (e) {
    console.error('TODO list error:', e);
    return res
      .status(500)
      .json({ ok: false, error: 'todo_list_failed' });
  }
});

// ───────── 404 & error handler ─────────
app.use(notFound);
app.use(errorHandler);

// ───────── Start ─────────
// -------- Start --------
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await prisma.$connect();
  } catch (err) {
    console.warn('Prisma connect warning:', err?.message || err);
  } finally {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `SHERZ server running: http://localhost:${PORT} (${isProd ? 'prod' : 'dev'})`
      );

      startProactiveRunner({
        prisma,
        timezone: DEFAULT_TZ, // 'Asia/Tashkent'
      });
    });
  }
})();


// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    if (stopCron) stopCron();
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
});
process.on('SIGTERM', async () => {
  try {
    if (stopCron) stopCron();
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
});