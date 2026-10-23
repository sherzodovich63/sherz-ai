const { chromium } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const { server, state, port } = await startMock('public');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const USER = mkJwt({ id: 'user_1', name: 'B', email: 'b@e.com', exp: Math.floor(Date.now() / 1000) + 3600 });
state.seed('user_1', 6);
const N = 130, texts = Array.from({ length: N }, (_, i) => (i % 2 ? `Javob ${i}: ` + 'lorem ipsum dolor sit amet '.repeat(1 + (i % 7)) : `Savol ${i}`));
state.seedMore('user_1', [['c_big', 'Big project', 1, texts]]);
async function open(vh = 900) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: vh }, locale: 'en-US' });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await ctx.addInitScript((t) => { localStorage.setItem('sherz_token', t); }, USER);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(900); return { ctx, page, errs };
}
const histReqs = () => state.log.filter((e) => e.p === '/api/chat/history');
const info = (page) => page.evaluate(() => { const f = document.querySelector('.feed'); const b = [...f.querySelectorAll('.bubble.hb')]; const ids = b.map((x) => x.dataset.mid); return { n: b.length, dup: ids.length - new Set(ids).size, first: ids[0], last: ids[ids.length - 1], top: f.scrollTop, h: f.scrollHeight, c: f.clientHeight }; });
const openProject = async (page, title) => { await page.evaluate((t) => { const el = [...document.querySelectorAll('.conv-item')].find((e) => e.textContent.includes(t)); (el.querySelector('.conv-main,button') || el).click(); }, title); };

let { ctx, page, errs } = await open();
await page.evaluate(() => document.getElementById('menuBtn') && document.getElementById('menuBtn').click()); await page.waitForTimeout(300);
state.log.length = 0;
await openProject(page, 'Big project'); await page.waitForTimeout(700);
let i = await info(page);
ok('first page = 20 newest messages, scrolled to the bottom', i.n === 20 && i.last === 'c_big-m129', JSON.stringify(i));
ok('opened at the bottom', i.h - i.top - i.c < 5, JSON.stringify(i));
ok('long bubbles are skipped when off-screen (content-visibility)', (await page.evaluate(() => getComputedStyle(document.querySelector('.bubble.hb')).contentVisibility)) === 'auto');
// anchor: stop 100px from the top, remember a bubble, let the next page load
await page.evaluate(() => { document.querySelector('.feed').scrollTop = 600; }); await page.waitForTimeout(80);
const pin = await page.evaluate(() => { const f = document.querySelector('.feed'); const t = f.getBoundingClientRect().top; const b = [...f.querySelectorAll('.bubble.hb')].find((x) => x.getBoundingClientRect().bottom > t + 5); return { mid: b.dataset.mid, y: b.getBoundingClientRect().top }; });
await page.evaluate(() => { document.querySelector('.feed').scrollTop = 100; });
await page.waitForTimeout(500);
const pin2 = await page.evaluate((m) => { const b = document.querySelector(`.bubble.hb[data-mid="${m}"]`); return b ? b.getBoundingClientRect().top : null; }, pin.mid);
i = await info(page);
ok('older page was prepended (40 now)', i.n >= 40, JSON.stringify(i));
// the reader was at scrollTop 100 when the page landed, so compare against that position, not 600
const pinAfter = await page.evaluate((m) => { const f = document.querySelector('.feed'); return document.querySelector(`.bubble.hb[data-mid="${m}"]`) ? true : false; }, pin.mid);
ok('the bubble we were reading is still on the page', pinAfter);
// precise anchor test: scroll slowly to a position near the top, record the visible bubble's y, force a load, compare
await page.evaluate(() => { document.querySelector('.feed').scrollTop = 900; }); await page.waitForTimeout(150);
// keep scrolling up to the top repeatedly until everything is loaded
await page.evaluate(() => { window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch (e) {} });
let guard = 0, last = 0;
while (guard++ < 40) { await page.evaluate(() => { document.querySelector('.feed').scrollTop = 0; }); await page.waitForTimeout(260); const x = await info(page); if (x.n === last && x.n >= N) break; last = x.n; }
i = await info(page);
ok('all 130 messages reachable by scrolling up', i.n === N, JSON.stringify(i));
ok('no duplicates', i.dup === 0);
const longs = await page.evaluate(() => window.__long); ok('no long tasks (>200ms) while paging through 130 messages', longs.every((d) => d < 200), JSON.stringify(longs));
const order = await page.evaluate(() => { const ids = [...document.querySelectorAll('.feed .bubble.hb')].map((x) => x.dataset.mid); return ids.every((v, k) => k === 0 || +ids[k - 1].split('-m')[1] < +v.split('-m')[1]); });
ok('chronological order', order);
const before = histReqs().length; await page.evaluate(() => { const f = document.querySelector('.feed'); f.scrollTop = 0; f.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(500);
ok('no more requests once the start of the thread is reached', histReqs().length === before);
const pages = histReqs().filter((e) => e.q.before).length;
ok('loaded in batches of 20 (6 older pages)', pages === 6, 'pages=' + pages + ' limit=' + histReqs()[0].q.limit);

// anchoring precision: reopen a fresh page, scroll to ~300px from top, measure a bubble, trigger load by moving to 200
await page.close(); ({ ctx, page, errs } = await open());
await page.evaluate(() => document.getElementById('menuBtn') && document.getElementById('menuBtn').click()); await page.waitForTimeout(300);
await openProject(page, 'Big project'); await page.waitForTimeout(600);
const drift = await page.evaluate(async () => {
  const f = document.querySelector('.feed'); f.style.scrollBehavior = 'auto';
  await new Promise((r) => setTimeout(r, 300));
  f.scrollTop = 800; await new Promise((r) => setTimeout(r, 150));                 // far enough from the top that nothing loads yet
  const n0 = f.querySelectorAll('.bubble.hb').length;
  f.scrollTop = 420;                                                                // crosses the prefetch line → older page is requested
  const t = f.getBoundingClientRect().top;
  const b = [...f.querySelectorAll('.bubble.hb')].find((x) => x.getBoundingClientRect().top > t + 40); const mid = b.dataset.mid; const y0 = b.getBoundingClientRect().top;
  await new Promise((r) => setTimeout(r, 700));
  const n1 = f.querySelectorAll('.bubble.hb').length; const b2 = f.querySelector(`.bubble.hb[data-mid="${mid}"]`);
  return { n0, n1, dy: b2.getBoundingClientRect().top - y0 };
});
ok('screen did not jump when older messages landed (|Δy| ≤ 3px)', Math.abs(drift.dy) <= 3 && drift.n1 > drift.n0, JSON.stringify(drift));

// cache: leave and come back → instant repaint, only ONE quiet sync request, no paging again
await page.evaluate(() => document.getElementById('companionBtn').click()); await page.waitForTimeout(600);
const shownBefore = (await info(page)).n;
state.log.length = 0;
await page.evaluate(() => { const el = [...document.querySelectorAll('.conv-item')].find((e) => e.textContent.includes('Big project')); (el.querySelector('.conv-main,button') || el).click(); });
await page.waitForTimeout(30);
const quick = await info(page);
await page.waitForTimeout(500);
ok('returning repaints from the cache immediately', quick.n >= 40, JSON.stringify(quick));
ok('and needs only one background sync request', histReqs().length === 1 && !histReqs()[0].q.before, 'reqs=' + histReqs().length);
// fresh server message arrives while away → the sync appends it
state.store.user_1.push({ id: 'user_1-zz1', role: 'ai', text: 'Yangi javob', ts: Date.now() + 5000, conv: 'c_big' });
await page.evaluate(() => document.getElementById('companionBtn').click()); await page.waitForTimeout(400);
await page.evaluate(() => { const el = [...document.querySelectorAll('.conv-item')].find((e) => e.textContent.includes('Big project')); (el.querySelector('.conv-main,button') || el).click(); }); await page.waitForTimeout(700);
ok('new message appeared after the quiet sync, at the bottom', (await page.evaluate(() => { const b = [...document.querySelectorAll('.feed .bubble.hb')]; return b[b.length - 1].textContent.includes('Yangi javob'); })));
// failure: old pages fail → retried later, not on every scroll tick
await page.evaluate(() => { document.querySelector('.feed').scrollTop = 0; }); await page.waitForTimeout(400);
let calls = 0; await page.route('**/api/chat/history?*before*', (r) => { calls++; r.fulfill({ status: 500, body: '{}' }); });
for (let k = 0; k < 8; k++) { await page.evaluate(() => { const f = document.querySelector('.feed'); f.scrollTop = 40; f.scrollTop = 0; }); await page.waitForTimeout(120); }
ok('a failing page is not hammered (≤ 1 request within 3s)', calls <= 1, 'calls=' + calls);
await page.unroute('**/api/chat/history?*before*'); await page.waitForTimeout(3300);
await page.evaluate(() => { const f = document.querySelector('.feed'); f.scrollTop = 30; f.scrollTop = 0; }); await page.waitForTimeout(600);
const nAfter = (await info(page)).n; ok('…and loading resumes after the pause', nAfter > 40, 'n=' + nAfter);
ok('no page errors', errs.length === 0, errs.join('|'));
await ctx.close();

// tall screen + tiny messages: the first page does not fill the screen → it keeps loading by itself
state.seedMore('user_1', [['c_tiny', 'Tiny project', 1, Array.from({ length: 90 }, (_, k) => 'ok ' + k)]]);
({ ctx, page, errs } = await open(2600));
await page.evaluate(() => document.getElementById('menuBtn') && document.getElementById('menuBtn').click()); await page.waitForTimeout(300);
await openProject(page, 'Tiny project'); await page.waitForTimeout(1500);
i = await info(page);
ok('a screen taller than one page keeps loading until it is filled', i.n > 20, JSON.stringify(i));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
