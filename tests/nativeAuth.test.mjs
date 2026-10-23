import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_ORIGINS, isNativeOrigin, isNativeState, nativeRedirectUrl, parseNativeAuthUrl, nativeHandoffHtml } from '../lib/nativeAuth.js';
import { buildAuthUrl } from '../lib/googleOAuthConfig.js';

test('native origins: the three app origins are trusted, look-alikes are not', () => {
  for (const o of NATIVE_ORIGINS) assert.ok(isNativeOrigin(o));
  for (const o of ['https://localhost.evil.com', 'http://localhost', 'app://sherz.evil', 'capacitor://localhost:1', '', null]) assert.equal(isNativeOrigin(o), false, String(o));
});
test('Google sign-in from an app: state=native goes out and comes back; normal logins are untouched', () => {
  const withState = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'https://x/cb', state: 'native' }));
  assert.equal(withState.searchParams.get('state'), 'native');
  assert.equal(new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'https://x/cb' })).searchParams.has('state'), false);
  assert.ok(isNativeState('native')); assert.equal(isNativeState('x'), false); assert.equal(isNativeState(undefined), false);
});
test('hand-back URL: round trip, errors, and only sherz://auth is accepted', () => {
  const u = nativeRedirectUrl({ token: 'a.b.c', name: 'Ali Valiyev' });
  assert.match(u, /^sherz:\/\/auth\?/);
  assert.deepEqual(parseNativeAuthUrl(u), { token: 'a.b.c', name: 'Ali Valiyev', error: '' });
  assert.equal(parseNativeAuthUrl(nativeRedirectUrl({ error: 'access_denied' })).error, 'access_denied');
  for (const bad of ['https://auth?token=x', 'sherz://evil?token=x', 'javascript:alert(1)', 'nonsense', '']) assert.equal(parseNativeAuthUrl(bad), null, bad);
});
test('hand-off page: no script (CSP), escapes the URL, has the button fallback', () => {
  const html = nativeHandoffHtml('sherz://auth?token=a"><script>x</script>&name=b');
  assert.doesNotMatch(html, /<script/i); assert.match(html, /http-equiv="refresh"/); assert.match(html, /<a href="sherz:\/\/auth/); assert.doesNotMatch(html, /token=a"><script>/);
});
