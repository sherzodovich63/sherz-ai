import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { injectConfig, syncWeb, OUT, API_SHIM } from './sync-web.mjs';

test('injectConfig: settings go first inside <head>, once, with a clean backend URL', () => {
  const a = injectConfig('<!doctype html><html><head>\n<meta charset="utf-8"><script>var x=1</script></head><body></body></html>', { api: 'https://api.example.com///', push: true });
  assert.match(a, /<head>\s*<script data-sherz-native>window\.SHERZ_NATIVE=true;window\.SHERZ_API_URL="https:\/\/api\.example\.com";window\.SHERZ_PUSH=true;\(function\(\)\{var A=/);
  const b = injectConfig(a, { api: 'https://other.example' });
  assert.equal((b.match(/data-sherz-native/g) || []).length, 1, 'running it twice never doubles the tag');
  assert.match(b, /other\.example/); assert.match(b, /SHERZ_PUSH=false/);
  assert.throws(() => injectConfig('<html></html>'), /no <head>/);
});
test('API shim: relative backend calls are sent to the real backend, static files are not', () => {
  const win = { SHERZ_API_URL: 'https://api.example', seen: [], fetch(i) { this.seen.push(String(i)); return 'ok'; }, EventSource: class { constructor(u) { this.u = u; } }, location: { origin: 'app://sherz' } };
  new Function('window', 'location', 'Request', 'URL', API_SHIM)(win, win.location, undefined, URL);
  for (const u of ['/api/chat', '/api/auth/dev-token', '/health', '/api/stream?userId=1', '/admin/status']) win.fetch(u);
  win.fetch('/i18n.js'); win.fetch('https://other.example/api/x'); win.fetch('/apiary.png');
  assert.deepEqual(win.seen, ['https://api.example/api/chat', 'https://api.example/api/auth/dev-token', 'https://api.example/health', 'https://api.example/api/stream?userId=1', 'https://api.example/admin/status', '/i18n.js', 'https://other.example/api/x', '/apiary.png']);
  assert.equal(new win.EventSource('/api/stream?u=1').u, 'https://api.example/api/stream?u=1');
  assert.equal(new win.EventSource('https://x/y').u, 'https://x/y');
});
test('syncWeb warns loudly when public/index.html is not the SHERZ chat page', () => {
  const tmp = fs.mkdtempSync('/tmp/sw-'); fs.writeFileSync(`${tmp}/index.html`, '<!doctype html><html><head><title>SHERZ AI</title></head><body><div id="app"></div><script src="native.js"></script><script src="script.js"></script></body></html>');
  const r = syncWeb({ api: 'https://x.example', src: tmp });
  assert.ok(r.warn.some((w) => /NOT the SHERZ chat page/.test(w)), r.warn.join('|'));
  assert.ok(r.warn.some((w) => /native\.js/.test(w)));
  fs.rmSync(OUT, { recursive: true, force: true });
});
test('syncWeb: the real web app is copied and ready for the apps', () => {
  const r = syncWeb({ api: 'https://x.example' });
  const html = fs.readFileSync(`${OUT}/index.html`, 'utf8');
  assert.ok(fs.existsSync(`${OUT}/i18n.js`) && fs.existsSync(`${OUT}/native.js`) && fs.existsSync(`${OUT}/sherz-modern.css`));
  assert.match(html, /window\.SHERZ_API_URL="https:\/\/x\.example"/);
  assert.match(html, /src="\/native\.js"/); assert.deepEqual(r.warn, []);
  fs.rmSync(OUT, { recursive: true, force: true });
});
