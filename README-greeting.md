# SHERZ — a fresh, curious greeting for an empty chat

The fixed `INTROS` list in `public/index.html` is no longer what the user sees. When a chat is empty, the page asks the server for **one opening line written for this moment**. The old list stays only as an **offline fallback** (model down, no network, slow answer).

## What the greeting is built from  (`lib/greeting.js`)
- **Time of day and weekday in the user's own zone** (the browser sends its time zone). It shapes the line; it does not read the clock out loud.
- **How long since they last wrote** and a short hint of **what the last message was about**.
- **Their preferred name** (at most once) and **up to a few remembered facts** — used only if natural, never health, money, relationships, politics or religion, never stated as certain.
- **The Curiosity Layer** (`proactive/curiosity.js`): a flavor — philosophical, technical, light personal, observation, wonder — rotating so it does not repeat. If the latest emotion log (last 36 h) says the user is stressed, it switches to a **gentle support opening** (calm, no jokes, no probing).
- **The last 6 greetings it gave this user**, which it must not repeat or paraphrase.
- Rules from the persona: honest that it is an AI, no invented facts, at most one question, no stock service phrases, same language/script as the user's last message (Uzbek Latin by default).

## Safety nets
- A reload within 20 s reuses the same greeting (no extra model call). `?fresh=1` forces a new one.
- Max 12 model calls per user per hour; a hard 6 s server timeout; the page itself gives up after 7 s.
- Any problem (error, timeout, empty or "How can I help you?"-style output, rate limit, no API key) → `source:'fallback'` → the page shows its built-in line. **No error is ever shown to the user**, and a model problem never returns a 5xx.
- Output is cleaned: plain text, ≤ 3 lines, ≤ 240 characters, no markdown, no quotes or "SHERZ:" label.
- Owner-scoped (uses the logged-in user's id only). Guests work too, with less context.
- Model: `SHERZ_GREETING_MODEL`, else `SHERZ_BRAIN_MODEL`, else `gpt-4.1-mini`. Roughly 150–250 tokens in, ≤ 90 out per greeting.

## Files in this ZIP
NEW: `lib/greeting.js`, `routes/greeting.js`, `tests/greeting.test.mjs`, `tests/fe/greeting.e2e.test.mjs`, `README-greeting.md`
CHANGED: `public/index.html` (full file; or use patch 2 below)
**Not included: `server.js`** — apply patch 1 (two imports and one line), so I never overwrite your own edits.

Tests: full suite 290 passing (281 + 9); browser check 10 passed (fresh greeting shown, new one each time, time zone + login sent, model error / empty / 9 s slow → built-in line, chat with history never asks).

---
## Patch 1 — `server.js` (3 small edits)

1) SEARCH
```js
import { filesRouter } from './routes/files.js';        // ✅ Excel/Word files (Phase 5)
```
REPLACE
```js
import { filesRouter } from './routes/files.js';        // ✅ Excel/Word files (Phase 5)
import { greetingRouter } from './routes/greeting.js';   // ✅ fresh, curious opening line for an empty chat
import { createGreetingService } from './lib/greeting.js';
```

2) SEARCH
```js
app.use('/api/files', filesRouter({ isProd, ensureUser: ensureGuestUser }));   // Phase 5
```
REPLACE
```js
app.use('/api/files', filesRouter({ isProd, ensureUser: ensureGuestUser }));   // Phase 5
app.use('/api/greeting', greetingRouter({ isProd, ensureUser: ensureGuestUser, service: createGreetingService({ openai, prisma }) }));   // fresh opening line for an empty chat
```
(`openai` and `prisma` already exist in your `server.js`. Mount it where `/api/files` is, so it sits behind the same login guard.)

## Patch 2 — `public/index.html` (2 edits)

1) SEARCH
```js
    async function runIntroIfEmpty(){
```
REPLACE
```js
    async function fetchFreshIntro(){
      const ctl = new AbortController(), timer = setTimeout(()=>ctl.abort(), 7000);
      try {
        let tz = ''; try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){}
        const r = await fetchWithAuth(apiUrl('/api/greeting?tz=' + encodeURIComponent(tz)), { signal: ctl.signal });
        if (!r.ok) return null;
        const j = await r.json().catch(()=>null);
        return j && j.ok && j.source !== 'fallback' && typeof j.text === 'string' && j.text.trim().length > 2 ? j.text.trim() : null;
      } catch (e) { return null; } finally { clearTimeout(timer); }
    }
    async function runIntroIfEmpty(){
```

2) SEARCH
```js
      const introText = INTROS[Math.floor(Math.random() * INTROS.length)];
      const suggestions = CHIPS.sort(() => Math.random() - 0.5).slice(0, 4);

      setStatus('responding');
      showTyping();
      await sleep(420 + Math.floor(Math.random()*260));
      hideTyping();
```
REPLACE
```js
      const suggestions = CHIPS.sort(() => Math.random() - 0.5).slice(0, 4);

      setStatus('responding');
      showTyping();
      // a fresh, curious opening written for THIS moment (time of day, what you last talked about, SHERZ's own curiosity); the fixed list above is only the offline fallback
      const [fresh] = await Promise.all([fetchFreshIntro(), sleep(420 + Math.floor(Math.random()*260))]);
      const introText = fresh || INTROS[Math.floor(Math.random() * INTROS.length)];
      hideTyping();
```

## How to try it
1. Apply the patches, restart the server, open an empty chat (or press New chat). The typing dots show for about a second or two, then the greeting appears.
2. See the raw server answer: open `http://localhost:3000/api/greeting?tz=Asia/Tashkent&fresh=1` while logged in (it returns JSON with `source: "ai"`).
3. If you always get the old lines: check the terminal for `[greeting] route error` and check that `OPENAI_API_KEY` is set; `source:"fallback"` in the JSON means the server could not get a usable answer.

Not yet tested against the real OpenAI model (no key in my sandbox) — the model is simulated in the tests. The first real greetings are the thing to look at: if the tone is off, the wording is in `buildGreetingPrompt()` (one place), and the flavors are in `proactive/curiosity.js`.
