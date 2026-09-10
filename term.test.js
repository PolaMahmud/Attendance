/* Term start date, the "prev" flag, Add option codes, and the identical-roster check. */
const { loadWith, reporter, SRC } = require('./harness.js');
const ok = reporter();

const SETH = ['Setting', 'Value', 'What it does'];
const settings = extra => [SETH,
  ['Timezone', 'Europe/London', ''],
  ['Teaching days', 'Sun,Mon,Tue,Wed,Thu', ''],
  ['Holidays', '', ''],
  ['Editing window', 'Always open', ''],
  ['Show "prev" flag', 'Yes', ''],
  ['Subject rollups', 'Y13 Mechanics=Mathematics, Y12 Statistics=Mathematics', ''],
  ['Option blocks', 'Y12: C=Chemistry 1, B=Biology 1, I=IT | M=Mathematics, P=Physics 1, ' +
    'B=Biology 2 | P=Physics 2, E=English, C=Chemistry 2; ' +
    'Y13: C=Chemistry, I=IT, B=Biology 1 | M=Mathematics, B=Biology 2 | P=Physics, E=English', '']
].concat(extra || []);

const TTH = ['Teacher', 'Year', 'Subject', 'Block', 'Day', 'Period', 'Start', 'End', 'Room', 'Options'];
const lesson = (teacher, year, subject, period, opts) =>
  [teacher, year, subject, 'A', 'Mon', String(period), '09:00', '09:45', 'R1', opts];

const STUH = ['StudentID', 'Name', 'Year', 'Option', 'Token', 'My attendance link'];
const TEAH = ['TeacherID', 'Teacher', 'Email', 'Role', 'Token', 'Attendance link'];
const REGH = ['SessionKey', 'Date', 'Period', 'ClassID', 'Teacher', 'Present', 'Late', 'Absent',
              'Total', 'Saved at', 'Statuses'];
const reg = (classId, date, period, teacher, marks) =>
  [classId + '|' + date + '|' + period, date, String(period), classId, teacher,
   0, 0, 0, 0, date + ' 10:00:00', JSON.stringify(marks)];

const EMPTY = {
  Leave: [['Teacher', 'From', 'To', 'Periods', 'Reason']],
  Track_Changes: [['StudentID', 'Student', 'Effective from', 'From track', 'To track', 'Carry over', 'Note']],
  Enrolment: [['StudentID', 'Student', 'Subject', 'Taking', 'Effective from', 'Count earlier as absent', 'Note']],
  Attendance_Log: [['SessionKey']]
};

// CODE_FILE lets the regression check run this same spec against a copy of Code.gs
// with the new behaviour taken back out, to prove the assertions are load-bearing.
const FILE = process.env.CODE_FILE || undefined;

function world(sheets) {
  const { ctx, grids } = loadWith({}, { sheetData: Object.assign({}, EMPTY, sheets), file: FILE });
  return { ctx, grids };
}

/* ---------------------------------------------------- term start ---- */
// Two Mondays: one before term, one after.
const BEFORE = '2026-08-31', AFTER = '2026-09-07', TERM = '2026-09-01';

function termWorld(termValue) {
  return world({
    Settings: settings(termValue === null ? [] : [['Term starts', termValue, '']]),
    Timetable: [TTH, lesson('Gzng', '13', 'Chemistry', 1, 'CBP')],
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', ''], ['T02', 'Boss', 'b@s', 'Admin', 'tb', '']],
    Registers: [REGH, reg('Y13-CHEMISTRY', BEFORE, 1, 'Gzng', { S1: 'A' }),
                      reg('Y13-CHEMISTRY', AFTER, 1, 'Gzng', { S1: 'P' })]
  });
}

console.log('\nTerm start date');
{
  const { ctx } = termWorld(null);
  const st = ctx.apiTeacherStats('tb', BEFORE, AFTER);
  ok('with no start date, both Mondays are expected', st.totals.expected === 2, st.totals.expected);

  const r = ctx.studentReport_(ctx.studentById_('S1'),
    { from: '0001-01-01', to: AFTER, key: 'all', label: 'all' }, ctx.registers_());
  ok('...and the student carries both marks', r.totals.total === 2, r.totals.total);
}
{
  const { ctx } = termWorld(TERM);
  const st = ctx.apiTeacherStats('tb', BEFORE, AFTER);
  ok('a start date drops the pre-term Monday from what is expected',
     st.totals.expected === 1, 'expected ' + st.totals.expected);
  ok('...and the teacher is not marked as having missed it',
     st.totals.missing === 0, 'missing ' + st.totals.missing);

  const r = ctx.studentReport_(ctx.studentById_('S1'),
    { from: '0001-01-01', to: AFTER, key: 'all', label: 'all' }, ctx.registers_());
  ok('...and the pre-term absence leaves the student record',
     r.totals.total === 1 && r.totals.absent === 0, r.totals.total + ' marks, ' + r.totals.absent + ' absent');

  const ov = ctx.apiStudentOverview('tb', '0001-01-01', AFTER);
  ok('...and the admin overview agrees with it',
     ov.students[0].total === 1, ov.students[0].total);

  ok('"All time" now starts at the first day of term',
     ctx.rangeDates_('all').from === TERM, ctx.rangeDates_('all').from);
}
{
  const { ctx } = termWorld(TERM);
  const boot = ctx.apiBootstrap('tg', BEFORE, 0);
  const day = boot.days.filter(d => d.date === BEFORE)[0];
  ok('a pre-term day offers no lessons', day.lessons.length === 0, day.lessons.length);
  ok('...and says why', day.holiday === 'Before term starts', day.holiday);
  ok('...and is not editable', day.editable === false, String(day.editable));

  const after = ctx.apiBootstrap('tg', AFTER, 0).days.filter(d => d.date === AFTER)[0];
  ok('a day inside term still works', after.lessons.length === 1 && !after.holiday, after.holiday);

  const bad = ctx.apiSave('tg', { date: BEFORE, classId: 'Y13-CHEMISTRY', period: '1', statuses: { S1: 'P' } });
  ok('saving before term is refused', bad.ok === false && /school year starts/.test(bad.error), bad.error);
  const good = ctx.apiSave('tg', { date: AFTER, classId: 'Y13-CHEMISTRY', period: '1', statuses: { S1: 'P' } });
  ok('...and saving inside term still works', good.ok === true, good.error || '');
}
{
  const { ctx } = termWorld('not a date');
  ok('an unreadable start date is ignored rather than guessed', ctx.termStart_() === '', ctx.termStart_());
  let said = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b) => { said = String(b || ''); }, ButtonSet: { OK: 1 }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.checkData();
  ok('...and checkData says so', said.indexOf('"Term starts" is not a date') !== -1, said.split('\n')[0]);
}

/* ------------------------------------------- earlier-today strip ---- */
console.log('\nEarlier-today strip');
{
  const D = '2026-09-07';
  // Aro's day: P1 absent, P2 late, no P3 lesson, P4 present, no P5, P6 register not yet
  // taken. Bala shares P1 and P2 only. The P7 register is the one under test.
  const { ctx } = world({
    Settings: settings(),
    Timetable: [TTH,
      lesson('Gzng', '13', 'Chemistry', 1, 'CBP'),
      lesson('Gzng', '13', 'Physics', 2, 'CBP'),
      lesson('Gzng', '13', 'Biology', 4, 'CBP'),
      lesson('Gzng', '13', 'English', 6, 'CBP'),
      lesson('Gzng', '13', 'Mathematics', 7, 'CBP')],
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', ''], ['S2', 'Bala', '13', 'CBP', 't2', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH,
      reg('Y13-CHEMISTRY', D, 1, 'Gzng', { S1: 'A', S2: 'P' }),
      reg('Y13-PHYSICS', D, 2, 'Gzng', { S1: 'L', S2: 'L' }),
      reg('Y13-BIOLOGY', D, 4, 'Gzng', { S1: 'P' })]
  });
  const day = ctx.apiBootstrap('tg', D, 0).days.filter(d => d.date === D)[0];
  const at = p => day.lessons.filter(l => l.period === String(p))[0];
  const who = (p, id) => at(p).students.filter(s => s.id === id)[0];

  const aro = who(7, 'S1');
  ok('a period-7 register carries six characters, one per earlier period',
     aro.prev.length === 6, JSON.stringify(aro.prev));
  ok('...reading absent, late, nothing, present, nothing, nothing',
     aro.prev === 'AL-P--', aro.prev);

  const bala = who(7, 'S2');
  ok('a student with a different day keeps the SAME six slots',
     bala.prev === 'PL----' && bala.prev.length === aro.prev.length, bala.prev);

  ok('the strip stops at the lesson being taken', who(4, 'S1').prev === 'AL-', who(4, 'S1').prev);
  ok('period 2 sees only period 1', who(2, 'S1').prev === 'A', who(2, 'S1').prev);
  ok('the first lesson of the day has no strip', who(1, 'S1').prev === '', who(1, 'S1').prev);

  // A period the student sat in but nobody has registered yet must read as unknown,
  // never as present — that would invent attendance out of an unfilled register.
  ok('an untaken register reads as nothing, not as present',
     aro.prev.charAt(5) === '-', aro.prev.charAt(5));
}
{
  // "Show prev flag = No" must switch the whole strip off, not just the colour.
  const D = '2026-09-07';
  const { ctx } = world({
    Settings: settings().map(r => r[0] === 'Show "prev" flag' ? ['Show "prev" flag', 'No', ''] : r),
    Timetable: [TTH, lesson('Gzng', '13', 'Chemistry', 1, 'CBP'), lesson('Gzng', '13', 'Physics', 2, 'CBP')],
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH, reg('Y13-CHEMISTRY', D, 1, 'Gzng', { S1: 'A' })]
  });
  const day = ctx.apiBootstrap('tg', D, 0).days.filter(d => d.date === D)[0];
  const p2 = day.lessons.filter(l => l.period === '2')[0];
  ok('the setting still turns it off', p2.students[0].prev === '', p2.students[0].prev);
}

/* ----------------------------------------- rebuild option codes ---- */
console.log('\nRebuild option codes');
function rebuildWorld(timetable, say) {
  const { ctx, grids } = world({
    Settings: settings(),
    Timetable: timetable,
    Students: [STUH, ['S1', 'Aro', '12', 'CBP', 't1', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH]
  });
  let asked = '', told = '';
  let first = true;
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b, set) => {
      const body = String(b === undefined ? t : b);
      if (set === 'OKCANCEL') { asked = body; return first ? (first = false, 'ok') : 'ok'; }
      told = body; return 'ok';
    },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OKCANCEL' }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  if (say === 'cancel') {
    ctx.SpreadsheetApp.getUi = () => ({
      alert: (t, b, set) => { if (set === 'OKCANCEL') { asked = String(b); return 'no'; } told = String(b); return 'ok'; },
      ButtonSet: { OK: 'OK', OK_CANCEL: 'OKCANCEL' }, Button: { OK: 'ok' },
      prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
    });
  }
  ctx.rebuildOptionCodes();
  return { ctx, grids, asked, told };
}

const AS = [TTH,
  lesson('Gzng', '12', 'Chemistry 1', 1, ''),
  lesson('Rawa', '12', 'Chemistry 2', 2, ''),
  lesson('Kale', '12', 'Biology 1', 3, ''),
  lesson('Haval', '12', 'Biology 2', 4, ''),
  lesson('Areena', '12', 'Physics 1', 5, ''),
  lesson('Arkan', '12', 'Physics 2', 6, ''),
  lesson('Sara', '12', 'Mathematics', 7, ''),
  lesson('Dara', '12', 'Statistics', 8, ''),
  lesson('Nawa', '12', 'English', 1, ''),
  lesson('Hero', '12', 'IT', 2, ''),
  lesson('Zana', '12', 'Games', 3, 'KEEPME')];
{
  const { grids, told, asked } = rebuildWorld(AS);
  const tt = grids.Timetable;
  const opts = s => (tt.filter(r => r[2] === s)[0] || [])[9];
  const list = s => String(opts(s) || '').split(',').map(x => x.trim()).filter(String);

  ok('Chemistry 1 takes every code with C in slot 1',
     list('Chemistry 1').join(' ') === 'CBE CBP CME CMP CPE', opts('Chemistry 1'));
  ok('Chemistry 2 takes every code with C in slot 3',
     list('Chemistry 2').join(' ') === 'BMC BPC IBC IMC IPC', opts('Chemistry 2'));
  ok('the two Chemistry groups share no code at all',
     !list('Chemistry 1').some(c => list('Chemistry 2').indexOf(c) !== -1));
  ok('Biology 1 is slot 1, Biology 2 is slot 2, and they are disjoint',
     list('Biology 1').join(' ') === 'BMC BME BMP BPC BPE' &&
     !list('Biology 1').some(c => list('Biology 2').indexOf(c) !== -1),
     opts('Biology 1') + '   /   ' + opts('Biology 2'));
  ok('Physics 1 is slot 2, Physics 2 is slot 3, and they are disjoint',
     list('Physics 1').join(' ') === 'BPC BPE CPE IPC IPE' &&
     !list('Physics 1').some(c => list('Physics 2').indexOf(c) !== -1),
     opts('Physics 1') + '   /   ' + opts('Physics 2'));

  ok('CBP is in Chemistry 1, Biology 2 and Physics 2',
     list('Chemistry 1').indexOf('CBP') !== -1 && list('Biology 2').indexOf('CBP') !== -1 &&
     list('Physics 2').indexOf('CBP') !== -1);
  ok('BPC is in Biology 1, Physics 1 and Chemistry 2',
     list('Biology 1').indexOf('BPC') !== -1 && list('Physics 1').indexOf('BPC') !== -1 &&
     list('Chemistry 2').indexOf('BPC') !== -1);

  ok('a single-group subject takes all eight of its codes',
     list('IT').length === 8 && list('Mathematics').length === 8 && list('English').length === 8,
     [list('IT').length, list('Mathematics').length, list('English').length].join('/'));
  ok('Statistics gets the Mathematics codes, because it reports as Mathematics',
     list('Statistics').join(' ') === list('Mathematics').join(' '), opts('Statistics'));

  ok('a subject the blocks do not name keeps what it had', opts('Games') === 'KEEPME', opts('Games'));
  ok('...and the confirmation says so before anything is written',
     /Left untouched[\s\S]*AS Games/.test(asked),
     (asked.split('Left untouched')[1] || asked).split('\n').slice(0, 3).join(' ').trim());
  ok('the run reports 18 codes for Year 12', /Year 12: 18 codes/.test(told), told.split('\n')[2]);
}
{
  /* When most of the sheet cannot be placed, the setting is wrong — not the sheet. Saying
     "left untouched" in a calm voice next to eight empty registers is how someone clicks
     past it, which is exactly what happened with a Timetable using Roman numerals. */
  const { asked } = rebuildWorld([TTH,
    lesson('Gzng', '12', 'Chemistry I', 1, ''), lesson('Rawa', '12', 'Chemistry II', 2, ''),
    lesson('Kale', '12', 'Biology I', 3, ''), lesson('Haval', '12', 'Biology II', 4, ''),
    lesson('Areena', '12', 'Physics I', 5, ''), lesson('Arkan', '12', 'Physics II', 6, ''),
    lesson('Sara', '12', 'Mathematics', 7, ''), lesson('Nawa', '12', 'English', 1, '')]);
  ok('a Timetable the blocks mostly cannot name is stopped, not noted',
     /!! STOP/.test(asked), (asked.match(/!! STOP[^\n]*/) || [''])[0].slice(0, 90));
  ok('...saying how many of how many', /6 of 8 classes are NOT named/.test(asked),
     (asked.match(/\d+ of \d+ classes[^.]*/) || [''])[0]);
  ok('...and that those registers open empty', /open EMPTY/.test(asked));
}
{
  const { grids, asked } = rebuildWorld(AS, 'cancel');
  ok('cancelling changes nothing',
     grids.Timetable.filter(r => r[2] === 'Chemistry 1')[0][9] === '',
     JSON.stringify(grids.Timetable.filter(r => r[2] === 'Chemistry 1')[0][9]));
  ok('...after showing what it would have done', /Chemistry 1/.test(asked) && /CBE, CBP/.test(asked));
}
{
  // The Year 13 failure, and the check that now names its cure.
  const { ctx } = world({
    Settings: settings(),
    Timetable: [TTH, lesson('Gzng', '13', 'Chemistry', 1, 'PCB, PCM')],
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH]
  });
  let said = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b) => { said = String(b || ''); }, ButtonSet: { OK: 1 }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.checkData();
  ok('a timetable in a different slot order is still an error',
     /is not offered in Year 13/.test(said), said.split('\n')[0]);
  ok('...but it now says the letters exist in another order',
     /same letters in another slot order/.test(said), said.split('\n')[0]);
  ok('...and names the fix', /Rebuild option codes/.test(said), said.split('\n')[0]);
}


/* --------------------------------- repair student option codes ---- */
console.log('\nRepair student option codes');
function repairWorld(students, tracks, answer) {
  const { ctx, grids } = world({
    Settings: settings(),
    Timetable: [TTH, lesson('Gzng', '13', 'Chemistry', 1, ''), lesson('Rawa', '12', 'IT', 1, '')],
    Students: [STUH].concat(students),
    Track_Changes: [['StudentID', 'Student', 'Effective from', 'From track', 'To track',
                     'Carry over', 'Note']].concat(tracks || []),
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH]
  });
  let asked = '', told = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b, set) => {
      const body = String(b === undefined ? t : b);
      if (set === 'OKCANCEL') { asked = body; return answer === 'cancel' ? 'no' : 'ok'; }
      told = body; return 'ok';
    },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OKCANCEL' }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.repairStudentOptions();
  return { ctx, grids, asked, told };
}
{
  /* The tool exists because the school writes the same combination two ways: the
     timetable export orders the slots differently from the way codes are issued to
     students. A Year 13 code typed in the export's order is not a code Year 13 offers,
     and the letters point at exactly one that is. */
  const wrong = [['PCB', 'CBP'], ['PCM', 'CMP'], ['EIB', 'IBE'], ['PIM', 'IMP'],
                 ['ECM', 'CME'], ['ECB', 'CBE'], ['EIM', 'IME'], ['PIB', 'IBP'],
                 ['PBM', 'BMP'], ['EBM', 'BME']];
  const { grids, asked } = repairWorld(
    wrong.map((p, i) => ['S' + i, 'Student ' + i, '13', p[0], 't' + i, '']));
  const got = grids.Students.slice(1).map(r => r[3]);
  ok('a Year 13 code in the export ordering is rewritten into the issued one',
     got.join(' ') === wrong.map(p => p[1]).join(' '), got.join(' '));
  ok('...and the confirmation showed each one', /PCB\s+→\s+CBP/.test(asked), asked.split('\n')[2]);
}
{
  // The guard: Year 12 CBP and BPC are different classes, so neither may be guessed at.
  const { grids, told } = repairWorld([['S1', 'Ambiguous', '12', 'PBC', 't1', '']]);
  ok('a Year 12 code with two candidates is NOT rewritten',
     grids.Students[1][3] === 'PBC', grids.Students[1][3]);
  ok('...and both candidates are named',
     /could be/.test(told) && /CBP/.test(told) && /BPC/.test(told),
     (told.split('\n').filter(l => /could be/.test(l))[0] || told).trim());
}
{
  const { grids, told } = repairWorld([['S1', 'Fine', '13', 'CMP', 't1', '']]);
  ok('a code that is already right is left alone',
     grids.Students[1][3] === 'CMP', grids.Students[1][3]);
  ok('...and the tool says there is nothing to do', /already match/.test(told), told.split('\n')[0]);
}
{
  const { grids, told } = repairWorld([['S1', 'Junk', '13', 'XYZ', 't1', '']]);
  ok('a code that is simply wrong is left alone', grids.Students[1][3] === 'XYZ');
  ok('...and reported as not offered', /is not a code Year 13 offers/.test(told), told.split('\n')[1]);
}
{
  const { grids } = repairWorld(
    [['S1', 'Aro', '13', 'PCB', 't1', '']],
    [['S1', 'Aro', '2026-10-01', 'PCB', 'PIM', 'Yes', '']]);
  ok('a track change is migrated too, both ends',
     grids.Track_Changes[1][3] === 'CBP' && grids.Track_Changes[1][4] === 'IMP',
     grids.Track_Changes[1].slice(3, 5).join(' / '));
}
{
  const { grids } = repairWorld([['S1', 'Aro', '13', 'PCB', 't1', '']], null, 'cancel');
  ok('cancelling writes nothing', grids.Students[1][3] === 'PCB', grids.Students[1][3]);
}

/* ------------------------------------------ identical rosters ---- */
console.log('\nTwo classes, one roster');
function checkWith(timetable) {
  const { ctx } = world({
    Settings: settings(),
    Timetable: timetable,
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', ''], ['S2', 'Bala', '13', 'CBP', 't2', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH]
  });
  let said = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b) => { said = String(b || ''); }, ButtonSet: { OK: 1 }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.checkData();
  return said;
}
{
  const said = checkWith([TTH,
    lesson('Gzng', '13', 'Chemistry 1', 1, 'CBP'),
    lesson('Rawa', '13', 'Chemistry 2', 2, 'CBP')]);
  ok('two groups of one subject with the same codes are reported',
     /hold exactly the same 2 students/.test(said), said.split('\n')[0]);
  ok('...naming both classes', /Chemistry 1/.test(said) && /Chemistry 2/.test(said),
     said.split('\n')[0]);
}
{
  const said = checkWith([TTH,
    lesson('Haval', '13', 'Mathematics', 1, 'CBP'),
    lesson('Areena', '13', 'Mechanics', 2, 'CBP')]);
  ok('a subject and its rollup component are NOT reported',
     !/hold exactly the same/.test(said), said.split('\n').filter(l => /exactly/.test(l))[0] || '');
}

/* -------------------------------------------- the strip markup ---- */
// The tile is drawn inside an IIFE, so lift the three helpers out of App.html and run
// them on their own. Cheap, but it is the actual markup a teacher looks at.
console.log('\nBadge markup');
{
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, 'App.html'), 'utf8');
  const grab = name => {
    const m = html.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}', 'm'));
    if (!m) throw new Error('could not find ' + name + ' in App.html');
    return m[0];
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WORD = { P: 'Present', L: 'Late', A: 'Absent' };
  const api = new Function('esc', 'WORD', 'var DOTW={P:"present",L:"late",A:"absent"};' +
    grab('prevDots') + grab('prevSay') + grab('tileLabel') +
    ';return {prevDots:prevDots,tileLabel:tileLabel};')(esc, WORD);

  ok('no earlier periods draws no strip', api.prevDots({ name: 'Aro' }) === '');

  const dots = api.prevDots({ name: 'Aro', prev: 'AL-P--' });
  const each = dots.match(/<span class="pd"[^>]*>\d+<\/span>/g) || [];
  ok('six characters make six dots', each.length === 6, each.length);
  ok('...numbered 1 to 6 in order',
     each.map(d => d.replace(/[^\d]/g, '')).join('') === '123456',
     each.map(d => d.replace(/[^\d]/g, '')).join(''));
  ok('...each tagged with its own status, so CSS colours them independently',
     each.map(d => (d.match(/data-p="(.)"/) || [])[1]).join('') === 'AL-P--',
     each.map(d => (d.match(/data-p="(.)"/) || [])[1]).join(''));
  ok('the strip is hidden from screen readers, which read the label instead',
     /aria-hidden="true"/.test(dots));

  ok('a gap keeps its slot rather than closing up',
     api.prevDots({ name: 'B', prev: 'P-----' }).indexOf('<span class="pd" data-p="-">6</span>') !== -1,
     api.prevDots({ name: 'B', prev: 'P-----' }));

  ok('the label names only what a teacher needs to act on',
     api.tileLabel({ name: 'Aro', prev: 'AL-P--' }, 'P') ===
     'Aro, Present. Earlier today: absent in period 1, late in period 2',
     api.tileLabel({ name: 'Aro', prev: 'AL-P--' }, 'P'));
  ok('...saying nothing when the day has been clean',
     api.tileLabel({ name: 'Aro', prev: 'PP-P--' }, 'P') === 'Aro, Present',
     api.tileLabel({ name: 'Aro', prev: 'PP-P--' }, 'P'));
  ok('...and nothing at all on the first lesson',
     api.tileLabel({ name: 'Aro', prev: '' }, 'P') === 'Aro, Present');
}

/* ------------------------------ the two reports must never disagree ---- */
// apiTeacherStats (JSON, for the app) and runReport (rows, for the sheet) are the same
// question asked twice. They used to hold two copies of the walk, and the copies had
// already drifted on a lesson with no teacher. Both now go through eachDueLesson_.
console.log('\nOne walk, two reports');
{
  const D1 = '2026-09-07', D2 = '2026-09-14', D3 = '2026-09-21';   // three Mondays
  const { ctx, grids } = world({
    Settings: settings([['Holidays', D3, ''], ['Term starts', '2026-09-01', '']]),
    Timetable: [TTH,
      lesson('Gzng', '13', 'Chemistry', 1, 'CBP'),
      lesson('Rawa', '13', 'Physics', 2, 'CBP'),
      ['', '13', 'Biology 1', 'A', 'Mon', '3', '09:00', '09:45', 'R1', 'BMP']],  // no teacher
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', ''], ['S2', 'Bal', '13', 'BMP', 't2', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', ''],
                     ['T02', 'Rawa', 'r@s', 'Teacher', 'tr', ''],
                     ['T03', 'Boss', 'b@s', 'Admin', 'tb', '']],
    Leave: [['Teacher', 'From', 'To', 'Periods', 'Reason'],
            ['Rawa', D2, D2, '', 'Course']],
    Registers: [REGH, reg('Y13-CHEMISTRY', D1, 1, 'Gzng', { S1: 'P' })]
  });

  const st = ctx.apiTeacherStats('tb', D1, D3);
  ctx.runReport(D1, D3, false);
  const rows = (grids.Report_Teachers || []).filter(r => r[0] && r[0] !== 'Teacher' &&
    typeof r[2] === 'number');
  const sheet = {};
  rows.forEach(r => { sheet[r[0]] = { expected: r[2], taken: r[3], excused: r[5] }; });
  const app = {};
  st.teachers.forEach(t => { app[t.name] = { expected: t.expected, taken: t.taken, excused: t.excused }; });

  ok('both reports name the same teachers',
     Object.keys(sheet).sort().join(',') === Object.keys(app).sort().join(','),
     'sheet ' + Object.keys(sheet).sort() + '  |  app ' + Object.keys(app).sort());
  ok('...including the lesson with no teacher, under one agreed label',
     !!sheet['(unassigned)'] && !!app['(unassigned)'],
     Object.keys(sheet).join(','));
  ok('...and every figure matches',
     Object.keys(app).every(k => sheet[k] && sheet[k].expected === app[k].expected &&
       sheet[k].taken === app[k].taken && sheet[k].excused === app[k].excused),
     JSON.stringify(sheet) + ' vs ' + JSON.stringify(app));

  ok('the holiday is excluded from both', app.Gzng.expected === 2, app.Gzng.expected);
  ok('leave excuses a lesson rather than counting it missing',
     app.Rawa.excused === 1 && app.Rawa.expected === 1,
     'excused ' + app.Rawa.excused + ', expected ' + app.Rawa.expected);
  ok('a register taken on a leave day still counts as taken, not excused',
     app.Gzng.taken === 1 && app.Gzng.excused === 0,
     'taken ' + app.Gzng.taken + ', excused ' + app.Gzng.excused);
}

/* ---------------------------- checkData names what it is accusing ---- */
console.log('\ncheckData is specific');
{
  // An ID that differs only in case is the common real error, and hunting for it through
  // 87 rows is the cost of a message that only says "not a StudentID".
  const { ctx } = world({
    Settings: settings(),
    Timetable: [TTH, lesson('Gzng', '13', 'Chemistry', 1, 'CBP')],
    Students: [STUH, ['S034', 'Aro', '13', 'CBP', 't1', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH],
    Enrolment: [['StudentID', 'Student', 'Subject', 'Taking', 'Effective from',
                 'Count earlier as absent', 'Note'],
                ['s034', 'Aro', 'Chemistry', 'No', '', '', '']]
  });
  let said = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b) => { said = String(b || ''); }, ButtonSet: { OK: 1 }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.checkData();
  ok('a lower-case StudentID is still an error',
     /"s034" is not a StudentID/.test(said), said.split('\n').filter(l => /s034/.test(l))[0]);
  ok('...but it names the row it almost certainly meant',
     /did you mean S034\?/.test(said), said.split('\n').filter(l => /s034/.test(l))[0]);
}
{
  // Three different subjects with one roster is usually a popular combination, not a bug.
  // Naming the shared code is what lets an admin tell those two cases apart at a glance.
  const { ctx } = world({
    Settings: settings(),
    Timetable: [TTH, lesson('Gzng', '13', 'Chemistry', 1, 'CBP'),
                     lesson('Rawa', '13', 'Physics', 2, 'CBP'),
                     lesson('Kale', '13', 'Biology II', 3, 'CBP')],
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', ''], ['S2', 'Bal', '13', 'CBP', 't2', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH]
  });
  let said = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b) => { said = String(b || ''); }, ButtonSet: { OK: 1 }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.checkData();
  const line = said.split('\n').filter(l => /exactly the same/.test(l))[0] || '';
  ok('an identical roster names the code behind it', /all on the one code CBP/.test(line),
     line.slice(0, 120));
  ok('...and says how to tell a real problem from a popular combination',
     /popular combination/.test(line) && /separate teaching groups/.test(line));
}

/* ------------------------------ checkData reports the worst first ---- */
// The alert shows at most 30 lines. It used to take them in source order, and the
// per-student loop is written before the settings checks — so on a sheet with enough
// option-code typos, "Term starts is not a date the app can read" fell off the bottom.
// That is the single most consequential line the check can emit.
console.log('\ncheckData, worst first');
function flood(n) {
  const students = [STUH];
  for (let i = 0; i < n; i++) students.push(['S' + i, 'Student ' + i, '13', 'ZZZ', 't' + i, '']);
  const { ctx } = world({
    Settings: settings([['Term starts', 'the fourteenth', '']]),
    Timetable: [TTH, lesson('Gzng', '13', 'Chemistry', 1, 'CBP')],
    Students: students,
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH]
  });
  let said = '', title = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b) => { title = String(t); said = String(b || ''); },
    ButtonSet: { OK: 1 }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.checkData();
  return { said, title };
}
{
  const { said, title } = flood(60);
  ok('60 broken students overflow the 30-line alert',
     /Found \d+ thing\(s\) to fix/.test(title) && Number(title.match(/\d+/)[0]) > 30, title);
  ok('the unreadable term start still makes the cut',
     /"Term starts" is not a date/.test(said), said.split('\n').slice(0, 3).join(' | '));
  ok('...under a heading that says it stops things working',
     said.indexOf('STOPS THINGS WORKING') < said.indexOf('"Term starts"'),
     said.split('\n')[0]);
  ok('the per-student typos are demoted below it',
     said.indexOf('STOPS THINGS WORKING') < said.indexOf('WRONG NUMBERS'),
     said.split('\n').filter(l => /^[A-Z ]+$/.test(l.trim())).join(' / '));
  ok('and the alert admits what it left out',
     /…and \d+ more/.test(said), (said.match(/…and .*/) || [''])[0]);
}
{
  const { said, title } = flood(1);
  ok('a clean-ish sheet still lists everything', !/…and \d+ more/.test(said), title);
  ok('an empty class names the fix', /Rebuild option codes/.test(said),
     (said.split('\n').filter(l => /No students in/.test(l))[0] || '').trim().slice(0, 100));
}

/* ---------------------- the wrapper and the app must draw the same ---- */
// attendance.html paints a cached first screen and App.html replaces it moments later.
// Anything the two compute differently shows up as a visible jump at the swap — which
// is the one thing that screen exists to prevent. These two helpers had drifted.
console.log('\nWrapper and app agree');
{
  const fs = require('fs');
  // Through SRC, so this finds the wrapper under the name Pages serves it as.
  const grab = (file, re) => {
    const m = fs.readFileSync(SRC(file), 'utf8').match(re);
    if (!m) throw new Error('could not find the helper in ' + file);
    return m[0];
  };
  const appIni = new Function(grab('App.html', /function ini\(n\)\{[\s\S]*?\n?\}/) + ';return ini;')();
  const shellIni = new Function(grab('attendance.html', /function initials\(n\)\{[\s\S]*?\n  \}/) +
    ';return initials;')();

  [['Mary Jane Watson', 'MW'], ['Anna de Souza', 'AS'], ['Jo Ann Mary Lee', 'JL'],
   ['Aro Abdullah', 'AA'], ['Cher', 'C']].forEach(function (c) {
    ok('initials agree on "' + c[0] + '"', appIni(c[0]) === shellIni(c[0]) && appIni(c[0]) === c[1],
       'app ' + appIni(c[0]) + '  shell ' + shellIni(c[0]) + '  want ' + c[1]);
  });

  // App.html's esc is a one-liner whose body contains braces, so take the whole line.
  const appEsc = new Function(grab('App.html', /function esc\(s\)\{.*\}\);\}/) + ';return esc;')();
  const shellEsc = new Function(grab('attendance.html', /function esc\(s\)\{[\s\S]*?\n  \}/) + ';return esc;')();
  ['<b>', '"quoted"', "O'Brien", 'a & b'].forEach(function (s) {
    ok('esc agrees on ' + JSON.stringify(s), appEsc(s) === shellEsc(s),
       'app ' + appEsc(s) + '  shell ' + shellEsc(s));
  });
}

/* -------------------- a block name the Timetable does not have ---- */
/* The quiet failure. rebuildOptionCodes LEAVES a row it cannot place rather than
   blanking it — right, because a subject outside the option system must not lose its
   codes — but that means a Timetable saying "Biology" while the blocks say "Biology 1"
   survives the rebuild looking successful and keeps codes that match nobody. The first
   anyone hears of it is a teacher opening a register with no students in it. */
console.log('\nOption blocks vs the Timetable');
function nameCheck(timetable) {
  const { ctx } = world({
    Settings: settings(),
    Timetable: timetable,
    Students: [STUH, ['S1', 'Aro', '13', 'CBP', 't1', '']],
    Teachers: [TEAH, ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', '']],
    Registers: [REGH]
  });
  let said = '';
  ctx.SpreadsheetApp.getUi = () => ({
    alert: (t, b) => { said = String(b || ''); }, ButtonSet: { OK: 1 }, Button: { OK: 'ok' },
    prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '' })
  });
  ctx.checkData();
  return said;
}
{
  // Blocks name Biology 1 and Biology 2; the Timetable has one undivided "Biology".
  const said = nameCheck([TTH,
    lesson('Gzng', '13', 'Chemistry', 1, ''), lesson('Gzng', '13', 'IT', 2, ''),
    lesson('Gzng', '13', 'Biology', 3, ''), lesson('Gzng', '13', 'Mathematics', 4, ''),
    lesson('Gzng', '13', 'Physics', 5, ''), lesson('Gzng', '13', 'English', 6, '')]);
  ok('an unsplit subject is named, not left to be discovered by a teacher',
     /Option blocks names "Biology 1"/.test(said), said.split('\n').filter(l => /Biology 1/.test(l))[0]);
  ok('...for both halves', /Biology 2/.test(said));
  ok('...saying which slot, so the letter can be traced',
     /in slot 1 of Year 13/.test(said));
  ok('...and it stops things working, not merely worth tidying',
     said.indexOf('STOPS THINGS WORKING') < said.indexOf('Option blocks names'));
  ok('the subjects that DO match are not reported',
     !/names "Chemistry"|names "Physics"|names "English"/.test(said));
}
{
  const said = nameCheck([TTH,
    lesson('Gzng', '13', 'Chemistry', 1, ''), lesson('Gzng', '13', 'IT', 2, ''),
    lesson('Gzng', '13', 'Biology 1', 3, ''), lesson('Gzng', '13', 'Biology 2', 4, ''),
    lesson('Gzng', '13', 'Mathematics', 5, ''), lesson('Gzng', '13', 'Physics', 6, ''),
    lesson('Gzng', '13', 'English', 7, '')]);
  ok('a Timetable that matches the blocks says nothing',
     !/Option blocks names/.test(said), said.split('\n').filter(l => /Option blocks/.test(l))[0] || '');
}
{
  // Year 12 is in the blocks but not timetabled at all here. Listing its nine classes
  // would bury everything else, and "you have not entered Year 12 yet" is not news.
  const said = nameCheck([TTH,
    lesson('Gzng', '13', 'Chemistry', 1, ''), lesson('Gzng', '13', 'IT', 2, ''),
    lesson('Gzng', '13', 'Biology 1', 3, ''), lesson('Gzng', '13', 'Biology 2', 4, ''),
    lesson('Gzng', '13', 'Mathematics', 5, ''), lesson('Gzng', '13', 'Physics', 6, ''),
    lesson('Gzng', '13', 'English', 7, '')]);
  ok('a year with no timetable rows at all is not enumerated',
     !/Year 12/.test(said), said.split('\n').filter(l => /Year 12/.test(l))[0] || '');
}

ok.done();
