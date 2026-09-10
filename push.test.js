/* Push notifications.
 *
 * The ES256 signer is hand-rolled because Apps Script has no elliptic curve at all, so
 * it is checked the only way worth trusting: every signature it produces is handed to
 * Node's own crypto to VERIFY. That tests the arithmetic against a real implementation
 * rather than against my expectations of it.
 */
const { loadWith, reporter } = require('./harness.js');
const crypto = require('crypto');
const ok = reporter();

const FILE = process.env.CODE_FILE || undefined;
const { ctx } = loadWith({}, { sheetData: {
  Settings: [['Setting', 'Value', 'What it does'], ['Timezone', 'Europe/London', '']],
  Timetable: [['Teacher', 'Year', 'Subject', 'Block', 'Day', 'Period', 'Start', 'End', 'Room', 'Options']],
  Students: [['StudentID', 'Name', 'Year', 'Option', 'Token', 'My attendance link']],
  Teachers: [['TeacherID', 'Teacher', 'Email', 'Role', 'Token', 'Attendance link']],
  Registers: [['SessionKey', 'Date', 'Period', 'ClassID', 'Teacher', 'Present', 'Late', 'Absent',
               'Total', 'Saved at', 'Statuses']],
  Leave: [['Teacher', 'From', 'To', 'Periods', 'Reason']],
  Track_Changes: [['StudentID', 'Student', 'Effective from', 'From track', 'To track', 'Carry over', 'Note']],
  Enrolment: [['StudentID', 'Student', 'Subject', 'Taking', 'Effective from', 'Count earlier as absent', 'Note']],
  Attendance_Log: [['SessionKey']]
}, file: FILE });

/* ------------------------------- will Apps Script accept the file? ---- */
/* Node parses things Apps Script's editor refuses, so `node --check` passing means
   nothing about whether this can be pasted in. A BigInt literal is the one that bit:
   `0n` is a ParseError there, and the whole file is rejected — no deploy, no app, on a
   Monday morning. Every constant is built by calling BigInt() instead, and this keeps
   it that way. */
console.log('\nApps Script will parse this');
{
  const src = require('fs').readFileSync(require('path').join(__dirname, 'Code.gs'), 'utf8');
  const code = src.split('\n').filter((l) => {
    const t = l.trim();
    return t && t[0] !== '*' && t.slice(0, 2) !== '//' && t.slice(0, 2) !== '/*';
  }).join('\n');
  const banned = [
    [/\b\d+n\b/, 'BigInt literals — call BigInt(n); the editor rejects the n suffix'],
    [/\?\./, 'optional chaining'],
    [/\?\?/, 'nullish coalescing'],
    [/[\w)\]] *\*\* *[\w(]/, 'the ** operator — use Math.pow']
  ];
  banned.forEach(function (pair) {
    const m = code.match(pair[0]);
    ok('Code.gs has no ' + pair[1], !m, m ? 'found ' + JSON.stringify(m[0]) : '');
  });
  ok('the curve constants are built by calling BigInt',
     (src.match(/BigInt\(/g) || []).length >= 8, (src.match(/BigInt\(/g) || []).length + ' calls');
}

/* ------------------------------------------------ curve sanity ---- */
console.log('\nP-256 arithmetic');
{
  const G = { X: ctx.P256.gx, Y: ctx.P256.gy, Z: 1n };
  const pt = (a) => a.x.toString(16) + ',' + a.y.toString(16);
  const onCurve = (pt) => {
    const p = ctx.P256.p;
    const lhs = (pt.y * pt.y) % p;
    const rhs = (((pt.x * pt.x % p) * pt.x % p) - 3n * pt.x + ctx.P256.b) % p;
    return lhs === ((rhs % p) + p) % p;
  };
  ok('the generator is on the curve', onCurve(ctx.jacAffine_(G)));
  ok('2G is on the curve', onCurve(ctx.jacAffine_(ctx.jacDouble_(G))));
  ok('G + G === 2G',
     pt(ctx.jacAffine_(ctx.jacAdd_(G, G))) === pt(ctx.jacAffine_(ctx.jacDouble_(G))));
  ok('5G by addition === 5G by multiplication', (function () {
    let acc = { X: 1n, Y: 1n, Z: 0n };
    for (let i = 0; i < 5; i++) acc = ctx.jacAdd_(acc, G);
    return pt(ctx.jacAffine_(acc)) === pt(ctx.jacAffine_(ctx.jacMul_(5n, G)));
  })());
  // n is the order of the group: n*G must be the point at infinity.
  ok('n·G is the point at infinity', ctx.jacMul_(ctx.P256.n, G).Z === 0n);
  ok('an arbitrary multiple stays on the curve',
     onCurve(ctx.jacAffine_(ctx.jacMul_(BigInt('0x1f2e3d4c5b6a7988'), G))));
}

/* ------------------------------------ signatures Node will accept ---- */
console.log('\nES256 signatures, verified by Node');

// A P-256 key made by Node, so the private scalar is not one this code chose.
function nodeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const d = BigInt('0x' + Buffer.from(jwk.d, 'base64url').toString('hex'));
  return { d, publicKey, jwk };
}
// r||s -> the DER form Node's verifier expects.
function toDer(sig) {
  const int = (b) => {
    let i = 0; while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  };
  const r = int(Buffer.from(sig.slice(0, 32)));
  const s = int(Buffer.from(sig.slice(32)));
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s]);
}
const verify = (pub, msg, sig) =>
  crypto.createVerify('SHA256').update(Buffer.from(msg)).end().verify(pub, toDer(sig));

const bytes = (s) => Array.from(Buffer.from(s, 'utf8'));
{
  const k = nodeKey();
  const msg = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL2V4YW1wbGUuY29tIn0';
  const sig = ctx.es256Sign_(k.d, bytes(msg));

  ok('a signature is 64 raw bytes', sig.length === 64, sig.length);
  ok('Node verifies it', verify(k.publicKey, msg, sig));
  ok('Node rejects it against a different message', !verify(k.publicKey, msg + 'x', sig));

  const other = nodeKey();
  ok('Node rejects it against a different key', !verify(other.publicKey, msg, sig));

  const flipped = sig.slice(); flipped[10] ^= 1;
  ok('a single flipped bit fails verification', !verify(k.publicKey, msg, flipped));
}
{
  // Determinism is the whole reason for RFC 6979: no RNG to get wrong.
  const k = nodeKey();
  const m = bytes('the same message');
  const a = ctx.es256Sign_(k.d, m), b = ctx.es256Sign_(k.d, m);
  ok('the same key and message give the identical signature', a.join(',') === b.join(','));
  const c = ctx.es256Sign_(k.d, bytes('a different message'));
  ok('...and a different message does not', a.join(',') !== c.join(','));
}
{
  // Twenty independent keys and messages, every one checked by Node. One-off luck
  // in the modular arithmetic would not survive this.
  let pass = 0;
  for (let i = 0; i < 20; i++) {
    const k = nodeKey();
    const m = 'msg-' + i + '-' + crypto.randomBytes(8).toString('hex');
    if (verify(k.publicKey, m, ctx.es256Sign_(k.d, bytes(m)))) pass++;
  }
  ok('20 random key/message pairs all verify', pass === 20, pass + '/20');
}
{
  // Low-S: half the ecosystem rejects the high form, and a signer that is accepted by
  // some push services and not others is worse than one that fails everywhere.
  const half = ctx.P256.n / 2n;
  let high = 0;
  for (let i = 0; i < 20; i++) {
    const k = nodeKey();
    const sig = ctx.es256Sign_(k.d, bytes('m' + i));
    let s = 0n;
    for (const b of sig.slice(32)) s = (s << 8n) | BigInt(b);
    if (s > half) high++;
  }
  ok('every signature is in low-S form', high === 0, high + ' high');
}
{
  // The public key this code derives must be the one Node derived for the same scalar.
  let same = 0;
  for (let i = 0; i < 5; i++) {
    const k = nodeKey();
    const mine = Buffer.from(ctx.es256Public_(k.d)).toString('hex');
    const theirs = Buffer.concat([Buffer.from([4]),
      Buffer.from(k.jwk.x, 'base64url'), Buffer.from(k.jwk.y, 'base64url')]).toString('hex');
    if (mine === theirs) same++;
  }
  ok('the derived public key matches Node for 5 keys', same === 5, same + '/5');
  ok('...and is 65 bytes, uncompressed', ctx.es256Public_(nodeKey().d).length === 65);
}

/* ================================================ subscriptions and sending ==== */
const TTH = ['Teacher', 'Year', 'Subject', 'Block', 'Day', 'Period', 'Start', 'End', 'Room', 'Options'];
const PUSHH = ['Key', 'Who', 'Role', 'Endpoint', 'P256dh', 'Auth', 'Device',
               'Subscribed', 'Last result', 'Pending'];
const lesson = (teacher, subject, day, period) =>
  [teacher, '13', subject, 'A', day, String(period), '09:00', '09:45', 'R1', 'CBP'];

function world(over) {
  const base = {
    Settings: [['Setting', 'Value', 'What it does'],
      ['Timezone', 'Europe/London', ''], ['Teaching days', 'Sun,Mon,Tue,Wed,Thu', ''],
      ['Holidays', '', ''], ['Term starts', '', ''], ['Push contact', 'mailto:o@s.org', '']],
    Timetable: [TTH],
    Students: [['StudentID', 'Name', 'Year', 'Option', 'Token', 'My attendance link'],
      ['S1', 'Aro', '13', 'CBP', 'stu1', '']],
    Teachers: [['TeacherID', 'Teacher', 'Email', 'Role', 'Token', 'Attendance link'],
      ['T01', 'Gzng', 'g@s', 'Teacher', 'tg', ''],
      ['T02', 'Rawa', 'r@s', 'Teacher', 'tr', ''],
      ['T03', 'Boss', 'b@s', 'Admin', 'tb', '']],
    Registers: [['SessionKey', 'Date', 'Period', 'ClassID', 'Teacher', 'Present', 'Late', 'Absent',
                 'Total', 'Saved at', 'Statuses']],
    Leave: [['Teacher', 'From', 'To', 'Periods', 'Reason']],
    Track_Changes: [['StudentID', 'Student', 'Effective from', 'From track', 'To track', 'Carry over', 'Note']],
    Enrolment: [['StudentID', 'Student', 'Subject', 'Taking', 'Effective from', 'Count earlier as absent', 'Note']],
    Attendance_Log: [['SessionKey']],
    Push_Subs: [PUSHH]
  };
  return loadWith({}, { sheetData: Object.assign(base, over || {}), file: FILE });
}
const sub = (ep) => ({ endpoint: ep, keys: { p256dh: 'pk', auth: 'au' } });

console.log('\nSubscribing');
{
  const w = world();
  const r1 = w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/AAA'), 'Pixel');
  ok('a teacher can subscribe', r1.ok === true && !!r1.key, r1.error || r1.key);
  ok('the row records who and what role',
     w.grids.Push_Subs[1][1] === 'Gzng' && w.grids.Push_Subs[1][2] === 'teacher',
     w.grids.Push_Subs[1].slice(1, 3).join('/'));

  const r2 = w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/AAA'), 'Pixel');
  ok('re-subscribing the same device replaces, never stacks',
     w.grids.Push_Subs.length === 2, w.grids.Push_Subs.length - 1 + ' rows');
  ok('...and keeps the device key, so the worker does not go stale', r2.key === r1.key);

  w.ctx.apiPushSubscribe('tg', sub('https://web.push.apple.com/BBB'), 'iPhone');
  ok('a second device gets its own row', w.grids.Push_Subs.length === 3);

  ok('a student can subscribe too, as a student',
     w.ctx.apiPushSubscribe('stu1', sub('https://fcm.googleapis.com/wp/CCC'), 'phone').ok &&
     w.grids.Push_Subs[3][2] === 'student', w.grids.Push_Subs[3][2]);
  ok('an unknown token cannot', w.ctx.apiPushSubscribe('nope', sub('https://x/1'), '').ok === false);
  ok('and neither can an empty subscription', w.ctx.apiPushSubscribe('tg', null, '').ok === false);

  const key = w.grids.Push_Subs[1][0];
  w.ctx.apiPushUnsubscribe(key);
  ok('unsubscribing removes just that row', w.grids.Push_Subs.length === 3 &&
     !w.grids.Push_Subs.some(r => r[0] === key));
}

console.log('\nSending');
{
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/AAA'), 'Pixel');
  w.ctx.apiPushSubscribe('tr', sub('https://web.push.apple.com/BBB'), 'iPhone');
  const rows = w.ctx.pushSubs_();
  const res = w.ctx.pushSendAll_(rows, { title: 'Hi', body: 'There', url: '' });

  ok('both devices were sent to', res.sent === 2, JSON.stringify(res));
  ok('the POST goes to the browser-supplied endpoint',
     w.fetchOutbox.map(r => r.url).sort().join(' ') ===
     'https://fcm.googleapis.com/wp/AAA https://web.push.apple.com/BBB',
     w.fetchOutbox.map(r => r.url).join(' '));
  ok('every request carries a VAPID header',
     w.fetchOutbox.every(r => /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(r.headers.Authorization)),
     w.fetchOutbox[0].headers.Authorization.slice(0, 60));
  ok('...and no body at all — nothing to encrypt, nothing to leak',
     w.fetchOutbox.every(r => r.payload === undefined));

  // aud is the SERVICE origin, so two services means two distinct JWTs, not two per device.
  const auds = w.fetchOutbox.map(r => JSON.parse(
    Buffer.from(r.headers.Authorization.split('t=')[1].split('.')[1], 'base64url').toString()).aud);
  ok('each push service gets a header addressed to itself',
     auds.sort().join(' ') === 'https://fcm.googleapis.com https://web.push.apple.com', auds.join(' '));

  const pend = JSON.parse(w.grids.Push_Subs[1][9]);
  ok('the text is written to the row, not carried in the push',
     pend.title === 'Hi' && pend.body === 'There', w.grids.Push_Subs[1][9]);
}
{
  // A browser that has thrown the subscription away answers 410. Keeping the row would
  // mean retrying it every afternoon forever.
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/GONE'), 'old');
  w.ctx.apiPushSubscribe('tr', sub('https://fcm.googleapis.com/wp/LIVE'), 'new');
  w.setFetchReply(r => /GONE/.test(r.url) ? 410 : 201);
  const res = w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'x', body: 'y' });

  ok('a dead subscription is counted as gone', res.gone === 1 && res.sent === 1, JSON.stringify(res));
  ok('...and its row is deleted', w.grids.Push_Subs.length === 2 &&
     /LIVE/.test(w.grids.Push_Subs[1][3]), w.grids.Push_Subs.length - 1 + ' left');
}
{
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/A'), 'p');
  w.setFetchReply(() => 500);
  const res = w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'x', body: 'y' });
  ok('a server error is a failure, not a deletion',
     res.failed === 1 && w.grids.Push_Subs.length === 2, JSON.stringify(res));
  ok('...and the reason is recorded on the row', /500/.test(String(w.grids.Push_Subs[1][8])),
     w.grids.Push_Subs[1][8]);
}
{
  /* fetchAll is all-or-nothing: one malformed request throws and takes the batch with it.
     The catch used to discard the exception and write nothing, which surfaced as
     "0 delivered, 2 failed" with an empty Last result column — a report that named a
     problem and destroyed the only evidence of what it was. */
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/A'), 'p');
  w.ctx.apiPushSubscribe('tr', sub('https://fcm.googleapis.com/wp/B'), 'q');
  let batched = 0;
  const realAll = w.ctx.UrlFetchApp.fetchAll;
  w.ctx.UrlFetchApp.fetchAll = () => { batched++; throw new Error('Attribute provided with invalid value: Content-Length'); };
  const res = w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'x', body: 'y' });

  ok('a thrown batch is retried one device at a time', batched === 1 && res.sent === 2,
     JSON.stringify(res));
  ok('...so one bad request cannot silence everybody', res.failed === 0);
  ok('...and the reason is handed back, not swallowed',
     /Content-Length/.test(res.error || ''), res.error);
  ok('...with every row carrying its own outcome',
     w.grids.Push_Subs.slice(1).every(r => String(r[8]).trim()),
     JSON.stringify(w.grids.Push_Subs.slice(1).map(r => r[8])));
  w.ctx.UrlFetchApp.fetchAll = realAll;
}
{
  // A device that fails on its own, inside a batch that itself threw.
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/A'), 'p');
  w.ctx.UrlFetchApp.fetchAll = () => { throw new Error('boom'); };
  w.ctx.UrlFetchApp.fetch = () => { throw new Error('DNS error'); };
  const res = w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'x', body: 'y' });
  ok('a device that throws on its own is recorded, not lost',
     res.failed === 1 && /DNS error/.test(String(w.grids.Push_Subs[1][8])),
     w.grids.Push_Subs[1][8]);
}
{
  // Content-Length is computed by UrlFetchApp; setting it by hand is what threw.
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/A'), 'p');
  w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'x', body: 'y' });
  ok('no Content-Length header is set by hand',
     w.fetchOutbox.every(r => !('Content-Length' in (r.headers || {}))),
     JSON.stringify(Object.keys(w.fetchOutbox[0].headers)));
}
{
  // What the service worker fetches when it wakes.
  const w = world();
  const key = w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/A'), 'p').key;
  w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'Two registers', body: 'A2 Chemistry P1' });

  const got = w.ctx.pushPending_(key);
  ok('the worker gets the message by device key', got && got.title === 'Two registers',
     JSON.stringify(got));
  ok('reading it clears it, so it cannot show twice', w.ctx.pushPending_(key) === null);
  ok('an unknown key gets nothing', w.ctx.pushPending_('not-a-key') === null);

  const out = w.ctx.doGet({ parameter: { push: '1', k: key } });
  ok('doGet answers the worker with JSON', out.getContent() === '{}', out.getContent());
}

{
  /* The fallback path — one request at a time, after a whole batch threw — used to write
     "gone" on a dead device's row and keep it. That row then went on counting its owner
     as reachable, so they were never asked to turn notifications on again. */
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/GONE'), 'old');
  w.ctx.apiPushSubscribe('tr', sub('https://fcm.googleapis.com/wp/LIVE'), 'new');
  w.ctx.UrlFetchApp.fetchAll = () => { throw new Error('batch threw'); };
  w.setFetchReply(r => /GONE/.test(r.url) ? 410 : 201);
  const res = w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'x', body: 'y' });
  ok('the fallback path counts a dead device as gone', res.gone === 1 && res.sent === 1,
     JSON.stringify(res));
  ok('...and deletes its row, exactly as the batch path does',
     w.grids.Push_Subs.length === 2 && /LIVE/.test(w.grids.Push_Subs[1][3]),
     w.grids.Push_Subs.slice(1).map(r => r[3]).join(' '));
  ok('...leaving the live one with its own outcome, undisturbed',
     /201/.test(String(w.grids.Push_Subs[1][8])), w.grids.Push_Subs[1][8]);
}

console.log('\nWho is reachable');
{
  /* The question the opt-in bar asks before nagging. It has to agree with the office's
     report, and it has to go false the moment a person's last device is pruned — that is
     what gets them asked again. */
  const w = world();
  ok('nobody is reachable before subscribing', w.ctx.pushReachable_('Gzng') === false);
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/ONLY'), 'phone');
  ok('a subscription makes them reachable', w.ctx.pushReachable_('Gzng') === true);
  ok('...matched the way the report matches, not by exact spelling',
     w.ctx.pushReachable_('  gzng ') === true);
  ok('...and nobody else is', w.ctx.pushReachable_('Rawa') === false);
  ok('a blank name is never reachable', w.ctx.pushReachable_('') === false);
  w.setFetchReply(() => 410);
  w.ctx.pushSendAll_(w.ctx.pushSubs_(), { title: 'x', body: 'y' });
  ok('once their only device is reported gone they are unreachable — and asked again',
     w.ctx.pushReachable_('Gzng') === false);
}
{
  /* doGet is the one place pushOn is set: once per open, never on the poll. The harness
     has no HtmlService, so a template stand-in records what doGet hands it. */
  const w = world();
  const tpl = {};
  w.ctx.HtmlService = {
    createTemplateFromFile: () => Object.assign(tpl, {
      evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; },
                         setXFrameOptionsMode() { return this; } })
    }),
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
  };
  const bootOf = (tok) => { w.ctx.doGet({ parameter: { t: tok } }); return JSON.parse(tpl.boot); };
  const before = bootOf('tg');
  ok('a teacher with no device is told so', before.ok === true && before.pushOn === false,
     JSON.stringify({ ok: before.ok, pushOn: before.pushOn, error: before.error }));
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/D1'), 'phone');
  ok('...and told otherwise once they have one', bootOf('tg').pushOn === true);
  const stu = bootOf('stu1');
  ok('a student is covered too', stu.ok === true && stu.pushOn === false,
     JSON.stringify({ ok: stu.ok, pushOn: stu.pushOn }));
}

console.log('\nThe afternoon reminder');
function reminderWorld(day, over) {
  const w = world(Object.assign({
    Timetable: [TTH, lesson('Gzng', 'Chemistry', day, 1), lesson('Gzng', 'Physics', day, 2),
                     lesson('Rawa', 'Biology', day, 3)]
  }, over || {}));
  w.ctx.today_ = () => '2026-09-07';          // a Monday
  w.ctx.apiPushSubscribe('tg', sub('https://fcm.googleapis.com/wp/G'), 'Gzng phone');
  w.ctx.apiPushSubscribe('tr', sub('https://fcm.googleapis.com/wp/R'), 'Rawa phone');
  return w;
}
{
  const w = reminderWorld('Mon');
  const r = w.ctx.pushMissingRegisters();
  ok('two teachers owe registers', r.teachers === 2, JSON.stringify(r));
  ok('both are reached', r.sent === 2, r.sent);
  const msg = JSON.parse(w.grids.Push_Subs[1][9]);
  ok('the message counts them and names the lessons',
     /2 registers not taken/.test(msg.title) && /A2 Chemistry P1/.test(msg.body),
     msg.title + ' — ' + msg.body);
}
{
  // Every exclusion the office asked for, one at a time.
  const w = reminderWorld('Sun');   // lessons exist, but Sunday is not a teaching day here
  ok('nobody is reminded on a non-teaching day', w.ctx.pushMissingRegisters().teachers === 0);
}
{
  const w = reminderWorld('Mon', {
    Settings: [['Setting', 'Value', 'What it does'], ['Timezone', 'Europe/London', ''],
      ['Teaching days', 'Sun,Mon,Tue,Wed,Thu', ''], ['Holidays', '2026-09-07', ''],
      ['Term starts', '', ''], ['Push contact', 'mailto:o@s.org', '']] });
  ok('nobody is reminded on a holiday', w.ctx.pushMissingRegisters().teachers === 0);
}
{
  const w = reminderWorld('Mon', {
    Settings: [['Setting', 'Value', 'What it does'], ['Timezone', 'Europe/London', ''],
      ['Teaching days', 'Sun,Mon,Tue,Wed,Thu', ''], ['Holidays', '', ''],
      ['Term starts', '2026-09-14', ''], ['Push contact', 'mailto:o@s.org', '']] });
  ok('nobody is reminded before term starts', w.ctx.pushMissingRegisters().teachers === 0);
}
{
  const w = reminderWorld('Mon', {
    Leave: [['Teacher', 'From', 'To', 'Periods', 'Reason'],
            ['Gzng', '2026-09-07', '2026-09-07', '', 'Course']] });
  const r = w.ctx.pushMissingRegisters();
  ok('a teacher on leave is not chased', r.teachers === 1, JSON.stringify(r));
  ok('...but the colleague who is in still is',
     JSON.parse(w.grids.Push_Subs[2][9]).body.indexOf('Biology') !== -1,
     w.grids.Push_Subs[2][9]);
  ok('...and the one on leave gets nothing', !String(w.grids.Push_Subs[1][9]).trim());
}
{
  const w = reminderWorld('Mon');
  const reg = w.grids.Registers;
  ['Y13-CHEMISTRY|2026-09-07|1', 'Y13-PHYSICS|2026-09-07|2'].forEach((k, i) =>
    reg.push([k, '2026-09-07', String(i + 1), k.split('|')[0], 'Gzng', 1, 0, 0, 1,
              '2026-09-07 10:00', '{"S1":"P"}']));
  const r = w.ctx.pushMissingRegisters();
  ok('a teacher who has taken every register is left alone', r.teachers === 1, JSON.stringify(r));
  ok('...and it is the other one who hears about it',
     JSON.parse(w.grids.Push_Subs[2][9]).title.indexOf('1 register') === 0,
     w.grids.Push_Subs[2][9]);
}
{
  const w = reminderWorld('Mon');
  w.ctx.apiPushUnsubscribe(w.grids.Push_Subs[1][0]);
  const r = w.ctx.pushMissingRegisters();
  ok('a teacher with notifications off is still counted but not reachable',
     r.teachers === 2 && r.reached === 1, JSON.stringify(r));
}

console.log('\nBroadcast targeting');
{
  const w = world();
  w.ctx.apiPushSubscribe('tg', sub('https://p/1'), 'a');
  w.ctx.apiPushSubscribe('tr', sub('https://p/2'), 'b');
  w.ctx.apiPushSubscribe('tb', sub('https://p/3'), 'c');
  w.ctx.apiPushSubscribe('stu1', sub('https://p/4'), 'd');
  const subs = w.ctx.pushSubs_();
  const names = (list) => list.map(s => s.who).sort().join(',');

  ok('all reaches everybody', names(w.ctx.pushTargets_('all', subs)) === 'Aro,Boss,Gzng,Rawa');
  ok('a blank audience means all', w.ctx.pushTargets_('', subs).length === 4);
  ok('by role: teachers', names(w.ctx.pushTargets_('teacher', subs)) === 'Gzng,Rawa');
  ok('by role: admins', names(w.ctx.pushTargets_('admin', subs)) === 'Boss');
  ok('by role: students', names(w.ctx.pushTargets_('student', subs)) === 'Aro');
  ok('by name, one', names(w.ctx.pushTargets_('Rawa', subs)) === 'Rawa');
  ok('by name, several', names(w.ctx.pushTargets_('Rawa, Aro', subs)) === 'Aro,Rawa');
  ok('names are matched loosely enough to survive spacing',
     names(w.ctx.pushTargets_('  rawa ,  BOSS ', subs)) === 'Boss,Rawa');
  ok('a name nobody has matches nobody', w.ctx.pushTargets_('Nobody', subs).length === 0);
}

console.log('\nVAPID keys');
{
  const w = world();
  const pub = w.ctx.vapidPublic_();
  ok('the public key is 65 bytes, base64url', Buffer.from(pub, 'base64url').length === 65, pub.length);
  ok('...and starts with the uncompressed-point marker',
     Buffer.from(pub, 'base64url')[0] === 4);
  ok('the private key is kept in Script Properties, not the sheet',
     /^[0-9a-f]{64}$/.test(w.props.VAPID_PRIVATE || ''), (w.props.VAPID_PRIVATE || '').length);
  ok('it is generated once and then reused', w.ctx.vapidPublic_() === pub);

  const w2 = world();
  ok('a different deployment gets a different key', w2.ctx.vapidPublic_() !== pub);
}

/* ============================================ the opt-in, in a real DOM ==== */
/* attendance.html asks for permission and holds the subscription; App.html registers
   it. Neither half can do the other's job, so the handshake between them is where this
   breaks, and it is worth running rather than reasoning about. */
console.log('\nThe opt-in bar');
const { JSDOM } = require('jsdom');
const { SRC } = require('./harness.js');
const WRAP = require('fs').readFileSync(SRC('attendance.html'), 'utf8');

function shell(opts) {
  opts = opts || {};
  const seen = { subscribed: null, posted: [], swConfig: [], permissionAsked: 0 };
  const dom = new JSDOM(WRAP, {
    url: 'https://x.github.io/attendance/' + (opts.search || ''),
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      // Without a stored code the wrapper shows its sign-in screen and never boots.
      const store = Object.assign({ 'attendance-code': 'tokM' }, opts.store || {});
      Object.defineProperty(w, 'localStorage', { value: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      }});
      w.__store = store;
      if (opts.ua) Object.defineProperty(w.navigator, 'userAgent', { value: opts.ua });
      if (opts.standalone !== undefined) w.navigator.standalone = opts.standalone;
      w.matchMedia = () => ({ matches: !!opts.installed });
      if (!opts.unsupported) {
        w.PushManager = function () {};
        w.Notification = {
          permission: opts.permission || 'default',
          requestPermission: () => { seen.permissionAsked++; return Promise.resolve(opts.grant || 'granted'); }
        };
        const worker = { postMessage: (m) => seen.swConfig.push(m) };
        const registration = {
          active: worker, showNotification: (t, o) => { seen.shown = { t, o }; return Promise.resolve(); },
          pushManager: {
            getSubscription: () => Promise.resolve(opts.existing || null),
            subscribe: (o) => { seen.subscribed = o; return Promise.resolve({
              endpoint: 'https://fcm.googleapis.com/wp/TEST', keys: { p256dh: 'pk', auth: 'au' },
              toJSON() { return { endpoint: this.endpoint, keys: this.keys }; }
            }); }
          }
        };
        Object.defineProperty(w.navigator, 'serviceWorker', { value: {
          ready: Promise.resolve(registration),
          controller: worker,
          register: () => (opts.swFails ? Promise.reject(new Error(opts.swFails)) : Promise.resolve(registration))
        }});
      }
      w.__seen = seen;
    }
  });
  const w = dom.window;
  // Stand in for the app: record what the wrapper sends us.
  const app = { postMessage: (m) => seen.posted.push(m) };
  // source is read-only on a MessageEvent, so it goes in the constructor.
  const fire = (data) => w.dispatchEvent(new w.MessageEvent('message', { data: data, source: app }));
  fire('attendance:ready');
  return { dom, w, seen, app, send: fire };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

(async function () {
  {
    const s = shell({ ua: 'Mozilla/5.0 (Linux; Android 14)' });
    ok('the bar is hidden until the app says push is available', s.w.document.getElementById('notifBar').hidden);
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('...and appears once it does', s.w.document.getElementById('notifBar').hidden === false);

    s.w.document.getElementById('notifYes').click();
    await tick();
    ok('tapping Turn on asks the browser for permission', s.seen.permissionAsked === 1);
    ok('...subscribes with userVisibleOnly, which iOS demands',
       s.seen.subscribed && s.seen.subscribed.userVisibleOnly === true);
    ok('...and converts the key to bytes rather than passing the string',
       s.seen.subscribed && s.seen.subscribed.applicationServerKey instanceof s.w.Uint8Array);

    const out = s.seen.posted.filter((m) => m && m.type === 'attendance:push-subscribe');
    ok('the subscription is handed to the app, which is the half that can save it',
       out.length === 1 && out[0].sub.endpoint === 'https://fcm.googleapis.com/wp/TEST',
       JSON.stringify(out[0] && out[0].sub));
    ok('...tagged with the platform, so the office can tell two devices apart',
       out[0].device === 'Android', out[0].device);
    ok('the bar closes after answering', s.w.document.getElementById('notifBar').hidden);

    s.send({ type: 'attendance:push-registered', v: 1, key: 'dev-key-1' });
    await tick();
    const cfg = s.seen.swConfig.filter((m) => m.key === 'dev-key-1');
    ok('the device key reaches the service worker', cfg.length === 1, JSON.stringify(s.seen.swConfig));
    ok('...along with where to fetch the text', /script\.google\.com/.test(cfg[0].url), cfg[0].url);
    ok('...and it is remembered for next launch',
       s.w.__store['attendance-push:tokM'] === 'dev-key-1' ||
       Object.keys(s.w.__store).some((k) => s.w.__store[k] === 'dev-key-1'),
       JSON.stringify(s.w.__store));
  }
  {
    const s = shell({ ua: 'Mozilla/5.0 (Android)' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    s.w.document.getElementById('notifNo').click();
    await tick();
    ok('Not now hides the bar', s.w.document.getElementById('notifBar').hidden);
    ok('...and is remembered, so it stops nagging',
       Object.keys(s.w.__store).some((k) => /declined/.test(k)));
  }
  /* The device's own date, the way the wrapper writes it. */
  const d0 = new Date();
  const TODAY = d0.getFullYear() + '-' + ('0' + (d0.getMonth() + 1)).slice(-2) + '-' +
                ('0' + d0.getDate()).slice(-2);
  {
    /* "Not now" was remembered forever — one tap made someone unreachable for good, with
       no route back from anywhere in the product. It now holds for the rest of the day
       and asks again tomorrow, every day, until the answer is yes. */
    const s0 = shell({ ua: 'Mozilla/5.0 (Android)' });
    s0.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    s0.w.document.getElementById('notifNo').click();
    ok('Not now is written down as today, not as forever',
       s0.w.__store['attendance-push:declined'] === TODAY, s0.w.__store['attendance-push:declined']);

    const same = shell({ ua: 'Mozilla/5.0 (Android)', store: { 'attendance-push:declined': TODAY } });
    same.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('so the rest of the day is quiet', same.w.document.getElementById('notifBar').hidden);

    const next = shell({ ua: 'Mozilla/5.0 (Android)', store: { 'attendance-push:declined': '2020-01-01' } });
    next.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('...and it asks again another day', next.w.document.getElementById('notifBar').hidden === false);

    // An older build wrote '1', meaning never ask again. That is not today, so it asks.
    const legacy = shell({ ua: 'Mozilla/5.0 (Android)', store: { 'attendance-push:declined': '1' } });
    legacy.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('an old permanent refusal does not carry over',
       legacy.w.document.getElementById('notifBar').hidden === false);

    const t = shell({ ua: 'Mozilla/5.0 (Android)', store: { 'attendance-push:declined': TODAY },
                      search: '?notify=1' });
    t.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('...?notify=1 still offers it on demand', t.w.document.getElementById('notifBar').hidden === false);
    ok('...and clears the snooze, so it stays offered', !t.w.__store['attendance-push:declined']);
  }
  {
    /* Enabling once is enough. When the server says this person already has a live
       device, another device is not asked — that would be nagging someone who said yes. */
    const s = shell({ ua: 'Mozilla/5.0 (Android)' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey', reachable: true });
    await tick();
    ok('someone reachable on another device is not asked',
       s.w.document.getElementById('notifBar').hidden && s.seen.permissionAsked === 0);

    const u = shell({ ua: 'Mozilla/5.0 (Android)' });
    u.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey', reachable: false });
    await tick();
    ok('someone reachable nowhere is', u.w.document.getElementById('notifBar').hidden === false);

    const g = shell({ ua: 'Mozilla/5.0 (Android)', permission: 'granted' });
    g.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey', reachable: true });
    await tick();
    ok('a device already on still re-subscribes, reachable elsewhere or not',
       g.seen.posted.some((m) => m && m.type === 'attendance:push-subscribe'));

    const q = shell({ ua: 'Mozilla/5.0 (Android)', search: '?notify=1' });
    q.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey', reachable: true });
    await tick();
    ok('...and ?notify=1 offers it regardless', q.w.document.getElementById('notifBar').hidden === false);
  }
  {
    // iOS gives the Push API to an installed app only. A button that cannot work,
    // offered to the people most likely to tap it, is worse than no button.
    /* Silence here was wrong. Installing is the ONE step that makes notifications
       possible on iOS, the teacher cannot guess it, and they are holding the app open. */
    const s = shell({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', installed: false, standalone: false });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('a browser tab on iOS is told how to install, not left silent',
       s.w.document.getElementById('notifBar').hidden === false &&
       /Add to Home Screen/.test(s.w.document.getElementById('notifText').textContent),
       s.w.document.getElementById('notifText').textContent.slice(0, 80));
    ok('...with no Turn on button, because it could not work there',
       s.w.document.getElementById('notifYes').hidden);
    s.w.document.getElementById('notifNo').click();
    await tick();
    ok('..."Got it" holds for the day, like Not now',
       s.w.__store['attendance-push:ios-told'] === TODAY, s.w.__store['attendance-push:ios-told']);

    const again = shell({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', installed: false,
                          store: { 'attendance-push:ios-told': TODAY } });
    again.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('...so the rest of the day is quiet', again.w.document.getElementById('notifBar').hidden);

    /* An iPhone in a browser tab is the one device that can never be reached, so it is
       the one most worth reminding — every day, not once and then never again. */
    const later = shell({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', installed: false,
                          store: { 'attendance-push:ios-told': '1' } });
    later.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('...and it is told again on another day', later.w.document.getElementById('notifBar').hidden === false);

    const elsewhere = shell({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', installed: false });
    elsewhere.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey', reachable: true });
    await tick();
    ok('...unless they are already reachable on another device',
       elsewhere.w.document.getElementById('notifBar').hidden);

    const t = shell({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', installed: true });
    t.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('...but the installed app is', t.w.document.getElementById('notifBar').hidden === false);
  }
  {
    const s = shell({ ua: 'Mozilla/5.0 (Android)', permission: 'granted' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('an already-granted device is not asked again', s.seen.permissionAsked === 0);
    ok('...but re-subscribes anyway, because iOS silently drops subscriptions',
       s.seen.posted.some((m) => m && m.type === 'attendance:push-subscribe'));
    ok('...and the bar never appears', s.w.document.getElementById('notifBar').hidden);
  }
  {
    const s = shell({ ua: 'Mozilla/5.0 (Android)', permission: 'denied' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('a device that said no is left alone', s.w.document.getElementById('notifBar').hidden &&
       s.seen.permissionAsked === 0);
  }
  {
    const s = shell({ unsupported: true, ua: 'Mozilla/5.0 (Android)' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('a browser without the Push API shows nothing and does not throw',
       s.w.document.getElementById('notifBar').hidden);
  }
  {
    const s = shell({ ua: 'Mozilla/5.0 (Android)' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: '' });
    await tick();
    ok('no application server key means no offer',
       s.w.document.getElementById('notifBar').hidden);
  }
  /* Every one of these was a bare `return` with no feedback. That is right on an
     ordinary load and useless to someone who has been told to turn notifications on and
     cannot see how — so ?notify=1 makes the bar appear anyway and say why. */
  /* The worker has to be told where to fetch a notification's text. reg.active is null
     on a FIRST registration and controller is null until the worker takes control, so
     the original code posted to nothing on the one run that mattered — and the worker
     woke with no config, showing a generic message instead of the real one. */
  console.log('\nThe worker gets its config');
  {
    const s = shell({ ua: 'Mozilla/5.0 (Android)', permission: 'granted',
                      store: { 'attendance-push:tokM': 'known-key' } });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('a key stored from a previous run is handed over on launch',
       s.seen.swConfig.some((m) => m.key === 'known-key'),
       JSON.stringify(s.seen.swConfig));
    ok('...with the address it should ask',
       (s.seen.swConfig[0] || {}).url && /script\.google\.com/.test(s.seen.swConfig[0].url));
  }
  {
    // The bisect: draw a notification locally, with no push service involved.
    const s = shell({ ua: 'Mozilla/5.0 (Android)', permission: 'granted', search: '?notify=1' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    const yes = s.w.document.getElementById('notifYes');
    ok('an already-on device is offered a local test', yes.hidden === false &&
       /Show a test/.test(yes.textContent), yes.textContent);
    yes.click();
    await tick();
    ok('...which draws a notification without any push',
       s.seen.shown && /Test notification/.test(s.seen.shown.t), JSON.stringify(s.seen.shown && s.seen.shown.t));
    ok('...saying what its result means',
       /delivery problem, not a settings one/.test((s.seen.shown || {}).o.body),
       ((s.seen.shown || {}).o || {}).body);
  }

  console.log('\nWhy the bar is not showing');
  const reason = async (opts) => {
    const s = shell(Object.assign({ search: '?notify=1' }, opts));
    s.send({ type: 'attendance:push-ready', v: 1, vapid: opts.vapid === undefined ? 'BFakeKey' : opts.vapid });
    await tick();
    const bar = s.w.document.getElementById('notifBar');
    return bar.hidden ? '(still hidden)' : s.w.document.getElementById('notifText').textContent;
  };
  {
    const r = await reason({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', installed: false });
    ok('an uninstalled iPhone is told to add it to the home screen',
       /Add to Home Screen/.test(r), r);
  }
  {
    const r = await reason({ ua: 'Mozilla/5.0 (Android)', vapid: '' });
    ok('a missing key blames the deploy, not the teacher',
       /redeploy/.test(r) && /office/.test(r), r);
  }
  {
    const r = await reason({ ua: 'Mozilla/5.0 (Android)', permission: 'denied' });
    ok('a blocked device points at device settings',
       /blocked/.test(r) && /device settings/.test(r), r);
  }
  {
    const r = await reason({ ua: 'Mozilla/5.0 (Android)', permission: 'granted' });
    ok('an already-on device says so, and offers a local test',
       /Notifications are on for this device/.test(r) && /without any push involved/.test(r), r);
  }
  {
    const r = await reason({ ua: 'Mozilla/5.0 (Android)', swFails: 'Failed to register' });
    ok('a missing sw.js names the file and how to check it',
       /sw\.js/.test(r) && /beside index\.html/.test(r), r);
  }
  {
    /* Without ?notify=1 the diagnostics stay hidden. The iOS install advice is the one
       deliberate exception — it is guidance, not a diagnosis, and it is the only thing
       standing between that teacher and a working notification. */
    const s = shell({ ua: 'Mozilla/5.0 (Android)', permission: 'denied' });
    s.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('a normal load explains nothing to nobody',
       s.w.document.getElementById('notifBar').hidden);

    const q = shell({ ua: 'Mozilla/5.0 (Android)', permission: 'denied', search: '?notify=1' });
    q.send({ type: 'attendance:push-ready', v: 1, vapid: 'BFakeKey' });
    await tick();
    ok('...until it is asked to', q.w.document.getElementById('notifBar').hidden === false);
  }
  ok.done();
})();
