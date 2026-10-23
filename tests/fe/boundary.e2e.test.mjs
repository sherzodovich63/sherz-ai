const { chromium } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const { server, state, port } = await startMock('public');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const USER = mkJwt({ id: 'user_1', name: 'B', email: 'b@e.com', exp: Math.floor(Date.now() / 1000) + 3600 });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await ctx.addInitScript((t) => { localStorage.setItem('sherz_token', t); }, USER);
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(900);
const send = async (t) => { await page.evaluate(() => document.getElementById('composerShell').classList.remove('collapsed')); await page.fill('#text', t); await page.press('#text', 'Enter'); };
const X = (n) => ({ tool: 'docs.create_xlsx', args: { filename: n, sheets: [{ name: 'Hafta', columns: [{ header: 'Nom' }, { header: 'Summa', format: 'number' }], rows: [['Ijara', 900], ['Oziq-ovqat', 300]] }] } });
const REQ = 'Excel fayl yaratib ber: haftalik xarajatlar';

// the SERVER decided (same call expertTurn makes) → the card arrives already executed, flagged as an explicit-request run
const mkRun = async (name, text = REQ) => {
  const p = await state.agentGate.propose({ userId: 'user_1', title: 'Xarajatlar ' + name, steps: [X(name)], source: 'assistant' });
  const r = await state.agentGate.autoApprove({ userId: 'user_1', id: p.id, userText: text, tainted: false });
  return r.auto ? r.action : p;
};
const a1 = await mkRun('haftalik');
ok('server ran it by itself (no autonomy habit involved)', a1.status === 'executed' && a1.auto && a1.auto.grant === 'explicit_request');
state.firstTurn = async () => ({ plans: [a1], consents: [] });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), send('/agent ' + REQ)]);
await page.waitForTimeout(900);
ok('the file downloaded to the device by itself', !!dl && dl.suggestedFilename() === 'haftalik.xlsx', dl ? dl.suggestedFilename() : 'no download');
if (dl) { const b = (await import('node:fs')).readFileSync(await dl.path()); ok('it is a real xlsx (zip)', b[0] === 0x50 && b[1] === 0x4b); }
const card = await page.$eval('#log .plan-card:last-of-type', (e) => e.textContent);
ok('banner says it was created because the user asked', /Created — you asked for it in this chat/.test(card) && /saved to your device/.test(card), card.slice(0, 220));
ok('no Approve / habit wording on that card', !/Approve/.test(card) && !/Ran automatically/.test(card) && !/approved this kind of step/.test(card));
ok('reasoning is available ("Why didn’t SHERZ ask first?")', /Why didn’t SHERZ ask first/.test(card) && /explicitly asked/.test(card) && /no permission is needed/.test(card));
ok('Download button is still there as a fallback', !!(await page.$('#log .plan-card:last-of-type [data-file-dl]')));
await page.screenshot({ path: 'shots/boundary-auto.png' });

// a plan the server did NOT auto-run still shows the normal Approve card
const pend = await state.agentGate.propose({ userId: 'user_1', title: 'Needs a click', steps: [X('kerak')], source: 'assistant' });
state.firstTurn = async () => ({ plans: [pend], consents: [] });
await send('/agent salom'); await page.waitForTimeout(1200);
const last = await page.$eval('#log .plan-card:last-of-type', (e) => e.textContent);
ok('an asked-about plan keeps its Approve button and does not download', /Approve/.test(last) && !/Created — you asked/.test(last));

// /autodownload off → next explicit request does NOT download; on → it does again
await send('/autodownload off'); await page.waitForTimeout(500);
ok('/autodownload off confirms', /Automatic download is OFF/.test(await page.$eval('#log', (e) => e.textContent)));
const a2 = await mkRun('ikkinchi'); state.firstTurn = async () => ({ plans: [a2], consents: [] });
let got = null; page.once('download', (d) => { got = d; });
await send('/agent ' + REQ); await page.waitForTimeout(1800);
ok('with it OFF nothing downloads by itself', got === null);
ok('banner no longer claims "saved to your device"', !/saved to your device/.test(await page.$eval('#log .plan-card:last-of-type', (e) => e.textContent)));
await send('/autodownload on'); await page.waitForTimeout(500);
const a3 = await mkRun('uchinchi'); state.firstTurn = async () => ({ plans: [a3], consents: [] });
const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), send('/agent ' + REQ)]);
ok('back ON → downloads again', !!dl3 && dl3.suggestedFilename() === 'uchinchi.xlsx');

// reload must not re-download old files
let reDl = 0; page.on('download', () => reDl++);
await page.reload(); await page.waitForTimeout(1500);
ok('reloading the page never re-downloads old files', reDl === 0, String(reDl));
ok('no page errors', errors.length === 0, errors.join('|'));
await browser.close(); server.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
