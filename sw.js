/* Service worker for KS5 Hub. Goes beside index.html on GitHub Pages.
 *
 * Two jobs. It receives a push and shows a notification. And it keeps the wrapper itself
 * (index.html, the manifest and the icons) on the device, so the installed app opens from
 * the phone in its first frame instead of waiting on GitHub Pages, and opens at all with
 * no signal: the wrapper then paints its own kept screen and kept app (invariants 35, 41).
 *
 * What it does NOT keep is anything with data in it. The app and every answer come from
 * Apps Script, in the wrapper's frame, on an origin this worker never sees; the wrapper
 * keeps those copies itself, per person, and clears them on sign-out. A second copy of the
 * data living here is the classic way a web app starts showing yesterday's figures with no
 * way to clear them.
 *
 * The wrapper is served from the device and fetched again behind it on every open (stale
 * while revalidate): a new index.html is used from the open after the one that fetched it,
 * exactly as the kept app takes a new build. Bump SHELL to drop every kept file at once.
 *
 * Pushes arrive with no payload. Encrypting one needs ECDH, HKDF and AES-128-GCM, and
 * Apps Script has no AES — so the text is fetched here instead, addressed by a device
 * key this worker was handed at subscribe time. The key identifies a device, not a
 * person: it cannot open the app, read a register, or be used to sign in.
 */

var CFG = 'push-config-v1';
var SHELL = 'ks5-shell-v1';
/* The page is kept under the scope's own address whatever was on the URL (a sign-in link's
   ?t=, ?tab=, ?admin=1): it is one file, and a token must never end up in a cache key. */
var PAGE = './';
var ASSETS = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './apple-touch-icon.png', './favicon-32.png'];

function keepAll(c) {
  // One missing icon must not stop the rest being kept, or the worker installing.
  return Promise.all([PAGE].concat(ASSETS).map(function (u) {
    return fetch(u, { cache: 'reload' }).then(function (r) { if (r && r.ok) return c.put(u, r); })
      .catch(function () {});
  }));
}

/* Take over as soon as we are installed, so the first notification does not have to
   wait for every tab to close. The wrapper and icons are kept while installing, so the
   very next open is already from the device. */
self.addEventListener('install', function (e) {
  self.skipWaiting();
  if (e && e.waitUntil) e.waitUntil(caches.open(SHELL).then(keepAll).catch(function () {}));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    /* Lets a page load start on the network while this worker wakes, so the fetch made
       behind a kept page costs no time. */
    self.registration.navigationPreload ? self.registration.navigationPreload.enable() : null,
    // An older SHELL's files go. The push config (CFG) is not ours to clear.
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('ks5-shell-') === 0 && k !== SHELL; })
        .map(function (k) { return caches.delete(k); }));
    }).catch(function () {})
  ]));
});

/* Drawn as the app draws a page that could not load (its empty state, W13): the
   crossed-out signal in a soft red tile, the words, and Try again as the app's primary
   button; in the app's own colours, dark when the phone (or the person's choice, kept by
   index.html on this same origin) is dark, so an installed app opened in the dark does not
   flash white. Colours only in the two token blocks, as everywhere. Only for a device that
   has never kept the wrapper: one that has opens on it, offline or not. */
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

function scopePath() {
  try { return new URL(self.registration.scope).pathname; } catch (e) { return '/'; }
}
/* Where under the scope a request is, as './name', the key it is kept under; null for
   anything on another origin or outside the scope. */
function rel(url) {
  var p = scopePath();
  if (url.origin !== self.location.origin || url.pathname.indexOf(p) !== 0) return null;
  return './' + url.pathname.slice(p.length);
}
function offline() {
  return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* Page loads: from the device at once when it has the wrapper, with the network asked
   behind it to keep that copy current; from the network (kept on the way through) when it
   has not; the offline page only when it has neither. Chrome on Android offers Install only
   to a site whose worker answers page loads, so this is also what keeps it installable.
   The icons and manifest: from the device, from the network the first time. Everything
   else (above all, anything on Apps Script's origins) is left alone. */
self.addEventListener('fetch', function (e) {
  var req = e.request, url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (req.method && req.method !== 'GET') return;
  var at = rel(url);
  if (req.mode === 'navigate') {
    if (at !== './' && at !== './index.html') return;
    var fresh = Promise.resolve(e.preloadResponse).then(function (r) { return r || fetch(req); })
      .then(function (r) {
        if (!r || !r.ok || r.redirected) return r;
        var copy = r.clone();
        return caches.open(SHELL).then(function (c) { return c.put(PAGE, copy); })
          .catch(function () {}).then(function () { return r; });
      });
    e.respondWith(caches.open(SHELL).then(function (c) { return c.match(PAGE); }).catch(function () { return null; })
      .then(function (hit) {
        if (hit) {
          // Kept: shown now. The network's answer only updates the copy, for next time.
          if (e.waitUntil) e.waitUntil(fresh.catch(function () {}));
          else fresh.catch(function () {});
          return hit;
        }
        return fresh.then(function (r) { return r || offline(); }).catch(offline);
      }));
    return;
  }
  if (at && ASSETS.indexOf(at) !== -1) {
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(at).then(function (hit) {
        return hit || fetch(req).then(function (r) {
          if (r && r.ok) { var copy = r.clone(); c.put(at, copy).catch(function () {}); }
          return r;
        });
      });
    }).catch(function () { return fetch(req); }));
  }
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
