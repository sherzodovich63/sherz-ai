const { chromium } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const { server, state, port } = await startMock('public');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const USER = mkJwt({ id: 'user_1', name: 'B', email: 'b@e.com', exp: Math.floor(Date.now() / 1000) + 3600 });
state.facts = [
  { key: 'proactive_ping_count_day', value: '2' }, { key: 'proactive_last_ping_at', value: '2026-10-21T12:32:19.025Z' }, { key: 'learn:skill:brain.llm', value: '{"ok":3}' }, { key: 'last_state', value: 'calm' },
  ...Array.from({ length: 30 }, (_, i) => ({ key: 'fact' + i, value: 'value ' + i })), { key: 'name', value: 'Bekzod' },
];
const scrollers = (page) => page.evaluate(() => [...document.querySelectorAll('#leftPanel *')].filter((e) => !['TEXTAREA', 'INPUT', 'SELECT'].includes(e.tagName) && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.getBoundingClientRect().height > 0).map((e) => e.className || e.id || e.tagName));
for (const [label, vp, theme] of [['desktop', { width: 1280, height: 800 }, 'dark'], ['short', { width: 1280, height: 560 }, 'dark'], ['light', { width: 1280, height: 800 }, 'light'], ['phone', { width: 390, height: 720 }, 'dark']]) {
  state.spaceDb.T.workSpace.length = 0; state.spaceDb.T.conversation.length = 0;
  await state.spaceDb.workSpace.create({ data: { userId: 'user_1', name: 'Freight dispatcher', role: 'Freight dispatch assistant', preset: 'logistics.dispatcher', style: 'operational', icon: 'truck', color: 'amber', instructions: 'x' } });
  const ctx = await browser.newContext({ viewport: vp }); await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await ctx.addInitScript(([t, th]) => { localStorage.setItem('sherz_token', t); localStorage.setItem('sherz_theme', th); }, [USER, theme]);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(1500);
  if (!(await page.isVisible('#menuProfileBtn'))) { await page.click('#btnLeftPanel'); await page.waitForTimeout(700); }
  ok(`${label}: no "Create a Work Space" button anywhere in the menu`, !(await page.$('#newSpaceBtn')) && !/Create a Work Space/i.test(await page.textContent('#leftPanel')));
  await page.click('#hubCard'); await page.waitForTimeout(250);
  ok(`${label}: dropdown lists only the role(s), no create row`, (await page.$$('#spaceList .hub-item')).length === 1 && !(await page.$('#spaceMenu .hub-create')));
  ok(`${label}: "+ 2nd role" chip is shown while a role slot is free`, await page.isVisible('#hubAddRole') && /2nd role/.test(await page.textContent('#hubAddRole')));
  await page.click('#hubCard');
  await page.click('#menuProfileBtn'); await page.waitForTimeout(700);
  const sc = await scrollers(page);
  ok(`${label}: exactly ONE scroll container in the sidebar`, sc.length === 1 && /menu-inner/.test(sc[0]), JSON.stringify(sc));
  const m = await page.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const hub = document.getElementById('menuHub'), foot = document.querySelector('#leftPanel .menu-foot'), lo = document.getElementById('menuLogout'), inner = document.querySelector('#leftPanel .menu-inner'); return { boxTop: r(inner).top, hubBottom: r(hub).bottom, hubTop: r(hub).top, footTop: r(foot).top, loBottom: r(lo).bottom, vh: innerHeight, hubInInner: inner.contains(hub), hubInFoot: foot.contains(hub), hubH: r(hub).height, over: inner.scrollHeight - inner.clientHeight }; });
  ok(`${label}: Hub scrolls with the sidebar (not inside the pinned footer)`, m.hubInInner && !m.hubInFoot);
  ok(`${label}: Log out always visible`, m.loBottom <= m.vh + 0.5, JSON.stringify({ lo: m.loBottom, vh: m.vh }));
  ok(`${label}: the open Hub is brought into view (fits above the footer, or starts at the top of the panel)`, m.hubBottom <= m.footTop + 1 || (m.hubTop >= m.boxTop - 1 && m.hubTop < m.footTop - 40), JSON.stringify({ hb: m.hubBottom, ft: m.footTop }));
  const facts = await page.textContent('#factsBox');
  ok(`${label}: raw system keys are hidden`, !/proactive_|learn:|last_state/.test(facts) && /fact0/.test(facts) && /Show all \(31\)/.test(facts) && !/fact20/.test(facts));
  await page.click('#factsMore'); await page.waitForTimeout(300); ok(`${label}: "Show all" expands in the same single scroll`, /fact20/.test(await page.textContent('#factsBox')) && (await scrollers(page)).length === 1);
  ok(`${label}: no system key anywhere in the sidebar`, !/proactive_ping|proactive_last|learn:skill/.test(await page.textContent('#leftPanel')));
  await page.screenshot({ path: `shots/sidebar-${label}.png` });
  await page.click('#menuProfileBtn'); await page.waitForTimeout(300);
  ok(`${label}: closes again`, await page.evaluate(() => document.getElementById('menuHub').hidden));
  ok(`${label}: no page errors`, errors.length === 0, errors.join('|'));
  await ctx.close();
}
// no Space yet: the card itself creates it
state.spaceDb.T.workSpace.length = 0;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort()); await ctx.addInitScript((t) => localStorage.setItem('sherz_token', t), USER);
const page = await ctx.newPage(); await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(1500);
if (!(await page.isVisible('#hubCard'))) { await page.click('#btnLeftPanel'); await page.waitForTimeout(600); }
ok('no Space yet: the card says "Create your Work Space"', /Create your Work Space/.test(await page.textContent('#hubName')) && !(await page.isVisible('#hubAddRole')) && !(await page.isVisible('#hubActions')));
await page.click('#hubCard'); await page.waitForTimeout(300);
ok('…and clicking it opens the creator', await page.isVisible('#spaceModal') && /New Work Space/.test(await page.textContent('#spTitle')));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); server.close(); process.exit(fail ? 1 : 0);
