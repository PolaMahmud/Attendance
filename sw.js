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

/* Leave a note about how the last push went.

   A worker has nowhere to report to: no console anyone will read, no screen of its own.
   So when a notification arrives saying nothing useful, there was no way to tell whether
   it never had its config, or the fetch was refused, or the server simply had nothing
   waiting — three different faults that looked identical from the outside. This is
   written to the same cache the config lives in, and ?notify=1 reads it back out. */
function note(why) {
  return caches.open(CFG).then(function (c) {
    return c.put('last', new Response(JSON.stringify({ at: Date.now(), why: why })));
  }).catch(function () {});
}

self.addEventListener('push', function (e) {
  e.waitUntil(config().then(function (cfg) {
    /* A push MUST end in a visible notification. If it does not, the browser posts its
       own "This site has been updated in the background", which is worse than anything
       we would have said. So every path below shows something. */
    if (!cfg || !cfg.url || !cfg.key) {
      return note('no-config').then(function () {
        return self.registration.showNotification('Attendance', {
          body: 'This device has not finished setting up — open the app once.',
          icon: './icon-192.png', tag: 'attendance'
        });
      });
    }
    return fetch(cfg.url + (cfg.url.indexOf('?') === -1 ? '?' : '&') +
                 'push=1&k=' + encodeURIComponent(cfg.key), { redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) return { __why: 'http-' + r.status };
        return r.json().catch(function () { return { __why: 'not-json' }; });
      })
      .catch(function (err) {
        // Nearly always CORS or the network. Either way we never saw a response.
        return { __why: 'blocked: ' + String((err && err.message) || err).slice(0, 60) };
      })
      .then(function (msg) {
        var why = msg && msg.title ? 'ok' : (msg && msg.__why) || 'nothing-waiting';
        var m = msg && msg.title ? msg : {
          title: 'Attendance',
          body: why === 'nothing-waiting'
            ? 'Open the app to see what changed.'
            : 'Could not fetch the message — open the app.'
        };
        return note(why).then(function () {
          return self.registration.showNotification(m.title, {
            body: m.body || '',
            icon: './icon-192.png',
            badge: './favicon-32.png',
            // One tag, so an unread reminder is replaced rather than stacked three deep.
            tag: 'attendance',
            renotify: true,
            /* Two short buzzes, so this is recognisable in a pocket without looking.
               There is no way to ask for a custom SOUND: the Notification API's `sound`
               option was dropped from the spec and no browser implements it, a service
               worker has no audio API, and the tone that plays belongs to the browser's
               own notification channel, which a web page cannot configure. Vibration is
               the one part of how this feels that we are allowed to choose. Android
               honours it; iOS ignores it rather than failing. */
            vibrate: [120, 60, 120],
            data: { open: (cfg.app || './') + (m.url || '') }
          });
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
