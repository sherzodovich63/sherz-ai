import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { injectConfig, syncWeb, OUT } from './sync-web.mjs';

test('injectConfig: settings go first inside <head>, once, with a clean backend URL', () => {
  const a = injectConfig('<!doctype html><html><head>\n<meta charset="utf-8"><script>var x=1</script></head><body></body></html>', { api: 'https://api.example.com///', push: true });
  assert.match(a, /<head>\s*<script data-sherz-native>window\.SHERZ_NATIVE=true;window\.SHERZ_API_URL="https:\/\/api\.example\.com";window\.SHERZ_PUSH=true;<\/script>/);
  const b = injectConfig(a, { api: 'https://other.example' });
  assert.equal((b.match(/data-sherz-native/g) || []).length, 1, 'running it twice never doubles the tag');
  assert.match(b, /other\.example/); assert.match(b, /SHERZ_PUSH=false/);
  assert.throws(() => injectConfig('<html></html>'), /no <head>/);
});
test('syncWeb: the real web app is copied and ready for the apps', () => {
  const r = syncWeb({ api: 'https://x.example' });
  const html = fs.readFileSync(`${OUT}/index.html`, 'utf8');
  assert.ok(fs.existsSync(`${OUT}/i18n.js`) && fs.existsSync(`${OUT}/native.js`) && fs.existsSync(`${OUT}/sherz-modern.css`));
  assert.match(html, /window\.SHERZ_API_URL="https:\/\/x\.example"/);
  assert.match(html, /src="\/native\.js"/); assert.deepEqual(r.warn, []);
  fs.rmSync(OUT, { recursive: true, force: true });
});
