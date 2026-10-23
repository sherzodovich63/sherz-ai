const { chromium } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const { server, state, port } = await startMock('public');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let pass=0, fail=0; const ok=(n,c,x='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n} ${x}`)};
const USER = mkJwt({ id:'user_1', name:'B', email:'b@e.com', exp: Math.floor(Date.now()/1000)+3600 });
async function open(locale){
  const ctx = await browser.newContext({ viewport:{width:1280,height:900}, locale });
  await ctx.route(/^https?:\/\/(?!localhost)/, r=>r.abort());
  await ctx.addInitScript(t=>{ if(!localStorage.getItem('sherz_token')) localStorage.setItem('sherz_token', t); }, USER);
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(`http://localhost:${port}/`); await page.waitForTimeout(900); return { ctx, page, errs };
}
const txt = (p, sel) => p.$eval(sel, e=>e.textContent.trim()).catch(()=>null);
let { ctx, page, errs } = await open('ru-RU');
ok('device ru → <html lang=ru>', await page.evaluate(()=>document.documentElement.lang)==='ru');
ok('placeholder translated', /Опишите задачу|Спросите|О чём думаешь|Расскажи|Что сегодня|Есть проблема|Просто поговорим/.test(await page.getAttribute('#text','placeholder')), await page.getAttribute('#text','placeholder'));
const body = await page.evaluate(()=>document.body.textContent);
ok('sidebar Projects → Проекты', /Проекты/.test(body));
// open the hub & switch to Uzbek
await page.evaluate(()=>{ const h=document.getElementById('menuHub'); if(h) h.hidden=false; });
await page.evaluate(()=>document.querySelector('[data-lang-pref="uz"]').click()); await page.waitForTimeout(300);
ok('manual uz overrides device', await page.evaluate(()=>document.documentElement.lang)==='uz' && await page.evaluate(()=>localStorage.getItem('sherz_lang'))==='uz');
ok('placeholder now Uzbek', /Vazifani|Istalgan|Nima o|Ichingdagini|Bugun nimalar|Bir muammo|Shunchaki/.test(await page.getAttribute('#text','placeholder')), await page.getAttribute('#text','placeholder'));
ok('html fragment translated', /Loyiha ichida SHERZ/.test(await page.evaluate(()=>document.querySelector('.pf-hint').textContent)));
// chat bubbles & user data are never translated
await page.evaluate(()=>{ const log=document.getElementById('log'); const d=document.createElement('div'); d.className='msg user'; d.innerHTML='<div class="bubble">Projects</div>'; d.id='probe'; log.appendChild(d); });
await page.waitForTimeout(200);
ok('a chat bubble saying "Projects" is untouched', await txt(page,'#probe')==='Projects', await txt(page,'#probe'));
// the language is sent with chat
await page.evaluate(()=>{ document.getElementById('composerShell').classList.remove('collapsed'); });
await page.fill('#text','salom'); await page.press('#text','Enter'); await page.waitForTimeout(900);
const sent = await page.evaluate(()=>window.SherzI18n.lang);
ok('SherzI18n.lang = uz', sent==='uz');
const sentBody = JSON.stringify(state.log.filter(e=>e.said==='salom').pop()||{}); const last = state.log.filter(e=>e.said==='salom').pop();
ok('chat request carried the language', !!last && (last.lang==='uz' || last.ui?.lang==='uz' || /"uz"/.test(sentBody)), sentBody.slice(0,200));
page.on('request',()=>{});
// switch to English and Auto
await page.evaluate(()=>document.querySelector('[data-lang-pref="en"]').click()); await page.waitForTimeout(300);
ok('en placeholder', /Describe the task|Ask anything|mind|listening|happened|problem|just talk/.test(await page.getAttribute('#text','placeholder')));
ok('en picker marked', await page.getAttribute('[data-lang-pref="en"]','aria-checked')==='true');
await page.evaluate(()=>document.querySelector('[data-lang-pref="auto"]').click()); await page.waitForTimeout(300);
ok('auto → back to device ru', await page.evaluate(()=>document.documentElement.lang)==='ru' && await page.evaluate(()=>localStorage.getItem('sherz_lang'))===null);
const note = async () => page.evaluate(() => { const e = document.querySelector('.ai-note'); const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return { t: e.textContent, align: getComputedStyle(e).textAlign, vis: r.height > 0, cx: Math.round(r.left + r.width / 2), px: Math.round(p.left + p.width / 2) }; });
await page.evaluate(()=>document.querySelector('[data-lang-pref="ru"]').click()); await page.waitForTimeout(200);
let nt = await note(); ok('notice RU', nt.t === 'SHERZ — это ИИ. Он может ошибаться.' && nt.vis && nt.align === 'center', JSON.stringify(nt));
await page.evaluate(()=>document.querySelector('[data-lang-pref="uz"]').click()); await page.waitForTimeout(200);
nt = await note(); ok('notice UZ', nt.t === 'SHERZ — bu AI. U xato qilishi mumkin.', nt.t);
await page.evaluate(()=>document.querySelector('[data-lang-pref="en"]').click()); await page.waitForTimeout(200);
nt = await note(); ok('notice EN, centred under the composer', nt.t === 'SHERZ is AI and can make mistakes.' && Math.abs(nt.cx - nt.px) <= 2, JSON.stringify(nt));
ok('keyboard hints are gone', !(await page.$('.kbd-row')) && !/Shift/.test(await page.evaluate(()=>document.querySelector('.dock, footer, body').textContent.slice(0,0)+document.body.innerText)));
await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(200);
ok('visible on a phone too', (await note()).vis);
await page.setViewportSize({ width: 1280, height: 900 });
ok('no page errors', errs.length===0, errs.join('|'));
await page.screenshot({ path:'shots/i18n-ru.png' });
await ctx.close();
({ ctx, page, errs } = await open('fr-FR'));
ok('unknown device language → en', await page.evaluate(()=>document.documentElement.lang)==='en');
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
