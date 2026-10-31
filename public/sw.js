/* SHERZ service worker — push notifications only (no caching, so it can never serve a stale app). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'SHERZ';
  event.waitUntil((async () => {
    // the app is open and in front → the message is already on screen (live connection); a notification would only double it
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!(d.data && d.data.force) && wins.some((c) => c.visibilityState === 'visible' && c.focused)) return;   // (the test button forces it)
    await self.registration.showNotification(title, {
      body: d.body || '', tag: d.tag || 'sherz', renotify: false, data: { url: d.url || '/' },
      icon: '/icon-192.png', badge: '/favicon-32.png',
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((c) => c.url.startsWith(self.location.origin));
    if (open) { await open.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
