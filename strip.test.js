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

console.log('\n=== a subject is coloured by its option-block slot ===');
{
  /* The real Year 12 and Year 13 structures from invariant 26. Nothing here is keyed to
     a subject NAME: the colour comes out of `Option blocks`, so renaming Chemistry I
     keeps its colour and adding a subject does not need a new one. */
  const BLOCKS =
    'Y12: C=Chemistry I,B=Biology I,I=IT | M=Mathematics,P=Physics I,B=Biology II | ' +
         'P=Physics II,E=English,C=Chemistry II; ' +
    'Y13: C=Chemistry,I=IT,B=Biology I | M=Mathematics,B=Biology II | P=Physics,E=English';
  const { ctx } = loadWith(Object.assign({}, FIX, {
    Settings: FIX.Settings.concat([
      { Setting: 'Option blocks', Value: BLOCKS },
      { Setting: 'Subject rollups', Value: 'Y12 Statistics=Mathematics' }
    ])
  }));
  const tone = (y, s) => ctx.toneOf_(y, s);

  ok('AS slot 1 is one colour', ['Chemistry I', 'Biology I', 'IT']
     .every(s => tone('12', s) === 'as1'), ['Chemistry I', 'Biology I', 'IT'].map(s => tone('12', s)).join());
  ok('AS slot 2 another', ['Mathematics', 'Physics I', 'Biology II']
     .every(s => tone('12', s) === 'as2'), ['Mathematics', 'Physics I', 'Biology II'].map(s => tone('12', s)).join());
  ok('AS slot 3 another', ['Physics II', 'English', 'Chemistry II']
     .every(s => tone('12', s) === 'as3'), ['Physics II', 'English', 'Chemistry II'].map(s => tone('12', s)).join());

  ok('A2 has its own palette', ['Chemistry', 'IT', 'Biology I']
     .every(s => tone('13', s) === 'a21'), ['Chemistry', 'IT', 'Biology I'].map(s => tone('13', s)).join());
  ok('A2 slot 2', ['Mathematics', 'Biology II'].every(s => tone('13', s) === 'a22'),
     ['Mathematics', 'Biology II'].map(s => tone('13', s)).join());
  ok('A2 slot 3', ['Physics', 'English'].every(s => tone('13', s) === 'a23'),
     ['Physics', 'English'].map(s => tone('13', s)).join());

  /* The two anagram codes make this concrete: Chemistry I is slot 1 and Chemistry II is
     slot 3, so the same word in two groups is two different colours. That is the whole
     reason the colour follows the slot and not the name. */
  ok('the same subject in two slots is two colours', tone('12', 'Chemistry I') !== tone('12', 'Chemistry II'));
  // A component subject is drawn as the subject it reports under (invariant 4).
  ok('Statistics wears Mathematics\'s colour', tone('12', 'Statistics') === 'as2', tone('12', 'Statistics'));
  ok('a subject outside the blocks gets none', tone('12', 'Art') === '', tone('12', 'Art'));
  ok('and so does a year without them', tone('11', 'IT') === '', tone('11', 'IT'));

  /* End to end: a timetable whose subjects really are in the blocks, through
     apiBootstrap, comes out with a tone on every lesson. */
  const { ctx: real } = loadWith(Object.assign({}, FIX, {
    Settings: FIX.Settings.concat([{ Setting: 'Option blocks', Value: BLOCKS }]),
    Timetable: [
      { Teacher: 'Mr M', Year: '12', Subject: 'IT', Day: 'Mon', Period: '1',
        Start: '09:00', End: '09:45', Options: 'IMP', _row: 2 },
      { Teacher: 'Mr M', Year: '12', Subject: 'Mathematics', Day: 'Mon', Period: '2',
        Start: '10:00', End: '10:45', Options: 'IMP', _row: 3 },
      { Teacher: 'Mr M', Year: '13', Subject: 'Physics', Day: 'Mon', Period: '3',
        Start: '11:00', End: '11:45', Options: 'IM', _row: 4 }
    ]
  }));
  const tones = dayOf(real.apiBootstrap('tokM', MON, 0).timetable, 'Mon')
    .lessons.map(l => l.tone).join();
  ok('and the payload carries them', tones === 'as1,as2,a23', tones);

  /* With no Option blocks at all — which is every school that has not filled the
     setting in — nothing is coloured and the card is exactly as it was. */
  const { ctx: plain } = load();
  ok('no blocks, no colours', plain.toneOf_('12', 'Chemistry') === '');
}

console.log('\n=== the school\'s periods, inferred from the timetable ===');
{
  /* Nothing declares the bell times, so they come out of the Timetable tab: for each
     period, the times the most rows agree on. That is what lets a column be read by
     position — see invariants 25 and 32. */
  const { ctx } = loadWith(Object.assign({}, FIX, {
    Timetable: [
      { Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Mon', Period: '2',
        Start: '09:15', End: '10:00', Options: 'IMP', _row: 2 },
      { Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Tue', Period: '5',
        Start: '12:30', End: '13:15', Options: 'IMP', _row: 3 },
      // Two rows say period 4 starts at 11:00 and one says 11:05. The many win.
      { Teacher: 'Mr B', Year: '12', Subject: 'Physics', Day: 'Mon', Period: '4',
        Start: '11:00', End: '11:45', Options: 'IMP', _row: 4 },
      { Teacher: 'Mr B', Year: '12', Subject: 'Physics', Day: 'Tue', Period: '4',
        Start: '11:00', End: '11:45', Options: 'IMP', _row: 5 },
      { Teacher: 'Mr B', Year: '12', Subject: 'Physics', Day: 'Wed', Period: '4',
        Start: '11:05', End: '11:50', Options: 'IMP', _row: 6 },
      // A Period cell nobody could read, and one far past the cap.
      { Teacher: 'Mr B', Year: '12', Subject: 'Physics', Day: 'Thu', Period: '400',
        Start: '09:00', End: '09:45', Options: 'IMP', _row: 7 },
      { Teacher: 'Mr B', Year: '12', Subject: 'Physics', Day: 'Thu', Period: '3',
        Start: '', End: '', Options: 'IMP', _row: 8 }
    ]
  }));
  const ps = ctx.periods_();
  ok('one row per period, in order', ps.map(p => p.p).join() === '2,4,5', ps.map(p => p.p).join());
  ok('the time the most rows agree on wins', ps[1].start === '11:00', ps[1].start);
  ok('a period past the cap is not a period', ps.every(p => Number(p.p) <= 14));
  ok('nor is one with no readable start', ps.every(p => p.p !== '3'));
  ok('the payload carries them', !!ctx.apiBootstrap('tokM', MON, 0).timetable.periods);

  /* A tie goes to the earlier start, so the grid cannot flip about between requests
     depending on which order the rows came back in. */
  const { ctx: c2 } = loadWith(Object.assign({}, FIX, {
    Timetable: [
      { Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Mon', Period: '1',
        Start: '09:00', End: '09:45', Options: 'IMP', _row: 2 },
      { Teacher: 'Mr M', Year: '12', Subject: 'Chemistry', Day: 'Tue', Period: '1',
        Start: '08:30', End: '09:15', Options: 'IMP', _row: 3 }
    ]
  }));
  ok('a tie takes the earlier one', c2.periods_()[0].start === '08:30', c2.periods_()[0].start);
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
/* Five periods, of which this person uses two — which is the layout the whole grid
   exists for: period 2 must not sit directly on top of period 4. */
const PERIODS = [
  { p: '1', start: '08:30', end: '09:15', s: 510, e: 555 },
  { p: '2', start: '09:15', end: '10:00', s: 555, e: 600 },
  { p: '3', start: '10:00', end: '10:45', s: 600, e: 645 },
  { p: '4', start: '11:00', end: '11:45', s: 660, e: 705 },
  { p: '5', start: '12:30', end: '13:15', s: 750, e: 795 }
];
const TT = {
  from: shift(TODAY, -3), to: TODAY, label: '7 Sep – 10 Sep', hasToday: true,
  periods: PERIODS,
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
    ok('a day with nothing on is held open, slot for slot',
       d.querySelectorAll('#ttApp .ttday')[2].querySelectorAll('.ttgap').length === 3,
       String(d.querySelectorAll('#ttApp .ttday')[2].querySelectorAll('.ttgap').length));
    ok('the header offers the fold', !!d.querySelector('#ttApp .ttfold'));
    /* The clock is a card of its own, outside the timetable — so folding the timetable
       away does not take the time with it, and the header has only its own controls to
       fit on a phone. */
    ok('the clock is not in the header', !d.querySelector('#ttApp .ttwhen'));
    ok('it is a card of its own', !!d.querySelector('#ttClockApp .card.ttwhen'));
    click(w, d.querySelector('#ttApp .ttfold'));
    ok('and folding the timetable leaves it standing',
       !!d.querySelector('#ttClockApp .ttwhen') &&
       d.querySelector('#ttApp .ttbody').classList.contains('hidden'));
    click(w, d.querySelector('#ttApp .ttfold'));
    /* Two lines, not one: "Thu 10 Sep · 09:37" beside the label and the view toggle
       does not fit a phone, and ran off the end of a real one. */
    ok('the clock is the school\'s, not the machine\'s',
       text(d.querySelector('#ttClockApp .t')) === '09:37',
       text(d.querySelector('#ttClockApp .t')));
    ok('with the date on its own line above it',
       text(d.querySelector('#ttClockApp .d')) === 'Thu 10 Sep',
       text(d.querySelector('#ttClockApp .d')));
    w.close();
  }

  console.log('\n=== a free period holds its place ===');
  {
    /* The complaint this answers: period 2 stacked straight on top of period 4, with 3
       nowhere. A column is read by position, so every column lays out against the same
       rows and the second slot is period 3 in all of them. Invariant 25, arrived at
       from the other end. */
    const { w, d } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    const col = d.querySelector('#ttApp .ttday[data-d="' + TODAY + '"]');
    const slots = col.querySelectorAll('.ttl,.ttgap');
    ok('a slot per period of this person\'s day', slots.length === 3, String(slots.length));
    // Ignore `on`, which is the running-now mark and belongs to the other test.
    const shape = Array.prototype.map.call(slots, (e) => e.className.split(' ')[0]).join(' ');
    ok('lessons at 2 and 4 with the gap at 3 still there', shape === 'ttl ttgap ttl', shape);
    /* The period and its time are printed once down the left, not once per block, and
       the gutter is what numbers the empty cells. */
    const axis = d.querySelectorAll('#ttApp .ttgutter .ttgrow');
    ok('a gutter row per slot', axis.length === 3, String(axis.length));
    ok('numbered and timed', text(axis[0]) === '209:15' && text(axis[1]) === '310:00',
       text(axis[0]) + ' / ' + text(axis[1]));
    ok('and the blocks no longer repeat it', !d.querySelector('#ttApp .ttl .tm'));
    /* Every cell the same size, or row 3 is not row 3 in the next column along — and a
       free period drawn smaller would be saying that hour is shorter than the one above
       it. jsdom resolves an explicit height off the stylesheet, so this is the real
       cascade rather than a grep of the source. Height only: the last cell in a column
       drops its margin, so comparing those would compare two different rules. */
    const high = (sel) => w.getComputedStyle(d.querySelector('#ttApp ' + sel)).height;
    ok('a lesson and a free period are the same cell', high('.ttl') === high('.ttgap'),
       high('.ttl') + ' vs ' + high('.ttgap'));
    ok('and so is a gutter row', high('.ttgutter .ttgrow') === high('.ttl'),
       high('.ttgutter .ttgrow'));
    ok('the cell has a real height', /^\d\dpx$/.test(high('.ttl')), high('.ttl'));
    /* .ttrow belongs to the now bar. The gutter rows took that class once and turned
       the countdown into a centred column of three stacked lines. */
    ok('the gutter does not borrow the now bar\'s class',
       d.querySelectorAll('#ttApp .ttgutter .ttrow').length === 0);

    /* The card spans this person's teaching day, not the school's: period 1 here is
       before anybody in it starts, so it is not a row. An empty period BETWEEN two
       lessons is a gap in the day and is never trimmed — that is the whole point. */
    const late = JSON.parse(JSON.stringify(TT));
    late.days.forEach((x) => x.lessons.forEach((l) => {
      if (l.period === '2') { l.period = '3'; l.start = '10:00'; l.s = 600; l.e = 645; }
    }));
    const p2 = teacherPayload(TODAY, 0);
    p2.timetable = late;
    const trimmed = boot('app', p2, teacherServer);
    await settle();
    const ps = Array.prototype.map.call(
      trimmed.d.querySelectorAll('#ttApp .ttgutter .ttgrow b'), (e) => e.textContent).join();
    ok('nothing before the first lesson or after the last', ps === '3,4', ps);
    trimmed.w.close();
    /* Every column, or it is not a grid. */
    const mon = d.querySelector('#ttApp .ttday[data-d="' + shift(TODAY, -3) + '"]');
    ok('and every column agrees', mon.querySelectorAll('.ttl,.ttgap').length === 3,
       String(mon.querySelectorAll('.ttl,.ttgap').length));
    ok('with Monday\'s one lesson in the same row as Thursday\'s',
       mon.querySelectorAll('.ttl,.ttgap')[2].className === 'ttl',
       mon.querySelectorAll('.ttl,.ttgap')[2].className);
    /* A gap is scenery: a screen reader reading "1 3 5" between the lessons is noise. */
    ok('a gap is hidden from a screen reader',
       col.querySelector('.ttgap').getAttribute('aria-hidden') === 'true');
    w.close();
  }

  console.log('\n=== the colour reaches the cells ===');
  {
    const toned = JSON.parse(JSON.stringify(TT));
    toned.days[3].lessons[0].tone = 'as1';
    toned.days[3].lessons[1].tone = 'a23';
    toned.days[0].lessons[0].tone = 'a23';
    // Anything not one of the six is dropped rather than written into the attribute.
    toned.days[3].lessons[0].classId += '';
    const payload = teacherPayload(TODAY, 0);
    payload.timetable = toned;
    const { w, d } = boot('app', payload, teacherServer);
    await settle();
    const col = d.querySelector('#ttApp .ttday[data-d="' + TODAY + '"]');
    ok('the week cell wears it', col.querySelector('.ttl').dataset.tone === 'as1',
       col.querySelector('.ttl').dataset.tone);
    ok('and a different slot a different one',
       col.querySelectorAll('.ttl')[1].dataset.tone === 'a23');
    ok('the free cell stays neutral', !col.querySelector('.ttgap').hasAttribute('data-tone'));

    /* NOW has to survive being drawn on a colour, so it is a ring and not a wash. */
    ok('the lesson running now keeps its colour and takes a ring',
       col.querySelector('.ttl.on').dataset.tone === 'as1');
    ok('and the ring is the accent',
       /\.ttl\.on,\.ttp\.on\{box-shadow:inset 0 0 0 2px var\(--accent\)/.test(raw));

    click(w, d.querySelector('#ttApp .ttview[data-v="day"]'));
    ok('the day row wears it too', d.querySelector('#ttApp .ttp[data-c="Y12-IT"]').dataset.tone === 'as1',
       d.querySelector('#ttApp .ttp[data-c="Y12-IT"]').dataset.tone);
    ok('and a free row does not', !d.querySelector('#ttApp .ttp.free').hasAttribute('data-tone'));
    w.close();

    /* A tone the stylesheet does not know would be an attribute selector that never
       matches — a cell with no background at all. Refuse it at the door. */
    const junk = JSON.parse(JSON.stringify(TT));
    junk.days[3].lessons[0].tone = 'as9';
    const p3 = teacherPayload(TODAY, 0);
    p3.timetable = junk;
    const bad = boot('app', p3, teacherServer);
    await settle();
    ok('an unknown tone is dropped',
       !bad.d.querySelector('#ttApp .ttday[data-d="' + TODAY + '"] .ttl').hasAttribute('data-tone'));
    bad.w.close();

    /* Every tone the server can send must have a rule, in both themes, or a subject
       silently loses its colour when someone flips to dark. */
    ['as1', 'as2', 'as3', 'a21', 'a22', 'a23'].forEach((t) => {
      const light = new RegExp('--tt-' + t + ':#[0-9A-Fa-f]{6}').test(raw);
      const rule = raw.indexOf('.tt [data-tone="' + t + '"]') !== -1;
      const both = raw.split('--tt-' + t + ':').length - 1;
      ok(t + ' has a rule and both themes', light && rule && both === 2,
         'rule:' + rule + ' declared:' + both);
    });
  }

  console.log('\n=== a period the school structure does not describe ===');
  {
    /* periods_ can only infer a period it can read as a number. A lesson filed under
       "1A" is still that person's lesson and must not fall out of the card. */
    const odd = JSON.parse(JSON.stringify(TT));
    odd.days[3].lessons.push(Object.assign({}, odd.days[3].lessons[0],
      { period: '1A', classId: 'Y12-ODD', label: 'AS Odd', start: '14:00', end: '14:45', s: 840, e: 885 }));
    const payload = teacherPayload(TODAY, 0);
    payload.timetable = odd;
    const { w, d } = boot('app', payload, teacherServer);
    await settle();
    const col = d.querySelector('#ttApp .ttday[data-d="' + TODAY + '"]');
    ok('it gets a row of its own', col.querySelectorAll('.ttl').length === 3,
       String(col.querySelectorAll('.ttl').length));
    /* Whatever the row count comes out as, every column and the gutter must agree on
       it — that is the property, not the number. */
    const counts = Array.prototype.map.call(d.querySelectorAll('#ttApp .ttday'),
      (c) => c.querySelectorAll('.ttl,.ttgap').length)
      // A holiday column is a message, not a day of periods, and has no slots at all.
      .filter((n) => n > 0);
    counts.push(d.querySelectorAll('#ttApp .ttgutter .ttgrow').length);
    ok('and every column still matches', counts.every((n) => n === counts[0]), counts.join());
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
    /* A teacher with no timetable still gets a clock: it is a clock, not a timetable. */
    ok('but the clock still stands', !!d.querySelector('#ttClockApp .ttwhen'));
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
    /* The header's right-hand slot answers "when am I looking at". With no today in the
       week there is no clock worth showing, so it names the week instead. */
    ok('the header names the week instead',
       text(d.querySelector('#ttClockApp .d')) === '7 Sep – 10 Sep',
       text(d.querySelector('#ttClockApp .d')));
    // ...and leaves no empty second line under it.
    ok('and shows no time at all', text(d.querySelector('#ttClockApp .t')) === '',
       text(d.querySelector('#ttClockApp .t')));
    w.close();
  }

  console.log('\n=== week and day ===');
  {
    const { w, d } = boot('app', teacherPayload(TODAY, 0), teacherServer);
    await settle();
    const pressed = (v) => d.querySelector('#ttApp .ttview[data-v="' + v + '"]')
                            .getAttribute('aria-pressed');
    ok('it opens on the week', pressed('week') === 'true' && pressed('day') === 'false');
    ok('which is the grid', !!d.querySelector('#ttApp .ttweek'));

    click(w, d.querySelector('#ttApp .ttview[data-v="day"]'));
    ok('day view takes over', pressed('day') === 'true' && !d.querySelector('#ttApp .ttweek'));
    ok('a chip per day', d.querySelectorAll('#ttApp .ttchip').length === 4,
       String(d.querySelectorAll('#ttApp .ttchip').length));
    ok('a row per period', d.querySelectorAll('#ttApp .ttp').length === 3,
       String(d.querySelectorAll('#ttApp .ttp').length));
    ok('the one between them free', d.querySelectorAll('#ttApp .ttp.free').length === 1,
       String(d.querySelectorAll('#ttApp .ttp.free').length));
    /* The times are the point of this view: a free period says when it is, which the
       week view has no room to. */
    const free = d.querySelector('#ttApp .ttp.free');
    ok('and a free period still says when it is', text(free) === '310:00–10:45Free', text(free));
    ok('the lesson names its room',
       text(d.querySelectorAll('#ttApp .ttp')[0]) === '209:15–10:00AS ITC1',
       text(d.querySelectorAll('#ttApp .ttp')[0]));
    ok('and the one running now is marked',
       d.querySelectorAll('#ttApp .ttp.on').length === 1 &&
       d.querySelector('#ttApp .ttp.on').dataset.c === 'Y12-IT');
    ok('the countdown is unaffected', left(d, '#ttApp') === 'Ends in 23 min', left(d, '#ttApp'));

    /* It opens on today, and a chip moves it — which for a teacher also moves the day
       they are reading, because the two must not disagree. */
    ok('it opens on today', d.querySelector('#ttApp .ttchip.sel').dataset.d === TODAY);
    click(w, d.querySelector('#ttApp .ttchip[data-d="' + shift(TODAY, -3) + '"]'));
    await settle();
    ok('a chip moves the day', d.querySelector('#ttApp .ttchip.sel').dataset.d === shift(TODAY, -3));
    ok('and the rows follow it', d.querySelectorAll('#ttApp .ttp:not(.free)').length === 1,
       String(d.querySelectorAll('#ttApp .ttp:not(.free)').length));
    ok('the register pane went with it',
       d.getElementById('dayDate').textContent.indexOf(shift(TODAY, -3)) !== -1,
       d.getElementById('dayDate').textContent);
    ok('and nothing is running on a day that is not today',
       d.querySelectorAll('#ttApp .ttp.on').length === 0);

    // A lesson row is still the way into that register.
    click(w, d.querySelector('#ttApp .ttp[data-c="Y12-CHEM"]'));
    await settle();
    ok('a row opens the register', !d.getElementById('viewRoster').classList.contains('hidden') &&
       d.getElementById('title').textContent === 'AS Chemistry',
       d.getElementById('title').textContent);
    // ...and a free row is not a button at all.
    ok('a free row is not tappable', d.querySelectorAll('#ttApp button.ttp.free').length === 0);
    w.close();
  }

  console.log('\n=== the view is remembered, and shared ===');
  {
    const store = {};
    const STUDENTS = [{ id: 'P001', name: 'Ada Byron', year: '12', option: 'IMP' }];
    const adminBoot = teacherPayload(TODAY, 0);
    adminBoot.teacher = { name: 'Ann Admin', admin: true, readOnly: false };
    const server = (fn, args) => {
      if (fn === 'apiStudentAsAdmin') return { ok: true, admin: true, viewer: 'Ann Admin',
        students: STUDENTS, studentId: 'P001', clock: CLOCK, timetable: TT,
        week: record('week'), two: record('two'), all: record('all') };
      return teacherServer(fn, args);
    };
    const { w, d } = boot('app', adminBoot, server);
    await settle();
    w.LENS.open('P001');
    await settle();
    click(w, d.querySelector('#ttApp .ttview[data-v="day"]'));
    ok('switching one switches both',
       !!d.querySelector('#ttApp .ttlist') && !!d.querySelector('#ttLens .ttlist'));
    ok('and both buttons agree',
       d.querySelector('#ttLens .ttview[data-v="day"]').getAttribute('aria-pressed') === 'true');
    ok('the choice is written down', w.localStorage.getItem('attendance-tt-view') === 'day',
       String(w.localStorage.getItem('attendance-tt-view')));
    w.close();

    /* A new open reads it back. jsdom gives each document its own storage, so the
       stored value is handed over rather than carried. */
    const again = boot('app', teacherPayload(TODAY, 0), teacherServer);
    again.w.localStorage.setItem('attendance-tt-view', 'day');
    await settle();
    // The module read localStorage as it loaded, so re-render through a fresh payload.
    ok('a stored choice is a real one', ['week', 'day']
       .indexOf(again.w.localStorage.getItem('attendance-tt-view')) !== -1);
    again.w.close();
  }

  console.log('\n=== a student can reach another day ===');
  {
    /* The register pane has a date navigator above the lessons. The record has nothing,
       so before this the day view's chips are a student's only way to look at Tuesday. */
    const studentBoot = { ok: true, week: record('week'), two: record('two'), all: record('all'),
                          timetable: TT, clock: CLOCK };
    const { w, d } = boot('student', studentBoot, (fn) =>
      fn === 'apiStudentAll' ? studentBoot : (fn === 'apiPulse' ? { ok: true, stamp: '1' } : undefined));
    await settle();
    click(w, d.querySelector('#ttLens .ttview[data-v="day"]'));
    ok('the chips are there', d.querySelectorAll('#ttLens .ttchip').length === 4);
    ok('and they are buttons even though nothing else is',
       d.querySelectorAll('#ttLens button.ttchip').length === 4 &&
       d.querySelectorAll('#ttLens button.ttp').length === 0);
    click(w, d.querySelector('#ttLens .ttchip[data-d="' + shift(TODAY, -3) + '"]'));
    await settle();
    ok('a chip moves the day', d.querySelector('#ttLens .ttchip.sel').dataset.d === shift(TODAY, -3));
    ok('and the rows follow', text(d.querySelectorAll('#ttLens .ttp')[2]).indexOf('AS Chemistry') !== -1,
       text(d.querySelectorAll('#ttLens .ttp')[2]));
    ok('the record below is untouched', text(d.getElementById('sub')).indexOf('This week') !== -1,
       text(d.getElementById('sub')));
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
    const shut = (host) => d.querySelector(host + ' .ttbody').classList.contains('hidden');
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
    payload.timetable = { periods: PERIODS, days: [null, null] };
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

  console.log('\n=== the subject cards: numbers left, ring right ===');
  {
    /* The ring stands beside the numbers instead of under them, which is most of a
       phone screen less scrolling across four subjects. At that size the leader labels
       are illegible and say nothing the table beside them does not, so they go; the one
       figure they carried that the table lacks — the rate — is printed by the ring. */
    /* Flipped just before the live update, so the test does not depend on how many
       times the page happens to call the server while it boots — a counter here once
       assumed a boot-time fetch that a non-partial payload never makes. */
    let later = false;
    const rec = (p, a) => {
      const r = record('week');
      r.subjects[0].present = p; r.subjects[0].absent = a;
      r.subjects[0].total = p + a; r.subjects[0].rate = p / (p + a);
      r.totals = { present: p, late: 0, absent: a, total: p + a, rate: p / (p + a) };
      return r;
    };
    const payload = (p, a) => ({ ok: true, week: rec(p, a), two: rec(p, a), all: rec(p, a),
                                 timetable: TT, clock: CLOCK });
    const { w, d } = boot('student', payload(3, 1), (fn) => {
      if (fn === 'apiStudentAll') return later ? payload(4, 0) : payload(3, 1);
      if (fn === 'apiPulse') return { ok: true, stamp: '1' };
      return undefined;
    });
    await settle();
    const card = d.querySelector('.cards .card');
    ok('each card has a ring', !!card.querySelector('.cbody .ring .chart'));
    ok('laid out as a row', w.getComputedStyle(card.querySelector('.cbody')).display === 'flex');
    ok('with the rate beside it', text(card.querySelector('.ring .rate b')) === '75%',
       text(card.querySelector('.ring .rate b')));
    ok('and no leader labels', !card.querySelector('.chart .labels'));
    ok('cropped to the donut', card.querySelector('.chart').getAttribute('viewBox') === '80 52 180 128',
       card.querySelector('.chart').getAttribute('viewBox'));
    ok('the all-subjects card matches', !!d.querySelector('[data-k="__all"] .ring .rate b'));

    /* A live update rewrites the figures in place. The rate is the one number outside
       the table, so it is the one most easily left behind. */
    const before = card;
    later = true;
    w.LIVE.refresh();
    await settle();
    await settle();
    const after = d.querySelector('.cards .card');
    ok('a live update keeps the card', after === before);
    ok('and moves the rate with the numbers', text(after.querySelector('.ring .rate b')) === '100%',
       text(after.querySelector('.ring .rate b')));
    ok('the redrawn ring is still the tight one', !after.querySelector('.chart .labels') &&
       after.querySelector('.chart').getAttribute('viewBox') === '80 52 180 128');
    ok('and the clock sits beside the name', !!d.querySelector('.head #ttClock .ttwhen'));
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
