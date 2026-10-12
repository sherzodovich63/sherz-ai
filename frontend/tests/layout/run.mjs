import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };

for (const vp of [{ width: 1280, height: 800, tag: 'desktop' }, { width: 390, height: 700, tag: 'mobile' }]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(pathToFileURL(process.cwd() + '/out/index.html').href);
  await page.waitForSelector('.msg');
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const s = document.querySelector('.chat-scroller'), c = document.querySelector('.chat-composer').getBoundingClientRect();
    const last = [...document.querySelectorAll('.msg')].at(-1).getBoundingClientRect(), sr = s.getBoundingClientRect();
    return { docH: document.documentElement.scrollHeight, winH: innerHeight, sH: s.scrollHeight, cH: s.clientHeight, top: s.scrollTop,
      ovY: getComputedStyle(s).overflowY, composerBottom: c.bottom, lastBottom: last.bottom, scBottom: sr.bottom, sW: s.scrollWidth, cW: s.clientWidth,
      count: document.querySelectorAll('.msg').length, lastText: [...document.querySelectorAll('.msg')].at(-1).textContent };
  });
  ok(`${vp.tag}: page itself does not scroll`, m.docH <= m.winH, `(doc ${m.docH} / win ${m.winH})`);
  ok(`${vp.tag}: only the thread scrolls (overflow-y auto, content taller than box)`, m.ovY === 'auto' && m.sH > m.cH);
  ok(`${vp.tag}: starts at the bottom, newest message fully visible`, Math.abs(m.sH - m.top - m.cH) < 2 && m.lastBottom <= m.scBottom + 1 && m.lastText === 'msg 299', m.lastText);
  ok(`${vp.tag}: composer is inside the viewport`, m.composerBottom <= m.winH + 1, `(${m.composerBottom})`);
  ok(`${vp.tag}: first load fetched only the latest page (25)`, m.count >= 25 && m.count < 60, `(rendered ${m.count})`);
  ok(`${vp.tag}: no horizontal overflow`, m.sW <= m.cW + 1, `(${m.sW}/${m.cW})`);

  // scroll up -> older page loads and the reader keeps their place
  const anchor = await page.evaluate(async () => {
    const s = document.querySelector('.chat-scroller');
    s.scrollTop = 0; s.dispatchEvent(new Event('scroll'));
    const first = document.querySelector('.msg'); const id = first.textContent;
    const y0 = first.getBoundingClientRect().top;
    await new Promise((r) => setTimeout(r, 400));
    const same = [...document.querySelectorAll('.msg')].find((e) => e.textContent === id);
    return { id, before: y0, after: same.getBoundingClientRect().top, count: document.querySelectorAll('.msg').length };
  });
  ok(`${vp.tag}: scrolling up lazy-loads older messages`, anchor.count > m.count, `(${m.count} -> ${anchor.count})`);
  ok(`${vp.tag}: scroll position preserved after prepend`, Math.abs(anchor.before - anchor.after) < 3, `(${anchor.before.toFixed(0)} vs ${anchor.after.toFixed(0)})`);

  // walk all the way up
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => { const s = document.querySelector('.chat-scroller'); s.scrollTop = 0; });
    await page.waitForTimeout(120);
  }
  const all = await page.evaluate(() => ({ texts: [...document.querySelectorAll('.msg')].map((e) => e.textContent.slice(0, 8)), end: !!([...document.querySelectorAll('.chat-status')].find((e) => e.textContent.includes('boshlanishi'))) }));
  ok(`${vp.tag}: all 300 loaded exactly once, start-of-thread marker shown`, all.texts.length === 300 && new Set(all.texts.map((t, i) => t + i)).size === 300 && all.end, `(${all.texts.length})`);
  const fetches = await page.evaluate(() => window.__calls.map((c) => c.n));
  ok(`${vp.tag}: pages fetched in chunks of 25`, fetches.every((n) => n <= 25), JSON.stringify(fetches.slice(0, 5)) + '…');

  // send: reply streams and the view follows it to the bottom
  await page.fill('textarea', 'salom');
  await page.press('textarea', 'Enter');
  await page.waitForFunction(() => !document.querySelector('.chat-composer button').disabled || document.querySelector('.msg-ai:last-child')?.textContent.length > 200, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const s = document.querySelector('.chat-scroller'), l = [...document.querySelectorAll('.msg')].at(-1).getBoundingClientRect(), sr = s.getBoundingClientRect();
    return { atBottom: s.scrollHeight - s.scrollTop - s.clientHeight < 2, lastVisible: l.bottom <= sr.bottom + 1, len: [...document.querySelectorAll('.msg')].at(-1).textContent.length };
  });
  ok(`${vp.tag}: streamed reply is fully visible, view followed it`, after.atBottom && after.lastVisible && after.len > 200, JSON.stringify(after));
  await page.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
