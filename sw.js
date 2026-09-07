/* Service worker for KS5 Attendance. Goes beside index.html on GitHub Pages.
 *
 * It exists for one job: receive a push and show a notification. It deliberately does
 * NOT cache the app — attendance.html already paints its own cached first screen out
 * of localStorage, and a second, stale copy of the app living in a service worker is
 * the classic way a web app starts showing yesterday's data with no way to clear it.
 *
 * Pushes arrive with no payload. Encrypting one needs ECDH, HKDF and AES-128-GCM, and
 * Apps Script has no AES — so the text is fetched here instead, addressed by a device
 * key this worker was handed at subscribe time. The key identifies a device, not a
 * person: it cannot open the app, read a register, or be used to sign in.
 */

var CFG = 'push-config-v1';

/* Take over as soon as we are installed, so the first notification does not have to
   wait for every tab to close. */
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

/* The page tells us where to ask and who to say we are. Kept in the Cache API rather
   than IndexedDB: two lines instead of twenty, and it survives restarts just as well. */
self.addEventListener('message', function (e) {
  var m = e.data;
  if (!m || m.type !== 'attendance:push-config') return;
  e.waitUntil(caches.open(CFG).then(function (c) {
    return c.put('config', new Response(JSON.stringify({ url: m.url, key: m.key, app: m.app })));
  }));
});

function config() {
  return caches.open(CFG).then(function (c) { return c.match('config'); })
    .then(function (r) { return r ? r.json() : null; })
    .catch(function () { return null; });
}

self.addEventListener('push', function (e) {
  e.waitUntil(config().then(function (cfg) {
    /* A push MUST end in a visible notification. If it does not, the browser posts its
       own "This site has been updated in the background", which is worse than anything
       we would have said. So every path below shows something. */
    if (!cfg || !cfg.url || !cfg.key) {
      return self.registration.showNotification('Attendance', {
        body: 'Open the app to see what changed.', icon: './icon-192.png', tag: 'attendance'
      });
    }
    return fetch(cfg.url + (cfg.url.indexOf('?') === -1 ? '?' : '&') +
                 'push=1&k=' + encodeURIComponent(cfg.key), { redirect: 'follow' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (msg) {
        var m = msg && msg.title ? msg : { title: 'Attendance', body: 'Open the app to see what changed.' };
        return self.registration.showNotification(m.title, {
          body: m.body || '',
          icon: './icon-192.png',
          badge: './favicon-32.png',
          // One tag, so an unread reminder is replaced rather than stacked three deep.
          tag: 'attendance',
          renotify: true,
          data: { open: (cfg.app || './') + (m.url || '') }
        });
      });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.open) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (list) {
      // Focus the app if it is already open rather than opening a second copy of it.
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) {
          return list[i].focus();
        }
      }
      return self.clients.openWindow(target);
    }));
});
