// lib/greeting.js — a fresh, curious opening line for an EMPTY chat (replaces the fixed INTROS list in the browser).
//
// What it uses (all optional, all read-only; a missing table or a guest user just means less context):
//   • the time of day + weekday in the user's own time zone
//   • how long since they last wrote, and a short hint of what that last message was about
//   • their preferred name and at most a few remembered facts (used only if natural, never sensitive topics)
//   • the Curiosity Layer (proactive/curiosity.js): a flavor — philosophical / technical / light personal / observation / wonder —
//     or a gentle "support" opening when the latest emotion log says they are stressed
//   • the last few greetings it already gave this user, so it never repeats or paraphrases itself
// Safety nets: cached for a short moment (a reload does not burn a call), rate-limited per user, hard timeout,
// and ANY failure returns { source:'fallback' } so the page shows its built-in line instead of an error.
import { buildCuriosity, pickFlavor, CURIOSITY_FLAVORS } from '../proactive/curiosity.js';

export const GREETING_LIMITS = Object.freeze({ cacheMs: 20_000, perHour: 12, timeoutMs: 6_000, maxChars: 240, maxLines: 3, recent: 6 });

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function periodOf(hour) {
  const h = Number(hour);
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'late night';
}

/** { hour, weekday } for `now` in `tz` (falls back to the server's zone when `tz` is not a valid IANA name) */
export function localParts(now = new Date(), tz = '') {
  let zone; try { if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); zone = String(tz); } } catch { zone = undefined; }   // invalid or empty zone → the server's own zone
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hour12: false, weekday: 'long' });
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour) % 24, weekday: parts.weekday, tz: zone || null };
}

const STOCK = /(how can i (help|assist)|is there anything|i'?m here to help|yordam bera olaman|sizga qanday yordam|чем могу помочь)/i;

/** model text → one safe, short line block, or null when it is unusable */
export function cleanGreeting(raw, { maxChars = GREETING_LIMITS.maxChars, maxLines = GREETING_LIMITS.maxLines } = {}) {
  let t = String(raw ?? '').replace(/\r/g, '').trim();
  t = t.replace(/^```[a-z]*\n?|```$/gi, '').trim();
  t = t.replace(/^(sherz|assistant|ai)\s*[:\-–—]\s*/i, '');
  t = t.replace(/[*_`#>]+/g, '');                                   // no markdown in a greeting bubble
  t = t.replace(/^["“”«'‘]+|["“”»'’]+$/g, '').trim();
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, maxLines);
  t = lines.join('\n');
  if (t.length > maxChars) { t = t.slice(0, maxChars); t = t.replace(/[\s,;:–—-]+\S*$/, '').trim(); if (!/[.!?…]$/.test(t)) t += '…'; }
  if (t.length < 3 || STOCK.test(t)) return null;
  return t;
}

const SUPPORT_DIRECTIVE = 'The user may be having a hard time. Open gently and briefly: calm, warm, no jokes, no probing questions, no advice. One simple sentence that says you are here and they can talk or just be quiet. At most one soft, optional question.';
const CHECKIN_DIRECTIVE = 'Open warmly and plainly, like a peer who is glad to see them. One easy, optional question about what they feel like doing right now (talk, work, or just hang out). Do not use stock phrases.';

export function buildGreetingPrompt({ now, tz, hour, weekday, name = null, gapHours = null, lastHint = null, facts = [], intent, curiosity = null, avoid = [] }) {
  const period = periodOf(hour);
  const directive = intent === 'curiosity' && curiosity ? curiosity.directive : intent === 'support' ? SUPPORT_DIRECTIVE : CHECKIN_DIRECTIVE;
  const ctx = [
    `Local time for the user: ${weekday}, ${String(hour).padStart(2, '0')}:00 (${period})${tz ? `, zone ${tz}` : ''}.`,
    name ? `Their name: ${name} (use it at most once, and only if it feels natural).` : 'You do not know their name; do not invent one.',
    gapHours == null ? 'This looks like their first chat, or you have no earlier messages.' : gapHours < 1 ? 'They wrote to you less than an hour ago.' : gapHours < 36 ? `They last wrote about ${Math.round(gapHours)} hour(s) ago.` : `They have been away for about ${Math.round(gapHours / 24)} day(s).`,
    lastHint ? `What their last message was about (their words, shortened): "${lastHint}"` : null,
    facts.length ? `A few things you remember about them (use at most one, only if it fits; never health, money, relationships, politics or religion; never state it as certain): ${facts.join(' | ')}` : null,
  ].filter(Boolean).join('\n');
  const system = [
    'You are SHERZ, an AI companion with a real voice and your own curiosity. You are writing the very first message of an empty chat, before the user has typed anything.',
    'Write ONE short opening: 1 to 3 short lines, at most 220 characters in total, at most one emoji, no markdown, no quotes around it, no label like "SHERZ:".',
    'Language and script: the same as the user\'s last message if one is shown; otherwise Uzbek in Latin script.',
    'It must sound different from a template: let the time of day or the day of the week shape it when that is natural (do not announce the time like a clock).',
    'Be honest that you are an AI; never claim human experiences. Do not invent facts about the user; use only what is given below.',
    'Output only the message text.',
  ].join('\n');
  const user = [
    ctx, '',
    directive,
    avoid.length ? `\nYou already opened with these recently. Do not repeat or paraphrase them, and pick a different angle:\n${avoid.map((a, i) => `${i + 1}. ${clip(a, 140)}`).join('\n')}` : '',
  ].join('\n').trim();
  return { system, user, period };
}

/** the line the page shows when the server cannot produce one (kept in sync with the browser's own offline list) */
export function fallbackGreeting({ hour }) {
  const g = periodOf(hour) === 'morning' ? 'Hayrli tong' : periodOf(hour) === 'afternoon' ? 'Salom' : 'Xayrli kech';
  return `${g}.\nMen shu yerdaman. Xohlasang shunchaki gaplashamiz, xohlasang ish qilamiz.`;
}

export function createGreetingService({ openai, prisma = null, model = null, now = () => new Date(), random = Math.random, limits = {} } = {}) {
  const L = { ...GREETING_LIMITS, ...limits };
  const recentText = new Map();     // userId → last greetings (anti-repeat)
  const recentFlavor = new Map();   // userId → last flavors
  const cache = new Map();          // userId → { at, out }
  const calls = new Map();          // userId → timestamps (hour window)

  const push = (m, k, v) => { const a = m.get(k) || []; a.push(v); while (a.length > L.recent) a.shift(); m.set(k, a); };

  async function context(userId, nowDate) {
    const c = { name: null, gapHours: null, lastHint: null, facts: [], stressed: false, lang: null };
    if (!prisma || !userId) return c;
    const safe = async (fn) => { try { return await fn(); } catch { return null; } };
    const prof = await safe(() => prisma.userProfile?.findUnique({ where: { userId } }));
    c.name = clip(prof?.preferredName || prof?.displayName || '', 40) || null;
    const last = await safe(() => prisma.message?.findFirst({ where: { userId, role: 'user' }, orderBy: { createdAt: 'desc' }, select: { text: true, createdAt: true } }));
    if (last?.createdAt) { c.gapHours = Math.max(0, (nowDate - new Date(last.createdAt)) / 3.6e6); c.lastHint = clip(last.text, 110) || null; }
    const facts = await safe(() => prisma.fact?.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 5, select: { key: true, value: true } }));
    c.facts = (facts || []).map((f) => clip(`${f.key}: ${f.value}`, 90)).filter(Boolean).slice(0, 4);
    const emo = await safe(() => prisma.emotionLog?.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { score: true, createdAt: true } }));
    c.stressed = !!emo && nowDate - new Date(emo.createdAt) < 36 * 3.6e6 && Number(emo.score) <= -2;
    return c;
  }

  /** → { ok, text, source:'ai'|'fallback'|'cache', intent?, flavor? } — never throws */
  async function get({ userId, tz = '', force = false } = {}) {
    const t0 = now(); const lp = localParts(t0, tz);
    const fb = (why) => ({ ok: true, text: fallbackGreeting(lp), source: 'fallback', why });
    try {
      if (!openai?.chat?.completions?.create) return fb('no model');
      const key = String(userId || 'anon');
      const hit = cache.get(key);
      if (!force && hit && t0 - hit.at < L.cacheMs) return { ...hit.out, source: 'cache' };
      const win = (calls.get(key) || []).filter((x) => t0 - x < 3.6e6);
      if (win.length >= L.perHour) return fb('rate limit');
      win.push(+t0); calls.set(key, win);

      const c = await context(key === 'anon' ? null : key, t0);
      const avoidFlavors = recentFlavor.get(key) || [];
      const { intent, curiosity } = buildCuriosity({ emotion: { stressFlag: c.stressed }, config: { curiosityRate: 0.85 }, random, avoid: avoidFlavors });
      const p = buildGreetingPrompt({ now: t0, tz: lp.tz, hour: lp.hour, weekday: lp.weekday, name: c.name, gapHours: c.gapHours, lastHint: c.lastHint, facts: c.facts, intent, curiosity, avoid: recentText.get(key) || [] });

      let timer; const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('greeting timeout')), L.timeoutMs); });
      let r;
      try {
        r = await Promise.race([
          openai.chat.completions.create({ model: model || process.env.SHERZ_GREETING_MODEL || process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini', temperature: 1, max_tokens: 90, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }] }),
          timeout,
        ]);
      } finally { clearTimeout(timer); }
      const text = cleanGreeting(r?.choices?.[0]?.message?.content);
      if (!text) return fb('unusable model output');
      const out = { ok: true, text, source: 'ai', intent, flavor: curiosity?.flavor || null };
      push(recentText, key, text); if (curiosity?.flavor) push(recentFlavor, key, curiosity.flavor);
      cache.set(key, { at: +t0, out });
      return out;
    } catch (e) {
      return fb(String(e?.message || e).slice(0, 80));
    }
  }

  return { get, _state: { recentText, recentFlavor, cache, calls } };
}

export { pickFlavor, CURIOSITY_FLAVORS };
