/* The loading screen: what someone sees while signing in, or on any open with nothing
 * cached to paint.
 *
 * Runs the real wrapper in jsdom. The frame never loads anything here (jsdom fetches no
 * subresources), so every event the screen follows is raised by hand — which is the
 * point: the stages must move on those events and on nothing else.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { reporter, SRC } = require('./harness.js');

const ok = reporter();
const html = fs.readFileSync(SRC('attendance.html'), 'utf8');
const TOKEN = 'tok123456';

function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(html, {
    url: 'https://school.github.io/attendance/' + (opts.query || ''),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      if (opts.token) w.localStorage.setItem('attendance-code', opts.token);
      Object.keys(opts.store || {}).forEach(k => w.localStorage.setItem(k, opts.store[k]));
      // The page warms Apps Script with a fetch; there is nothing to warm here.
      w.fetch = () => new Promise(() => {});
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, addEventListener() {} }));
    }
  });
  const w = dom.window, d = w.document;
  return { w, d, L: w.__LOAD, frame: () => d.getElementById('app') };
}
const shown = (d) => { const el = d.getElementById('load'); return !!el && !el.hidden && !el.classList.contains('gone'); };
const step = (d) => d.getElementById('loadStep').textContent;
const now = (d) => +d.getElementById('loadBar').getAttribute('aria-valuenow');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// A message from the app's window, as Apps Script's sandbox frame would send it.
const send = (w, data, source) => w.dispatchEvent(new w.MessageEvent('message', { data, source }));

async function main() {
  console.log('\n=== a first open from the link: nothing cached ===');
  {
    const { w, d, L, frame } = boot({ query: '?t=' + TOKEN });
    ok('the loading screen is up', shown(d));
    ok('it names the app', /KS5 Hub/.test(d.getElementById('loadTitle').textContent));
    ok('it covers the skeleton rather than sitting beside it',
       d.getElementById('shell').compareDocumentPosition(d.getElementById('load')) & 4);
    ok('the frame has been asked for, and it says so', !!frame() && L.stage() === 1 && /Connecting/.test(step(d)), step(d));
    const p1 = now(d);
    await wait(800);
    ok('between events it creeps, so it never looks stuck', now(d) > p1, p1 + ' -> ' + now(d));
    ok('...but never past the stage it is in', L.pct() <= 52);

    frame().onload && frame().onload();
    ok('the frame loading moves it on', L.stage() === 2 && /Starting/.test(step(d)), step(d));
    const app = frame().contentWindow;
    send(w, { type: 'attendance:tabs', v: 1, h: 0 }, app);
    ok('the app speaking for the first time moves it on again', L.stage() === 3 && /day/.test(step(d)), step(d));
    ok('and still short of full', now(d) < 100, now(d));
    send(w, { type: 'attendance:tabs', v: 1, h: 0 }, null);
    ok('a message from nowhere does not count', L.stage() === 3);

    send(w, 'attendance:ready', app);
    ok('attendance:ready fills it', now(d) === 100 && !L.on(), now(d));
    ok('the app is revealed over it', frame().classList.contains('ready'));
    await wait(750);
    ok('and it goes away', !shown(d) && d.getElementById('load').hidden);
    ok('the token left the address bar as before', !/t=/.test(w.location.search));
    w.close();
  }

  console.log('\n=== stages only move forward ===');
  {
    const { w, d, L, frame } = boot({ token: TOKEN });
    ok('a stored token with no cache also gets it', shown(d));
    const app = frame().contentWindow;
    send(w, { type: 'attendance:theme', v: 1, theme: 'nope' }, app);
    const at = L.stage();
    frame().onload && frame().onload();
    ok('a load event after the app spoke does not step back', L.stage() === at && at === 3, String(L.stage()));
    w.close();
  }

  console.log('\n=== a cached screen paints: no loading screen ===');
  {
    const stu = JSON.stringify({ type: 'attendance:student', v: 1, at: Date.now(),
      totals: { total: 40, rate: 0.95, present: 38, late: 1, absent: 1 }, subjects: [] });
    const { d, L } = boot({ token: TOKEN, store: { ['attendance-stu:' + TOKEN]: stu } });
    ok('the student summary is on screen', d.getElementById('instant').style.display === 'block');
    ok('and the loading screen is not', !shown(d) && !L.on());
    d.defaultView.close();

    const today = new Date();
    const iso = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    const snap = { v: 1, meta: { school: 'Sixth Form', teacher: { name: 'A Teacher' } }, days: {} };
    snap.days[iso] = { savedAt: Date.now(), lessons: [{ classId: 'C1', period: '1', subject: 'Maths', label: '12A', time: '09:00' }] };
    const t = boot({ token: TOKEN, store: { ['attendance-snap:' + TOKEN]: JSON.stringify(snap) } });
    ok('the cached register is on screen', t.d.getElementById('instant').style.display === 'block');
    ok('and the loading screen is not over it', !shown(t.d) && !t.L.on());
    t.w.close();
  }

  console.log('\n=== a link asking for another screen has nothing to paint ===');
  {
    const { d, w } = boot({ query: '?t=' + TOKEN + '&view=students' });
    ok('it gets the loading screen', shown(d));
    w.close();
  }

  console.log('\n=== nobody signed in ===');
  {
    const { d, w } = boot({});
    ok('the sign-in card shows, and no loading screen under it', d.getElementById('ask').style.display === 'grid' && !shown(d));
    d.getElementById('code').value = TOKEN;
    d.getElementById('askForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    ok('signing in swaps the card for the loading screen',
       d.getElementById('ask').style.display === 'none' && shown(d) && /Connecting|Signing/.test(step(d)), step(d));
    w.close();
  }

  console.log('\n=== the frame never says it is ready ===');
  {
    const { d, w, L, frame } = boot({ token: TOKEN });
    frame().onload && frame().onload();
    // The existing fallback after the frame loads: reveal at 3.5s without attendance:ready.
    await wait(3700);
    ok('the fallback reveal still happens', frame().classList.contains('ready'));
    ok('and the loading screen steps aside without claiming 100%', !L.on() && now(d) < 100, now(d));
    await wait(750);
    ok('leaving the frame (and the stuck bar, if it comes) on top', !shown(d));
    w.close();
  }

  console.log('\n=== the page ===');
  {
    ok('the bar is a real progressbar', /id="loadBar" role="progressbar"[^>]*aria-valuemax="100"/.test(html));
    ok('it sits on the skeleton\'s layer, below the frame and the bars',
       /\.load\{position:fixed;inset:0;z-index:1;/.test(html));
    ok('colours come from the theme tokens only',
       !/#[0-9A-Fa-f]{3,6}/.test((html.match(/\.load\{[\s\S]*?\.lmeta\{[^}]*\}/) || [''])[0]));
    ok('reduced motion still stops its transitions (the global rule)',
       /prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{animation:none !important;transition:none !important\}/.test(html));
  }

  ok.done();
}
main();
