const { chromium } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const { server, state, port } = await startMock('public');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const USER = mkJwt({ id: 'user_1', name: 'B', email: 'b@e.com', exp: Math.floor(Date.now() / 1000) + 3600 });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tashkent' });
await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
await ctx.addInitScript((t) => { localStorage.setItem('sherz_token', t); }, USER);
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const firstBubble = async () => page.$eval('#log .bubble.ai', (e) => e.innerText.split('\n').filter((l) => l && !/^LISTENING$|^\d{1,2}:\d{2}\s?[AP]M$/.test(l.trim())).join('\n')).catch(() => '');
const gotText = (ms) => page.waitForFunction(() => { const b = document.querySelector('#log .bubble.ai'); return b && b.innerText.replace(/LISTENING|\d{1,2}:\d{2}\s?[AP]M/g, '').trim().length > 8; }, null, { timeout: ms }).catch(() => {});
const THEIRS = /^(Hayrli tong|Salom|Xayrli kech)/;
const open = async () => { await page.goto(`http://localhost:${port}/`); await gotText(15000); await page.waitForTimeout(600); };
const settle = () => page.waitForTimeout(2800);                       // the typewriter animation finishes

// 1) the server's fresh greeting is shown, not one of the fixed lines
let n = 0; state.greeting = async () => ({ text: `Kech tushdi, ${++n}-marta.\nBugun nimani o‘ylab yuribsiz?`, source: 'ai', intent: 'curiosity', flavor: 'philosophical' });
await open(); await settle();
const t1 = await firstBubble();
ok('shows the fresh server greeting', /Kech tushdi, 1-marta/.test(t1) && /nimani o‘ylab yuribsiz/.test(t1), JSON.stringify(t1));
ok('it is NOT one of the fixed INTROS', !/Men shu yerdaman\. Bugun kayfiyat|Bugun SHERZ’ni qaysi joyini/.test(t1));
const call = state.greetingCalls[0];
ok('request carried the browser time zone and the login', call && call.tz === 'Asia/Tashkent' && call.userId === 'user_1', JSON.stringify(call));
await page.screenshot({ path: 'shots/greeting-ai.png' });

// 2) opening the chat again gives a different line each time
await open(); await settle(); const t2 = await firstBubble();
ok('a new empty chat gets a new greeting', /Kech tushdi, 2-marta/.test(t2) && t2 !== t1, JSON.stringify(t2));

// 3) the model is down → the built-in line appears, no error bubble, no broken page
state.greeting = null; state.greetingFail = true; await open();
const t3 = await firstBubble();
ok('model error → built-in greeting instead', THEIRS.test(t3), JSON.stringify(t3));
ok('no error text shown to the user', !/error|xato|failed|500/i.test(t3));

// 4) the server answers "fallback" with an empty text → built-in line
state.greetingFail = false; state.greeting = async () => ({ text: '', source: 'fallback' }); await open();
ok('server fallback → built-in greeting', THEIRS.test(await firstBubble()));

// 5) too slow (> 7 s) → the page gives up and shows the built-in line instead of hanging
state.greeting = async () => ({ text: 'Juda kech keldi.', source: 'ai' }); state.greetingDelay = 9000;
const t0 = Date.now(); await page.goto(`http://localhost:${port}/`); await gotText(20000); await page.waitForTimeout(600);
const t5 = await firstBubble(); const took = Date.now() - t0;
ok('slow model → built-in greeting after ~7 s, not stuck', THEIRS.test(t5) && took < 12000, `${took} ms ${JSON.stringify(t5)}`);
state.greetingDelay = 0;

// 6) a chat that already has messages never asks for a greeting
await page.goto(`http://localhost:${port}/`); await gotText(10000);
await page.evaluate(() => document.getElementById('composerShell').classList.remove('collapsed')); await page.fill('#text', 'salom, bu mening xabarim'); await page.press('#text', 'Enter'); await page.waitForTimeout(2500);
state.greetingCalls.length = 0;
await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(3500);
ok('a chat with history does not request a greeting', state.greetingCalls.length === 0, String(state.greetingCalls.length));
ok('no page errors', errors.length === 0, errors.join('|'));
await browser.close(); server.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
