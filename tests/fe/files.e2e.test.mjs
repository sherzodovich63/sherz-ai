const { chromium } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const { buildXlsx } = await import('/home/claude/lib/docs/xlsx.js');
const { server, state, port } = await startMock('public');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const USER = mkJwt({ id: 'user_1', name: 'B', email: 'b@e.com', exp: Math.floor(Date.now() / 1000) + 3600 });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await ctx.addInitScript((t) => { localStorage.setItem('sherz_token', t); }, USER);
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(900);
const send = async (t) => { await page.evaluate(() => document.getElementById('composerShell').classList.remove('collapsed')); await page.fill('#text', t); await page.press('#text', 'Enter'); await page.waitForTimeout(1000); };
await send('/files');
const txt = () => page.$$eval('#log .files-card', (l) => l[l.length - 1].textContent);
ok('empty state', /No files yet/.test(await txt()) && /0\/40/.test(await txt()), (await txt()).slice(0, 200));

// plan → approve → file → download button on the plan card
const plan = await state.agentGate.propose({ userId: 'user_1', title: 'Budget', steps: [{ tool: 'docs.create_xlsx', args: { filename: 'budget', sheets: [{ name: 'Oct', columns: [{ header: 'Item' }, { header: 'Cost', format: 'currency' }], rows: [['Rent', 900], ['Food', 300], ['Total', { f: '=SUM(B2:B3)' }]] }] } }] });
state.firstTurn = async () => ({ plans: [plan], consents: [] });
await send('/agent make me a budget');
ok('plan card shows the Excel step', /Excel|budget\.xlsx/i.test(await page.$eval('#log', (e) => e.textContent)));
await page.click('#log [data-act="approve"]'); await page.waitForTimeout(1200);
const dl = await page.$('#log .plan-step [data-file-dl]');
ok('Download button appears after the run', !!dl);
if (dl) {
  const [d] = await Promise.all([page.waitForEvent('download'), dl.click()]);
  const path = await d.path(); const fs = await import('node:fs'); const b = fs.readFileSync(path);
  ok('downloaded a real xlsx (zip)', d.suggestedFilename() === 'budget.xlsx' && b[0] === 0x50 && b[1] === 0x4b, d.suggestedFilename());
}
await send('/files');
ok('file listed in /files', /budget\.xlsx/.test(await txt()) && /1\/40/.test(await txt()));

// upload
const up = await buildXlsx({ filename: 'mine', sheets: [{ name: 'S', columns: [{ header: 'A' }], rows: [['x']] }] });
await page.setInputFiles('#log .files-card:last-of-type [data-file-input]', { name: 'mine.xlsx', mimeType: 'application/octet-stream', buffer: up.buffer }); await page.waitForTimeout(900);
ok('upload shows the file', /mine\.xlsx/.test(await txt()) && /uploaded/.test(await txt()), (await txt()).slice(0, 300));
await page.setInputFiles('#log .files-card:last-of-type [data-file-input]', { name: 'evil.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip at all') }); await page.waitForTimeout(900);
ok('fake xlsx is refused with a message', !/evil\.xlsx/.test((await txt()).replace(/Upload.*/, '')) && /plan-err|zip|not a valid|Office/i.test(await page.$eval('#log .files-card:last-of-type', (e) => e.innerHTML)), (await txt()).slice(-200));
await page.screenshot({ path: 'shots/files.png' });

// delete
await page.click('#log .files-card:last-of-type [data-file-del] >> nth=0'); await page.waitForTimeout(800);
ok('delete removes one file', /1\/40/.test(await txt()));
ok('other user cannot see my files', (await state.fileStore.list('someone_else')).length === 0);
ok('no page errors', errors.length === 0, errors.join('|'));
await browser.close(); server.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
