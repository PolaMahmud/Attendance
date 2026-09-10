/* The week strip: the timetable card at the top of both panes, and the bar under it
   saying which lesson is running and how long is left.
   npm i jsdom && node strip.test.js

   Two halves, same as the feature: what the server puts in the payload, and what the
   page does with it. The client half renders App.html the way lens.test.js does — by
   substituting the template by hand — so the real module runs rather than a copy of it.

   The one thing worth stating up front, because it is the part that would rot in
   silence: the countdown is driven by the SCHOOL's clock, handed over as minutes since
   midnight, and the device's clock is only ever asked how much time has passed since
   that arrived. Every assertion here about "23 min" is really an assertion that the
   answer does not depend on where the phone thinks it is. */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { loadWith, reporter, SRC } = require('./harness.js');

const ok = reporter();

/* ─────────────────────────── the server half ─────────────────────────── */

const MON = '2026-08-24';                                   // a Monday
const FIX = {
  Teachers: [
    { TeacherID: 'T01', Teacher: 'Mr M', Email: 'm@s.uk', Role: 'Teacher', Token: 'tokM', _row: 2 },
    { TeacherID: 'T02', Teacher: 'Mr B', Email: 'b@s.uk', Role: 'Teacher', Token: 'tokB', _row: 3 },
    { TeacherID: 'T03', Teacher: 'Nobody', Email: 'n@s.uk', Role: 'Teacher', Token: 'tokN', _row: 4 }
  ],
  Timetable: [
    { Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Mon', Period: '1',
      Start: '09:00', End: '09:45', Room: 'C1', Options: 'IMP', _row: 2 },
    // No End on the sheet: it has to be filled from the lesson after it, and admit it.
    { Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Mon', Period: '2',
      Start: '10:00', End: '', Room: 'C1', Options: 'IMP', _row: 3 },
    { Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Mon', Period: '3',
      Start: '11:00', End: '11:45', Room: 'C1', Options: 'IMP', _row: 4 },
    { Teacher: 'Mr B', Year: '12', Subject: 'Physics', Day: 'Tue', Period: '2',
      Start: '10:00', End: '10:45', Room: 'P1', Options: 'IMP', _row: 5 },
    // Saturday is not a teaching day here, and this lesson still has to appear.
    { Teacher: 'Mr B', Year: '12', Subject: 'Physics', Day: 'Sat', Period: '1',
      Start: '09:00', End: '09:45', Room: 'P1', Options: 'IMP', _row: 6 }
  ],
  Students: [{ StudentID: 'P001', Name: 'Ada Byron', Year: '12', Option: 'IMP', Token: 'stuA', _row: 2 }],
  Settings: [
    { Setting: 'Timezone', Value: 'Europe/London' }, { Setting: 'School name', Value: 'Test Sixth' },
    { Setting: 'Teaching days', Value: 'Mon,Tue,Wed,Thu,Fri' },
    { Setting: 'Editing window', Value: 'Always open' },
    { Setting: 'Holidays', Value: '2026-08-26' }
  ],
  Leave: [], Track_Changes: [], Enrolment: []
};
const load = () => loadWith(FIX);
const dayOf = (tt, dow) => tt.days.filter(d => d.dow === dow)[0];

console.log('\n=== a teacher gets their own week ===');
{
  const { ctx } = load();
  const tt = ctx.apiBootstrap('tokM', MON, 0).timetable;
  ok('the card is there', !!tt && !!tt.days.length);
  const names = {};
  tt.days.forEach(d => d.lessons.forEach(l => { names[l.teacher] = true; }));
  ok('and holds nobody else\'s lessons', Object.keys(names).join() === 'Mr M', Object.keys(names).join());
  ok('Monday carries all three', dayOf(tt, 'Mon').lessons.length === 3);
  ok('in period order', dayOf(tt, 'Mon').lessons.map(l => l.period).join() === '1,2,3',
     dayOf(tt, 'Mon').lessons.map(l => l.period).join());
  ok('the week runs Mon to Fri', tt.days.map(d => d.dow).join() === 'Mon,Tue,Wed,Thu,Fri',
     tt.days.map(d => d.dow).join());
  ok('columns are numbered without gaps', tt.days.map(d => d.n).join() === '1,2,3,4,5',
     tt.days.map(d => d.n).join());
}

console.log('\n=== the days that get a column ===');
{
  const { ctx } = load();
  // Mr B teaches on Saturday, which Teaching days does not list.
  const tt = ctx.apiBootstrap('tokB', MON, 0).timetable;
  ok('a lesson outside the teaching days still gets one', !!dayOf(tt, 'Sat'),
     tt.days.map(d => d.dow).join());
  ok('and it carries the lesson', dayOf(tt, 'Sat').lessons.length === 1);
  ok('an empty teaching day is a column with nothing in it', dayOf(tt, 'Wed').lessons.length === 0);
  ok('the day numbers still run 1..n', tt.days.map(d => d.n).join() === '1,2,3,4,5,6',
     tt.days.map(d => d.n).join());

  /* A holiday is not a free period, and a teacher looking at Wednesday should not have
     to work out why it is empty. */
  const hol = ctx.apiBootstrap('tokM', MON, 0).timetable;
  ok('a holiday says so', dayOf(hol, 'Wed').holiday === 'Holiday', dayOf(hol, 'Wed').holiday);
}

console.log('\n=== a missing End time is filled, and admits it ===');
{
  const { ctx } = load();
  const mon = dayOf(ctx.apiBootstrap('tokM', MON, 0).timetable, 'Mon');
  const p2 = mon.lessons[1];
  ok('period 1 is exact', mon.lessons[0].s === 540 && mon.lessons[0].e === 585 && !mon.lessons[0].approx);
  ok('period 2 runs to period 3\'s start', p2.s === 600 && p2.e === 660, p2.s + '->' + p2.e);
  ok('and is flagged as approximate', p2.approx === true);
  ok('the last of the day falls back to 45 minutes',
     mon.lessons[2].e - mon.lessons[2].s === 45, String(mon.lessons[2].e - mon.lessons[2].s));
}

console.log('\n=== a student gets the classes they are actually on ===');
{
  const { ctx } = load();
  const r = ctx.apiStudentAll('stuA');
  const tt = r.timetable;
  ok('the strip rides with the record', !!tt);
  const teachers = {};
  tt.days.forEach(d => d.lessons.forEach(l => { teachers[l.teacher] = true; }));
  ok('both of their teachers are in it', Object.keys(teachers).sort().join() === 'Mr B,Mr M',
     Object.keys(teachers).sort().join());
  ok('it is not repeated per range', r.week.timetable === undefined && r.all.timetable === undefined);

  /* The strip is resolved exactly the way the register is. A student whose option code
     matches nothing must not be shown lessons they will never be marked on. */
  const { ctx: c2 } = loadWith(Object.assign({}, FIX, {
    Students: [{ StudentID: 'P002', Name: 'No Code', Year: '12', Option: '', Token: 'stuB', _row: 2 }]
  }));
  ok('no option code means no strip at all', c2.apiStudentAll('stuB').timetable === null,
     JSON.stringify(c2.apiStudentAll('stuB').timetable));
}

console.log('\n=== nothing to show is null, not an empty card ===');
{
  const { ctx } = load();
  const r = ctx.apiBootstrap('tokN', MON, 0);
  ok('a teacher with no lessons gets no strip', r.ok && r.timetable === null);
}

console.log('\n=== the clock is never served from the cache ===');
{
  /* The payload is cached for fifteen minutes. A "now" cached with it would be up to
     fifteen minutes wrong, which on a 45-minute lesson is the difference between "ends
     in five minutes" and the wrong lesson entirely. */
  const { ctx } = load();
  const first = ctx.apiBootstrap('tokM', MON, 0);
  ok('the first build carries a clock', !!first.clock && typeof first.clock.min === 'number');

  ctx._cache = {};                                   // a new execution; CacheService survives
  let asked = 0;
  const real = ctx.clock_;
  ctx.clock_ = function () { asked++; return real(); };
  const hit = ctx.apiBootstrap('tokM', MON, 0);      // served from CacheService
  ok('a cache hit is stamped with a fresh one', asked === 1, asked + ' call(s)');
  ok('and it is still a real time', hit.clock.min === real().min, JSON.stringify(hit.clock));
  ok('the strip came back with it', !!hit.timetable);

  /* And the stale one must not be what was stored, either — proving the field is
     rewritten rather than merely present. */
  ok('the clock is minutes since midnight, school time',
     hit.clock.min === Number(hit.clock.label.slice(0, 2)) * 60 + Number(hit.clock.label.slice(3)),
     hit.clock.label + ' / ' + hit.clock.min);
}

console.log('\n=== the Start column, in every shape Sheets returns it ===');
{
  /* Invariant 1, applied to times instead of dates. A time cell comes back as text, as
     a real Date, as a day fraction from the Sheets API batch read, or as the flattened
     string a Date turns into on its way through CacheService. Every one of those has to
     end up as the same countdown, or the strip silently runs on the wrong clock — which
     is precisely how lesson times once came out as 1899. */
  const shapes = {
    'plain text': '09:00',
    'a real Date': new Date(1899, 11, 30, 9, 0, 0),
    'a Sheets API day fraction': 0.375,
    'the form CacheService hands back': '1899-12-30 09:00:00',
    'a legacy cached ISO string': '1899-12-30T09:00:00.000Z'
  };
  Object.keys(shapes).forEach((how) => {
    const { ctx } = loadWith(Object.assign({}, FIX, {
      Timetable: [{ Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Mon', Period: '1',
                    Start: shapes[how], End: '09:45', Room: 'C1', Options: 'IMP', _row: 2 }]
    }));
    const l = dayOf(ctx.apiBootstrap('tokM', MON, 0).timetable, 'Mon').lessons[0];
    ok(how, l.s === 540 && l.start === '09:00', l.start + ' / ' + l.s);
  });
}

console.log('\n=== hhmm_ reads a time or refuses ===');
{
  const { ctx } = load();
  ok('09:15 -> 555', ctx.hhmm_('09:15') === 555);
  ok('9:05 -> 545', ctx.hhmm_('9:05') === 545);
  ok('a blank cell is null, not zero', ctx.hhmm_('') === null);
  ok('so is a room number', ctx.hhmm_('C1') === null);
  ok('and so is 25:00', ctx.hhmm_('25:00') === null);
}

/* ─────────────────────────── the client half ─────────────────────────── */

const raw = fs.readFileSync(SRC('App.html'), 'utf8');
const TODAY = '2026-09-10';                                 // a Thursday
const CLOCK = { date: TODAY, min: 9 * 60 + 37, label: '09:37' };
const shift = (k, d) => { const p = k.split('-'), x = new Date(+p[0], +p[1] - 1, +p[2], 12);
  x.setDate(x.getDate() + d);
  return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };

const slot = (classId, period, label, start, end) => ({
  classId, period, label, subject: label, start, end, room: 'C1', teacher: 'Mr M',
  s: +start.slice(0, 2) * 60 + +start.slice(3), e: +end.slice(0, 2) * 60 + +end.slice(3)
});
const TT = {
  from: shift(TODAY, -3), to: TODAY, label: '7 Sep – 10 Sep', hasToday: true,
  days: [
    { date: shift(TODAY, -3), dow: 'Mon', n: 1, label: '7 Sep', isToday: false, holiday: '',
      lessons: [slot('Y12-CHEM', '4', 'AS Chemistry', '11:00', '11:45')] },
    { date: shift(TODAY, -2), dow: 'Tue', n: 2, label: '8 Sep', isToday: false, holiday: 'Holiday',
      lessons: [] },
    { date: shift(TODAY, -1), dow: 'Wed', n: 3, label: '9 Sep', isToday: false, holiday: '', lessons: [] },
    { date: TODAY, dow: 'Thu', n: 4, label: '10 Sep', isToday: true, holiday: '',
      lessons: [slot('Y12-IT', '2', 'AS IT', '09:15', '10:00'),
                slot('Y12-CHEM', '4', 'AS Chemistry', '11:00', '11:45')] }
  ]
};

const lessonOn = (date) => TT.days.filter(d => d.date === date).map(d => d.lessons.map(l =>
  Object.assign({}, l, { taken: false, total: 2, leave: '', flagged: 0,
    students: [{ id: 'P001', name: 'Ada Byron', status: 'P', prev: '' },
               { id: 'P002', name: 'Bea Lovelace', status: 'P', prev: '' }] })))[0] || [];
const dayFor = (date) => ({
  date, dayName: 'Day', dateLabel: date, dayShort: 'Day ' + date, isToday: date === TODAY,
  editable: true, holiday: '', lessons: lessonOn(date)
});
const teacherPayload = (date, span) => {
  const days = [];
  for (let i = -span; i <= span; i++) days.push(dayFor(shift(date, i)));
  return { ok: true, teacher: { name: 'Mr M', admin: false, readOnly: false },
           school: 'Test Sixth', stamp: '1', today: TODAY, focus: date, build: 't', offline: false,
           clock: CLOCK, timetable: TT, days };
};

const record = (k) => ({
  ok: true, name: 'Ada Byron', year: '12', option: 'IMP', school: 'Test Sixth',
  range: { key: k, label: k === 'all' ? 'All time' : 'This week', from: shift(TODAY, -3), to: TODAY },
  today: TODAY, ever: 4, hasOption: true, stamp: '1',
  track: { current: 'IMP', floor: '', changes: [] },
  subjects: [{ label: 'AS IT', subject: 'IT', teacher: 'Mr M', dropped: false,
               present: 3, late: 0, absent: 1, total: 4, rate: 0.75 }],
  totals: { present: 3, late: 0, absent: 1, total: 4, rate: 0.75 },
  flags: []
});

function render(mode, boot) {
  const open = "<? if (mode !== 'report') { ?>", mid = '<? } else { ?>', end = '<? } ?>';
  const a = raw.indexOf(open), b = raw.indexOf(mid), c = raw.indexOf(end);
  if (a < 0 || b < 0 || c < 0) throw new Error('App.html template branches moved');
  const h = (raw.slice(0, a) + raw.slice(a + open.length, b) + raw.slice(c + end.length))
    .replace('<?= theme ?>', 'light').replace('<?= mode ?>', mode)
    .replace('<?= token ?>', 'tok').replace('<?!= boot ?>', JSON.stringify(boot))
    .replace('<?= vapid ?>', '');
  if (/<\?/.test(h)) throw new Error('unsubstituted scriptlet left in the template');
  return h;
}
/* `quiet` swallows the page's console output, for the one case where the page is
   MEANT to complain — a stack trace printed in the middle of a passing run reads as a
   failure to whoever runs this next. */
function boot(mode, payload, server, quiet) {
  const calls = [];
  const dom = new JSDOM(render(mode, payload), {
    url: 'https://script.google.com/macros/s/T/exec',
    runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: quiet ? new VirtualConsole() : undefined,
    beforeParse(w) {
      w.postHost = () => {};
      w.scrollTo = () => {};
      const chain = (done, fail) => new Proxy({}, { get: (_, name) => {
        if (name === 'withSuccessHandler') return f => chain(f, fail);
        if (name === 'withFailureHandler') return f => chain(done, f);
        if (name === 'withUserObject') return () => chain(done, fail);
        return (...args) => {
          calls.push({ fn: String(name), args });
          const r = server(String(name), args);
          if (r !== undefined) setTimeout(() => done && done(r), 0);
        };
      }});
      w.google = { script: { run: chain(null, null), host: { setHeight() {}, origin: '' } } };
    }
  });
  return { w: dom.window, d: dom.window.document, calls };
}
const settle = () => new Promise(r => setTimeout(r, 60));
const click = (w, el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));
const teacherServer = (fn, args) => {
  if (fn === 'apiBootstrap') return teacherPayload(args[1] || TODAY, args[2] || 0);
  if (fn === 'apiPulse') return { ok: true, stamp: '1' };
  return undefined;
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
/* The label and the figure are two elements — one small and uppercase above the other —
   so textContent runs them together. Read them as the two things they are. */
const left = (d, host) => text(d.querySelector(host + ' .ttleft span')) + ' ' +
                          text(d.querySelector(host + ' .ttleft b'));

async function main() {
  console.log('\n=== the strip paints in the register pane ===');
  {
    const { w, d } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    const cols = d.querySelectorAll('#ttApp .ttday');
    ok('a column per day', cols.length === 4, String(cols.length));
    ok('today is marked', d.querySelectorAll('#ttApp .ttday.today').length === 1);
    ok('and it is the right one', d.querySelector('#ttApp .ttday.today').dataset.d === TODAY);
    ok('the holiday column says so', text(d.querySelectorAll('#ttApp .ttday')[1]).indexOf('Holiday') !== -1,
       text(d.querySelectorAll('#ttApp .ttday')[1]));
    ok('an empty day says it is free', text(d.querySelectorAll('#ttApp .ttday')[2]).indexOf('Free') !== -1,
       text(d.querySelectorAll('#ttApp .ttday')[2]));
    ok('the header offers the fold', !!d.querySelector('#ttApp .ttfold'));
    ok('the clock is the school\'s, not the machine\'s',
       text(d.querySelector('#ttApp .ttclock')).indexOf('09:37') !== -1,
       text(d.querySelector('#ttApp .ttclock')));
    w.close();
  }

  console.log('\n=== what is running now ===');
  {
    const { w, d } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    const on = d.querySelectorAll('#ttApp .ttl.on');
    ok('exactly one lesson is marked as now', on.length === 1, String(on.length));
    ok('and it is the one the clock is inside', on[0] && on[0].dataset.c === 'Y12-IT',
       on[0] && on[0].dataset.c);
    const bar = text(d.querySelector('#ttApp .ttnow'));
    ok('the bar names it', bar.indexOf('AS IT') !== -1, bar);
    /* 09:37 to 10:00. This number is the whole point: it comes from the payload's
       clock, so it is the same on a phone set to any timezone on earth. */
    ok('and counts it down', left(d, '#ttApp') === 'Ends in 23 min', left(d, '#ttApp'));
    const fill = d.querySelector('#ttApp .ttnow .meter i');
    ok('the bar is filled to how far through it is', fill && fill.style.width === '49%',
       fill && fill.style.width);

    w.TIMETABLE.clock({ date: TODAY, min: 10 * 60 + 30, label: '10:30' });
    ok('between lessons it names the next one', left(d, '#ttApp') === 'Starts in 30 min',
       left(d, '#ttApp'));
    ok('and nothing is marked as running', d.querySelectorAll('#ttApp .ttl.on').length === 0);

    w.TIMETABLE.clock({ date: TODAY, min: 15 * 60, label: '15:00' });
    ok('after the last one it says so',
       text(d.querySelector('#ttApp .ttnow')) === 'No more lessons today',
       text(d.querySelector('#ttApp .ttnow')));
    w.close();
  }

  console.log('\n=== a fill-in end time is not passed off as exact ===');
  {
    const approx = JSON.parse(JSON.stringify(TT));
    approx.days[3].lessons[0].approx = true;
    const payload = teacherPayload(TODAY, 0);
    payload.timetable = approx;
    const { w, d } = boot('app', payload, teacherServer);
    await settle();
    ok('it says about', left(d, '#ttApp') === 'Ends in ~23 min', left(d, '#ttApp'));
    w.close();
  }

  console.log('\n=== the strip is a way into the register ===');
  {
    const { w, d, calls } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    /* Monday is not in the page yet — doGet ships one day — so this has to fetch it and
       only then open the lesson. Opening straight away would open nothing. */
    const mon = d.querySelector('#ttApp .ttl[data-d="' + shift(TODAY, -3) + '"]');
    ok('Monday\'s block is there to tap', !!mon);
    click(w, mon);
    await settle();
    ok('it fetched that day', calls.some(c => c.fn === 'apiBootstrap' && c.args[1] === shift(TODAY, -3)),
       JSON.stringify(calls.map(c => c.fn + ':' + c.args[1])));
    ok('and opened the register', !d.getElementById('viewRoster').classList.contains('hidden'));
    ok('the right one', d.getElementById('title').textContent === 'AS Chemistry',
       d.getElementById('title').textContent);
    w.close();
  }

  console.log('\n=== and a way to another day ===');
  {
    const { w, d } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    const wed = d.querySelector('#ttApp .ttdn[data-d="' + shift(TODAY, -1) + '"]');
    click(w, wed);
    await settle();
    ok('the day navigator followed', d.getElementById('dayDate').textContent.indexOf(shift(TODAY, -1)) !== -1,
       d.getElementById('dayDate').textContent);
    ok('and that column is marked as the one being read',
       (d.querySelector('#ttApp .ttday.sel') || {}).dataset.d === shift(TODAY, -1),
       (d.querySelector('#ttApp .ttday.sel') || {}).dataset);
    ok('today is still marked as today', d.querySelectorAll('#ttApp .ttday.today').length === 1);
    w.close();
  }

  console.log('\n=== the student pane ===');
  {
    const studentBoot = { ok: true, partial: false, week: record('week'), two: record('two'),
                          all: record('all'), timetable: TT, clock: CLOCK };
    const { w, d } = boot('student', studentBoot, (fn) => {
      if (fn === 'apiStudentAll') return studentBoot;
      if (fn === 'apiPulse') return { ok: true, stamp: '1' };
      return undefined;
    });
    await settle();
    ok('the strip is on the record', d.querySelectorAll('#ttLens .ttday').length === 4,
       String(d.querySelectorAll('#ttLens .ttday').length));
    ok('with the lesson running now marked', d.querySelectorAll('#ttLens .ttl.on').length === 1);
    ok('the countdown is there too', left(d, '#ttLens') === 'Ends in 23 min', left(d, '#ttLens'));
    /* A student has no per-day view to jump to, so the blocks must not look tappable. */
    ok('the blocks are not buttons', d.querySelectorAll('#ttLens button.ttl').length === 0);
    ok('nor are the day headers', d.querySelectorAll('#ttLens button.ttdn').length === 0);

    // The timetable belongs to the person, not the range: switching must not lose it.
    click(w, d.querySelector('.rng[data-r="all"]'));
    await settle();
    ok('it survives a range change', d.querySelectorAll('#ttLens .ttday').length === 4,
       String(d.querySelectorAll('#ttLens .ttday').length));
    ok('the record below it did change', text(d.getElementById('sub')).indexOf('All time') !== -1,
       text(d.getElementById('sub')));
    w.close();
  }

  console.log('\n=== nothing to show draws nothing ===');
  {
    const payload = teacherPayload(TODAY, 0);
    payload.timetable = null;
    const { w, d } = boot('app', payload, teacherServer);
    await settle();
    ok('no card at all', d.getElementById('ttApp').innerHTML === '',
       JSON.stringify(d.getElementById('ttApp').innerHTML.slice(0, 40)));
    ok('and the day list still works', d.querySelectorAll('#list .lsn').length === 2,
       String(d.querySelectorAll('#list .lsn').length));
    w.close();
  }

  console.log('\n=== a week that is not this week has no "now" ===');
  {
    /* Browsing next week must not put a lesson from the wrong Thursday under a
       countdown. The strip is drawn; the bar is not. */
    const other = JSON.parse(JSON.stringify(TT));
    other.days.forEach(x => { x.isToday = false; });
    other.hasToday = false;
    const payload = teacherPayload(TODAY, 0);
    payload.timetable = other;
    const { w, d } = boot('app', payload, teacherServer);
    await settle();
    ok('the columns are still drawn', d.querySelectorAll('#ttApp .ttday').length === 4);
    ok('nothing is marked as running', d.querySelectorAll('#ttApp .ttl.on').length === 0);
    ok('and the bar is hidden', d.querySelector('#ttApp .ttnow').classList.contains('hidden'));
    ok('the header names the week instead', text(d.querySelector('#ttApp .ttfold')) === '7 Sep – 10 Sep',
       text(d.querySelector('#ttApp .ttfold')));
    w.close();
  }

  console.log('\n=== an admin moving between students ===');
  {
    /* The record CACHE is per student, so the second look at someone is answered from
       memory with no round trip — and the strip has to be held the same way. Keeping
       one "current timetable" variable meant going back to a student you had already
       opened rendered their record under no strip at all, because the variable had
       been cleared for the switch and nothing refetched it. */
    const stripFor = (id) => {
      const t = JSON.parse(JSON.stringify(TT));
      // Ada has both of Thursday's lessons; Bea only the first.
      if (id !== 'P001') t.days[3].lessons = [t.days[3].lessons[0]];
      return t;
    };
    const STUDENTS = [{ id: 'P001', name: 'Ada Byron', year: '12', option: 'IMP' },
                      { id: 'P002', name: 'Bea Lovelace', year: '12', option: 'IMP' }];
    const asAdmin = (id) => ({
      ok: true, admin: true, viewer: 'Ann Admin', students: STUDENTS, studentId: id,
      clock: CLOCK, timetable: stripFor(id),
      week: record('week'), two: record('two'), all: record('all')
    });
    let fetches = 0;
    const adminBoot = teacherPayload(TODAY, 0);
    adminBoot.teacher = { name: 'Ann Admin', admin: true, readOnly: false };
    const { w, d } = boot('app', adminBoot, (fn, args) => {
      if (fn === 'apiStudentAsAdmin') { fetches++; return asAdmin(args[1] || 'P001'); }
      return teacherServer(fn, args);
    });
    await settle();
    const blocks = () => d.querySelectorAll('#ttLens .ttday[data-d="' + TODAY + '"] .ttl').length;

    w.LENS.open('P001');
    await settle();
    ok('the lens opens on that student\'s week', blocks() === 2, String(blocks()));

    w.LENS.open('P002');
    await settle();
    ok('and follows them to the next one', blocks() === 1, String(blocks()));

    w.LENS.open('P001');
    await settle();
    ok('going back does not refetch', fetches === 2, fetches + ' fetch(es)');
    ok('and the strip comes back with the record', blocks() === 2, String(blocks()));

    /* Leaving for the register pane and returning must not swap the admin's own week
       in under the student's name, or the other way round. */
    ok('the admin\'s own strip is a separate card',
       d.querySelectorAll('#ttApp .ttday').length === 4 && d.querySelectorAll('#ttLens .ttday').length === 4);
    w.close();
  }

  console.log('\n=== a live update ===');
  {
    const { w, d } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    /* The poll comes back every sixty seconds with a timetable that is almost always
       identical. Repainting on each one would throw away the scroll position and any
       column the teacher had scrolled to, once a minute, for no change at all. */
    const before = d.querySelector('#ttApp .ttday');
    before.__mark = 'kept';
    w.LIVE.refresh();
    await settle();
    ok('an unchanged week is left alone', d.querySelector('#ttApp .ttday').__mark === 'kept');
    ok('and the card is still there', d.querySelectorAll('#ttApp .ttday').length === 4);
    w.close();
  }

  console.log('\n=== a payload from before this existed ===');
  {
    /* boot: entries live in CacheService for fifteen minutes, so for a quarter of an
       hour after a deploy some teachers are served a payload with no timetable and no
       clock in it. That has to be a page with no card, not a broken page. */
    const payload = teacherPayload(TODAY, 0);
    delete payload.timetable;
    delete payload.clock;
    const { w, d } = boot('app', payload, (fn, args) => {
      const r = teacherServer(fn, args);
      if (r && fn === 'apiBootstrap') { delete r.timetable; delete r.clock; }
      return r;
    });
    await settle();
    ok('no card', d.getElementById('ttApp').innerHTML === '');
    ok('the day list is unharmed', d.querySelectorAll('#list .lsn').length === 2,
       String(d.querySelectorAll('#list .lsn').length));
    ok('and a register still opens', (() => {
      click(w, d.querySelector('#list .lsn'));
      return !d.getElementById('viewRoster').classList.contains('hidden');
    })());
    w.close();
  }

  console.log('\n=== one preference, both cards ===');
  {
    /* An admin has two of these on the page at once — their own week in the register
       pane, the student's in the lens. Collapsing one and finding the other still open
       reads as the setting not having worked. */
    const STUDENTS = [{ id: 'P001', name: 'Ada Byron', year: '12', option: 'IMP' }];
    const adminBoot = teacherPayload(TODAY, 0);
    adminBoot.teacher = { name: 'Ann Admin', admin: true, readOnly: false };
    const { w, d } = boot('app', adminBoot, (fn, args) => {
      if (fn === 'apiStudentAsAdmin') return { ok: true, admin: true, viewer: 'Ann Admin',
        students: STUDENTS, studentId: 'P001', clock: CLOCK, timetable: TT,
        week: record('week'), two: record('two'), all: record('all') };
      return teacherServer(fn, args);
    });
    await settle();
    w.LENS.open('P001');
    await settle();
    const shut = (host) => d.querySelector(host + ' .ttweek').classList.contains('hidden');
    ok('both start open', !shut('#ttApp') && !shut('#ttLens'));
    click(w, d.querySelector('#ttLens .ttfold'));
    ok('folding one folds both', shut('#ttApp') && shut('#ttLens'));
    ok('and both buttons say so',
       d.querySelector('#ttApp .ttfold').getAttribute('aria-expanded') === 'false' &&
       d.querySelector('#ttLens .ttfold').getAttribute('aria-expanded') === 'false');
    ok('the now bar is not folded away with it', !!d.querySelector('#ttLens .ttnow .ttleft'));
    click(w, d.querySelector('#ttApp .ttfold'));
    ok('and unfolding is the same deal', !shut('#ttApp') && !shut('#ttLens'));
    w.close();
  }

  console.log('\n=== a broken payload cannot take the register with it ===');
  {
    /* The strip is drawn from inside the same success handler that then paints the
       day. Anything that throws in there and is not caught leaves a teacher on a blank
       page, over a card that is the least important thing on it. */
    const payload = teacherPayload(TODAY, 0);
    payload.timetable = { days: [{ date: TODAY, dow: 'Thu', n: 1, isToday: true }] };  // no lessons[]
    const { w, d } = boot('app', payload, teacherServer, true);
    await settle();
    ok('the card gives up', d.getElementById('ttApp').innerHTML === '',
       d.getElementById('ttApp').innerHTML.slice(0, 40));
    ok('the day still painted', d.querySelectorAll('#list .lsn').length === 2,
       String(d.querySelectorAll('#list .lsn').length));
    ok('and the register still opens', (() => {
      click(w, d.querySelector('#list .lsn'));
      return !d.getElementById('viewRoster').classList.contains('hidden');
    })());
    w.close();
  }

  console.log('\n=== a student with no attendance yet still has a timetable ===');
  {
    /* The first week of term: no register has been taken, so the record is empty and
       render() takes its early way out. That is exactly when knowing what you have on
       is worth the most. */
    const empty = record('week');
    empty.totals = { present: 0, late: 0, absent: 0, total: 0, rate: 0 };
    empty.subjects = []; empty.ever = 0;
    const studentBoot = { ok: true, week: empty, two: empty, all: empty,
                          timetable: TT, clock: CLOCK };
    const { w, d } = boot('student', studentBoot, (fn) =>
      fn === 'apiStudentAll' ? studentBoot : (fn === 'apiPulse' ? { ok: true, stamp: '1' } : undefined));
    await settle();
    ok('the record says there is nothing yet',
       text(d.getElementById('body')).indexOf('Nothing recorded yet') !== -1,
       text(d.getElementById('body')).slice(0, 60));
    ok('and the strip is there anyway', d.querySelectorAll('#ttLens .ttday').length === 4,
       String(d.querySelectorAll('#ttLens .ttday').length));
    ok('counting the lesson down', left(d, '#ttLens') === 'Ends in 23 min', left(d, '#ttLens'));
    w.close();
  }

  console.log('\n=== the wrapper is told how much room to leave ===');
  {
    /* attendance.html paints the first screen and this card lands on top of it. It
       cannot draw the strip — it has no timetable and no server clock — so the app
       measures its own card and the wrapper holds exactly that many pixels. Getting
       this wrong is a visible jump on every open, which is the one thing that cached
       screen exists to prevent.

       jsdom does no layout, so offsetHeight is 0 here: what is under test is that the
       measurement is taken and posted, and that the wrapper reads the field the app
       actually sends. */
    const posted = [];
    const { w, d } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    /* There is no wrapper here, so window.HOST() is null and the app posts nothing —
       which is correct, and means the snapshot has to be provoked. Stand a host in
       front of it and move the day, which is what makes show() run again. */
    w.HOST = () => ({ postMessage: (m) => posted.push(m) });
    click(w, d.querySelector('#ttApp .ttdn[data-d="' + shift(TODAY, -1) + '"]'));
    await settle();
    const snap = posted.filter(m => m && m.type === 'attendance:snapshot').pop();
    ok('the snapshot carries a measurement', !!snap && typeof snap.strip === 'number',
       snap && JSON.stringify(snap.strip));
    ok('and not the timetable itself', !!snap && snap.timetable === undefined);
    w.close();

    const wrap = fs.readFileSync(SRC('attendance.html'), 'utf8');
    const m = wrap.match(/function stripGap\(px\)\{[\s\S]*?\n  \}/);
    ok('the wrapper has somewhere to put it', !!m);
    if (m) {
      const stripGap = new Function(m[0] + ';return stripGap;')();
      ok('a real measurement becomes a real height', stripGap(226).indexOf('height:226px') !== -1,
         stripGap(226));
      ok('a missing one falls back to the stylesheet', stripGap(undefined).indexOf('style') === -1,
         stripGap(undefined));
      ok('and so does a silly one', stripGap(99999).indexOf('style') === -1, stripGap(99999));
      ok('the block is a skeleton either way', stripGap(0).indexOf('class="sblock htt"') !== -1,
         stripGap(0));
    }

    /* The two files have to agree on the field name, which is exactly the kind of
       thing that drifts. */
    ok('the wrapper reads the field the app writes', /strip:\s*msg\.strip/.test(wrap));
  }

  ok.done();
}
main();
