const { chromium } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const { server, state, port } = await startMock('public');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const USER = mkJwt({ id: 'user_1', name: 'B', email: 'b@e.com', exp: Math.floor(Date.now() / 1000) + 3600 });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await ctx.addInitScript((t) => { localStorage.setItem('sherz_token', t); }, USER);
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(1000);
await page.click('#btnLeftPanel').catch(() => {}); await page.waitForTimeout(400);
const T = (sel) => page.textContent(sel);
// ── hub ──
ok('Space Hub card visible, neutral, no actions', await page.isVisible('#spaceHub') && /Create your Work Space/.test(await T('#hubName')) && !(await page.isVisible('#hubActions')));
const hubBg = await page.$eval('#hubCard', (e) => getComputedStyle(e).backgroundColor), projBg = await page.$eval('#newProjectBtn', (e) => getComputedStyle(e).backgroundImage);
ok('hub looks different from the New Project button (no shared gradient button)', !(await page.$('#newSpaceBtn')) && (await page.$eval('#hubCard', (e) => e.className)).includes('hub-card'), projBg.slice(0, 40));
await page.click('#hubCard'); await page.waitForTimeout(300);
ok('no Space yet: clicking the card opens the creator directly (there is no Create row in the menu)', await page.isVisible('#spaceModal') && !(await page.$('#newSpaceBtn')) && !(await page.isVisible('#spaceMenu')));
await page.screenshot({ path: 'shots/hub-menu.png' });
await page.click('#spCancel'); await page.waitForTimeout(200); ok('Cancel closes the creator', !(await page.isVisible('#spaceModal')));
await page.click('#hubCard'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); ok('Escape closes the creator', !(await page.isVisible('#spaceModal')));
// ── creator: categories ──
await page.click('#hubCard'); await page.waitForTimeout(300);
ok('creator: generator box + 5 category chips + role cards', await page.isVisible('#spDesc') && (await page.$$('#spCats .sp-cat')).length === 5 && (await page.$$('#spRoles .sp-role')).length >= 2);
ok('Skills tab disabled while creating', await page.$eval('#spTabSkills', (b) => b.disabled));
const cats = await page.$$eval('#spCats .sp-cat', (l) => l.map((e) => e.textContent.trim()));
ok('category names', ['Logistics', 'Finance & Economics', 'Software Engineering', 'Creative & Marketing', 'Academic'].every((n) => cats.some((c) => c.includes(n))), cats.join('|'));
await page.click('#spCats [data-cat="finance"]'); await page.waitForTimeout(100);
ok('switching category swaps role cards', /Financial analyst/.test(await T('#spRoles')) && !/Freight/.test(await T('#spRoles')));
await page.click('#spRoles [data-role="finance.analyst"]');
ok('role card fills name/role/instructions/style', (await page.inputValue('#spName')) === 'Financial analyst' && /Financial analyst/.test(await page.inputValue('#spRole')) && (await page.inputValue('#spStyle')) === 'analytical' && await page.$eval('#spStyles [data-style="analytical"]', (e) => e.classList.contains('on')));
// ── styles ──
const styles = await page.$$eval('#spStyles .sp-style', (l) => l.map((e) => e.dataset.style));
ok('5 work styles', styles.join() === 'general,analytical,technical,operational,formal', styles.join());
await page.click('#spStyles [data-style="formal"]'); ok('style picker selects (radio semantics)', (await page.inputValue('#spStyle')) === 'formal' && (await page.getAttribute('#spStyles [data-style="formal"]', 'aria-checked')) === 'true' && (await page.getAttribute('#spStyles [data-style="general"]', 'aria-checked')) === 'false');
// contrast of every text field + style cards in dark
const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
async function contrast(theme) {
  return page.evaluate(() => {
    const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
    const effBg = (el) => { const layers = []; let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) layers.push(c); if (c.a >= 1) break; n = n.parentElement; } let base = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return `rgb(${base.r}, ${base.g}, ${base.b})`; };
    return [...document.querySelectorAll('#spProfile .pf-input, #spProfile .sp-style, #spProfile .sp-role, #spProfile .sp-cat, .sp-head h2')].map((e) => ({ id: e.id || e.className, color: getComputedStyle(e).color, bg: effBg(e) }));
  });
}
const dark = await contrast(); const bad = dark.filter((x) => ratio(x.color, x.bg) < 3.5);
ok('dark mode: all fields/cards have readable contrast (≥3.5)', bad.length === 0, JSON.stringify(bad.slice(0, 3)));
await page.screenshot({ path: 'shots/creator-dark.png' });
// native select regression: a plain select inside the sheet must not be white-on-white
const sel = await page.evaluate(() => { const s = document.createElement('select'); s.innerHTML = '<option>One</option>'; document.querySelector('.sp-sheet').appendChild(s); const cs = getComputedStyle(s), os = getComputedStyle(s.firstChild); const r = { sc: cs.color, sb: cs.backgroundColor, oc: os.color, ob: os.backgroundColor }; s.remove(); return r; });
ok('select + option colours are distinct (dark)', ratio(sel.sc, sel.sb) >= 3.5 && ratio(sel.oc, sel.ob) >= 7, JSON.stringify(sel));
// ── generator (template fallback: mock llm rejects) ──
await page.fill('#spDesc', 'freight dispatcher for Amazon Relay'); await page.click('#spGenerate'); await page.waitForTimeout(900);
ok('generator without AI → template, note says so, fields filled', /template/i.test(await T('#spGenNote')) && /dispatcher/i.test(await page.inputValue('#spName')) && (await page.inputValue('#spStyle')) === 'operational' && (await page.inputValue('#spInstr')).length > 60);
// AI path
state.spaceLlm = async () => JSON.stringify({ name: 'Ward Nurse', role: 'Clinical admin assistant', style: 'formal', icon: 'briefcase', instructions: 'Help draft shift handover notes in a structured format.\nNever invent patient data or clinical facts.\nAsk for the ward and shift when missing.' });
await page.fill('#spDesc', 'ward nurse'); await page.press('#spDesc', 'Enter'); await page.waitForTimeout(900);
ok('generator with AI → fills from AI, note says AI', /Written by AI/.test(await T('#spGenNote')) && (await page.inputValue('#spName')) === 'Ward Nurse' && (await page.inputValue('#spStyle')) === 'formal' && /Never invent patient/.test(await page.inputValue('#spInstr')));
await page.fill('#spDesc', 'x'); await page.click('#spGenerate'); await page.waitForTimeout(200);
ok('too-short description → inline hint, no request', /few words/.test(await T('#spGenNote')));
ok('meter updates', /tokens/.test(await T('#spMeter')));
await page.screenshot({ path: 'shots/creator-generated.png' });
await page.click('#spSave'); await page.waitForTimeout(1500);
const row = state.spaceDb.T.workSpace[0];
ok('created from generated profile (name, style, instructions)', row && row.name === 'Ward Nurse' && row.style === 'formal' && /handover/.test(row.instructions), JSON.stringify(row && { n: row.name, s: row.style, p: row.preset }));
ok('hub now shows the active Space + actions; chat in Space mode', /Ward Nurse/.test(await T('#hubName')) && /Formal corporate/.test(await T('#hubSub')) && await page.isVisible('#hubActions') && /Space · Ward Nurse/.test(await T('#modeBadgeText')));
ok('space chat is not in the Projects list', !/Ward Nurse/.test(await T('#convList')));
await page.screenshot({ path: 'shots/hub-active.png' });
// ONE Work Space: the second profile is a ROLE inside it
await page.click('#hubCard'); ok('second role is added with the chip in the Hub, not a Create row', await page.isVisible('#hubAddRole') && /2nd role/.test(await T('#hubAddRole')) && !(await page.$('#newSpaceBtn'))); await page.click('#hubCard');
await page.click('#hubAddRole'); await page.waitForTimeout(300);
ok('role sheet is titled "Add a second role"', /Add a second role/.test(await T('#spTitle')) && /Add role/.test(await T('#spSave')));
await page.click('#spCats [data-cat="logistics"]'); await page.click('#spRoles [data-role="logistics.dispatcher"]'); await page.click('#spSave'); await page.waitForTimeout(1400);
const w0 = state.spaceDb.T.workSpace;
ok('still ONE Work Space row; role 2 stored (dispatcher, operational) and active', w0.length === 1 && w0[0].role2.preset === 'logistics.dispatcher' && w0[0].role2.style === 'operational' && w0[0].activeRole === 2, JSON.stringify(w0.map((w) => w.role2)));
await page.click('#hubCard');
ok('menu lists the two ROLES, active one marked, no create row (limit 2)', (await page.$$('#spaceList .hub-item')).length === 2 && (await page.$$eval('#spaceList .hub-item.on', (l) => l.length)) === 1 && !(await page.isVisible('#hubAddRole')) && /2\/2/.test(await T('#spaceCount')));
await page.screenshot({ path: 'shots/hub-two-roles.png' });
await page.click('#spaceList .hub-item:not(.on)'); await page.waitForTimeout(900);
ok('switching role via hub (role 1 active again, chat title follows)', state.spaceDb.T.workSpace[0].activeRole === 1 && /Ward Nurse/.test(await T('#hubName')) && /Space ·/.test(await T('#modeBadgeText')) && state.spaceDb.T.conversation.every((c) => c.title === 'Ward Nurse'));
await page.click('#hubCard'); await page.click('#spaceList .hub-item:not(.on)'); await page.waitForTimeout(900);
ok('switch to role 2 and edit it: edit sheet offers "Remove this role"', /Dispatcher/i.test(await T('#hubName')) && (await page.evaluate(() => { document.getElementById('hubEdit').click(); return document.getElementById('spArchive').textContent; })) === 'Remove this role');
await page.click('#spCancel'); await page.waitForTimeout(200);
await page.click('#hubCard'); await page.click('#spaceList .hub-item:not(.on)'); await page.waitForTimeout(900);
// skills via hub chip
await page.click('#hubSkills'); await page.waitForTimeout(500);
ok('hub Skills chip opens skills tab', !(await page.isVisible('#spProfile')) && /No skills yet/.test(await T('#spSkillList')));
await page.fill('#skName', 'Shift handover'); await page.fill('#skSummary', 'summarise a shift'); await page.fill('#skBody', '1. list events\n2. list pending tasks'); await page.click('#skSave'); await page.waitForTimeout(700);
ok('skill saved with level', /Shift handover/.test(await T('#spSkillList')) && /Learning/.test(await T('.sk-card')));
await page.click('.sk-card .sk-btn[aria-label="Good skill"]'); await page.waitForTimeout(500); ok('thumbs evidence', /100% accepted/.test(await T('.sk-card')));
await page.screenshot({ path: 'shots/skills-dark.png' });
await page.click('#spClose'); await page.waitForTimeout(300);
ok('hub chip count updated', (await T('#hubSkillCount')) === '1');
// edit profile shows style cards, no generator
await page.click('#hubEdit'); await page.waitForTimeout(300);
ok('edit mode: no generator/role picker, style preselected', !(await page.isVisible('#spStart')) && (await page.$eval('#spStyles .sp-style.on', (e) => e.dataset.style)) === (await page.inputValue('#spStyle')));
await page.click('#spStyles [data-style="analytical"]'); await page.click('#spSave'); await page.waitForTimeout(900);
ok('style change saved, hub subtitle updated', state.spaceDb.T.workSpace.some((w) => w.style === 'analytical') && /Analytical/.test(await T('#hubSub')));
// ── light theme contrast ──
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.click('#hubEdit'); await page.waitForTimeout(300);
const light = await contrast(); const badL = light.filter((x) => ratio(x.color, x.bg) < 3.5);
ok('light mode: all fields/cards readable (≥3.5)', badL.length === 0, JSON.stringify(badL.slice(0, 3)));
await page.screenshot({ path: 'shots/creator-light.png' });
const selL = await page.evaluate(() => { const s = document.createElement('select'); s.innerHTML = '<option>One</option>'; document.querySelector('.sp-sheet').appendChild(s); const cs = getComputedStyle(s), os = getComputedStyle(s.firstChild); const r = { sc: cs.color, sb: cs.backgroundColor, oc: os.color, ob: os.backgroundColor }; s.remove(); return r; });
ok('select + option colours distinct (light)', ratio(selL.sc, selL.sb) >= 3.5 && ratio(selL.oc, selL.ob) >= 7, JSON.stringify(selL));
await page.click('#spClose'); await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
// delete flow
await page.click('#hubEdit'); await page.click('#spDelete'); ok('delete needs second click', state.spaceDb.T.workSpace.length === 1);
await page.click('#spDelete'); await page.waitForTimeout(1200);
ok('deleted; back in Companion', state.spaceDb.T.workSpace.length === 0 && /Companion/.test(await T('#modeBadgeText')));
// mobile
await page.setViewportSize({ width: 390, height: 780 });
await page.evaluate(() => { document.querySelector('#hubCard').click(); }); await page.waitForTimeout(400);
const ov = await page.evaluate(() => { const r = document.querySelector('.sp-sheet').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sx: document.documentElement.scrollWidth, sw: document.querySelector('.sp-body').scrollWidth, cw: document.querySelector('.sp-body').clientWidth }; });
ok('mobile: sheet fits, no horizontal overflow', ov.l >= 0 && ov.r <= ov.w && ov.sx <= ov.w && ov.sw <= ov.cw + 1, JSON.stringify(ov));
await page.screenshot({ path: 'shots/creator-mobile.png' });
ok('no page errors', errors.length === 0, errors.join('|'));
await browser.close(); server.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
