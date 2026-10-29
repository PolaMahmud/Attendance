/* Service worker for KS5 Hub. Goes beside index.html on GitHub Pages.
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
self.addEventListener('activate', function (e) {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    /* Lets a page load start on the network while this worker wakes, so answering page
       loads below costs no time. */
    self.registration.navigationPreload ? self.registration.navigationPreload.enable() : null
  ]));
});

/* Page loads, and only page loads. Chrome on Android offers Install only to a site whose
   worker answers them, so this is here for installing, not caching: a load still goes to
   the network exactly as before, and the one thing added is a plain offline page in place
   of the browser's own error when there is no network at all. Nothing is stored. */
/* Drawn as the app draws a page that could not load (its empty state, W13): the
   crossed-out signal in a soft red tile, the words, and Try again as the app's primary
   button; in the app's own colours, dark when the phone (or the person's choice, kept by
   index.html on this same origin) is dark, so an installed app opened in the dark does not
   flash white. Colours only in the two token blocks, as everywhere. */
var OFFLINE = '<!doctype html><html lang="en"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<meta name="color-scheme" content="light dark"><title>KS5 Hub</title>' +
  '<script>try{var t=localStorage.getItem("attendance-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>' +
  '<style>' +
  ':root{--bg:#F3F2F7;--ink:#1F2330;--ink-2:#6B6F7B;--full:#9B2F35;--full-soft:#F7DADA;--full-line:#EDBDBD;' +
    '--btn:#1F2330;--btn-ink:#FFFFFF;color-scheme:light}' +
  '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#000000;--ink:#F2F2F7;--ink-2:#AEAEB2;' +
    '--full:#F0B1B1;--full-soft:#3E2527;--full-line:#5E393B;--btn:#F2F2F7;--btn-ink:#1C1C1E;color-scheme:dark}}' +
  ':root[data-theme="dark"]{--bg:#000000;--ink:#F2F2F7;--ink-2:#AEAEB2;--full:#F0B1B1;--full-soft:#3E2527;' +
    '--full-line:#5E393B;--btn:#F2F2F7;--btn-ink:#1C1C1E;color-scheme:dark}' +
  'html{font-size:106.25%;-webkit-text-size-adjust:100%}' +
  '@supports (font:-apple-system-body) and (-webkit-touch-callout:none){html{font:-apple-system-body}}' +
  'body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;box-sizing:border-box;' +
    'padding:24px max(20px,env(safe-area-inset-right)) 24px max(20px,env(safe-area-inset-left));' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;' +
    'background:var(--bg);color:var(--ink);text-align:center;-webkit-font-smoothing:antialiased}' +
  'i{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 12px;border-radius:16px;' +
    'background:var(--full-soft);box-shadow:inset 0 0 0 1px var(--full-line);color:var(--full)}' +
  'svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
  'b{display:block;font-size:1rem;font-weight:700;letter-spacing:-.02em;margin-bottom:5px}' +
  'p{margin:0 0 18px;font-size:calc(15rem / 17);line-height:1.5;color:var(--ink-2)}' +
  'button{font:inherit;font-size:calc(15rem / 17);font-weight:600;min-height:44px;padding:11px 22px;border:0;' +
    'border-radius:99px;background:var(--btn);color:var(--btn-ink);cursor:pointer}' +
  '</style><body><div role="alert">' +
  '<i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/>' +
    '<path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/><path d="M3 3l18 18"/></svg></i>' +
  '<b>No connection</b><p>KS5 Hub opens when you are back online.</p>' +
  '<button type="button" onclick="location.reload()">Try again</button></div>';
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(Promise.resolve(e.preloadResponse).then(function (r) {
    return r || fetch(e.request);
  }).catch(function () {
    return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});

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
        return self.registration.showNotification('KS5 Hub', {
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
          title: 'KS5 Hub',
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
  // A notification can name a tab (?tab=grades for new marks); the page opens it.
  var tab = (String(target).match(/[?&]tab=(plan|res|grades)(?:&|$)/) || [])[1] || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (list) {
      // Focus the app if it is already open rather than opening a second copy of it —
      // and, when the notification is about a tab, ask the open page to go to it.
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) {
          if (tab) try { list[i].postMessage({ type: 'attendance:open-tab', v: 1, tab: tab }); } catch (err) {}
          return list[i].focus();
        }
      }
      return self.clients.openWindow(target);
    }));
});
