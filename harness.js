/* The Apps Script stub, in one place.
 *
 * There is no Apps Script test runner, so every server-side spec evaluates the real
 * Code.gs in a vm against fake Google services. That stub used to be copied into each
 * spec, and the specs that did not copy it required each other instead — which ran the
 * other spec's assertions as a side effect of loading it. One harness, five specs.
 */
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');

/* Apps Script byte arrays are signed. A string is UTF-8 first. */
const toBuf = (v) => typeof v === 'string' ? Buffer.from(v, 'utf8')
  : Buffer.from(Array.prototype.map.call(v, (b) => b & 0xff));
const toSigned = (buf) => Array.prototype.map.call(buf, (b) => b > 127 ? b - 256 : b);

/* Beside the caller first, then one level up, so the suite runs from a flat checkout
   or from tests/. Hard-coding '../Code.gs' once made the whole suite silently test a
   stale copy sitting in the parent folder. */
/* The wrapper is checked in under the name Pages actually serves it as, index.html,
   while six specs still ask for it by the name it carries in the spec. One alias here
   beats six copies of the fallback — and beats the whole wrapper half of the suite
   dying on ENOENT, which is how this was found. */
const ALIAS = { 'attendance.html': ['index.html'] };
const SRC = f => [f].concat(ALIAS[f] || [])
  .reduce((found, n) => found ||
    [path.join(__dirname, n), path.join(__dirname, '..', n)].find(fs.existsSync), null) || f;

const pad = n => ('0' + n).slice(-2);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Only the patterns Code.gs actually asks for. Add a new format string there and it
   must be added here too, or this silently returns a raw Date. */
function formatDate(d, tz, pat) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  switch (pat) {
    case 'yyyy-MM-dd': return y + '-' + pad(m + 1) + '-' + pad(day);
    case 'EEE': return DOW[d.getDay()];
    case 'EEEE': return DOWFULL[d.getDay()];
    case 'd MMM yyyy': return day + ' ' + MON[m] + ' ' + y;
    case 'd MMM': return day + ' ' + MON[m];
    case 'EEEE d MMM': return DOWFULL[d.getDay()] + ' ' + day + ' ' + MON[m];
    case 'EEE d MMM': return DOW[d.getDay()] + ' ' + day + ' ' + MON[m];
    case 'HH:mm': return pad(d.getHours()) + ':' + pad(d.getMinutes());
    case 'H': return String(d.getHours());
    case 'MM-dd HH:mm': return pad(m + 1) + '-' + pad(day) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    case 'yyyy-MM-dd HH:mm:ss':
      return y + '-' + pad(m + 1) + '-' + pad(day) + ' ' +
             pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    default: return String(d);
  }
}

/* A spreadsheet that actually stores things.
 *
 * setup() and refreshDerived() are the two functions a user runs from the menu, and
 * they were the only untested part of the file because the old stub could not survive
 * them — the first .clear() threw. This grid is enough to run them end to end and
 * then assert on what they wrote.
 *
 * A1 notation only goes as far as these two need: "L1", "B2:C1000", "D2:D1000".
 */
function makeSheets(initial) {
  const grids = {};
  Object.keys(initial || {}).forEach(n => { grids[n] = (initial[n] || []).map(r => r.slice()); });

  /* Which validation rule ended up on which cell, keyed "Sheet!row,col".
     Formatting is a no-op here, but validation is not decoration: a rule on the wrong
     row is what put a Yes/No dropdown on Holidays and refused the dates it is for.
     null means the cell was explicitly cleared. */
  const dv = {};

  const colNum = s => s.split('').reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
  function parseA1(a1) {
    const m = String(a1).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) return { row: 1, col: 1, rows: 1, cols: 1 };
    const r1 = +m[2], c1 = colNum(m[1]);
    const r2 = m[4] ? +m[4] : r1, c2 = m[3] ? colNum(m[3]) : c1;
    return { row: r1, col: c1, rows: r2 - r1 + 1, cols: c2 - c1 + 1 };
  }

  function sheet(name) {
    if (!grids[name]) grids[name] = [];
    const g = () => grids[name];
    const at = (r, c) => { const row = g()[r - 1]; return row ? (row[c - 1] === undefined ? '' : row[c - 1]) : ''; };
    function range(row, col, rows, cols) {
      const api = {
        getRow: () => row,
        getValue: () => at(row, col),
        setValue(v) { this.setValues([[v]]); return this; },
        getValues() {
          const out = [];
          for (let r = 0; r < rows; r++) {
            const line = [];
            for (let c = 0; c < cols; c++) line.push(at(row + r, col + c));
            out.push(line);
          }
          return out;
        },
        setValues(vals) {
          vals.forEach((line, r) => {
            const target = row + r - 1;
            while (g().length <= target) g().push([]);
            line.forEach((v, c) => { g()[target][col + c - 1] = v; });
          });
          return this;
        },
        clearContent() { for (let r = 0; r < rows; r++) if (g()[row + r - 1]) g()[row + r - 1] = []; return this; },
        createTextFinder: () => ({ matchEntireCell: () => ({ findNext: () => null }) })
      };
      // Formatting is a no-op but must stay chainable.
      ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat',
       'setNote', 'setHorizontalAlignment', 'setWrap', 'setFontSize', 'setFontStyle',
       'clearNote', 'setBorder', 'setFontFamily', 'merge'
      ].forEach(m => { api[m] = () => api; });
      // Validation is recorded rather than dropped, so a test can assert where it landed.
      api.setDataValidation = rule => {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          dv[name + '!' + (row + r) + ',' + (col + c)] = (rule && rule.list) || (rule || null);
        }
        return api;
      };
      api.clearDataValidations = () => {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          dv[name + '!' + (row + r) + ',' + (col + c)] = null;
        }
        return api;
      };
      return api;
    }
    return {
      getName: () => name,
      getLastRow: () => g().length,
      getLastColumn: () => g().reduce((a, r) => Math.max(a, r.length), 0) || 1,
      getDataRange: () => range(1, 1, Math.max(g().length, 1), Math.max(g().reduce((a, r) => Math.max(a, r.length), 0), 1)),
      getRange: (a, b, c, d) => (typeof a === 'string' ? (p => range(p.row, p.col, p.rows, p.cols))(parseA1(a))
                                                       : range(a, b, c === undefined ? 1 : c, d === undefined ? 1 : d)),
      clear() { grids[name] = []; return this; },
      // Row deletion is real: the push code prunes subscriptions a browser has thrown
      // away, and a no-op stub would let a leak through unnoticed.
      deleteRow(n) { g().splice(n - 1, 1); return this; },
      deleteRows(n, count) { g().splice(n - 1, count); return this; },
      hideSheet: () => {}, setFrozenRows: () => {}, autoResizeColumns: () => {},
      setColumnWidth: () => {}, setTabColor: () => {}, getSheetId: () => 1
    };
  }
  return { grids, sheet, dv, names: () => Object.keys(grids) };
}

function makeCtx(sheetData) {
  let uuidN = 0;                                      // getUuid, unique per call
  const props = {};                                   // Script Properties
  const fetchOutbox = [];                             // every outbound HTTP request
  let fetchReply = () => 201;                         // what a push service answers
  const triggers = [];                                // installed time-based triggers
  const store = {};                                   // CacheService, shared script-wide
  const cache = {
    get: k => store[k] === undefined ? null : store[k],
    getAll: ks => { const o = {}; ks.forEach(k => { if (store[k] !== undefined) o[k] = store[k]; }); return o; },
    put: (k, v) => { store[k] = String(v); },
    putAll: o => { Object.keys(o).forEach(k => store[k] = String(o[k])); },
    remove: k => { delete store[k]; },
    removeAll: ks => { ks.forEach(k => delete store[k]); }
  };
  const cells = { L1: '1000' };
  const book = makeSheets(sheetData);
  const made = {};
  const sheet = (name, lastRow) => {
    // The date-less specs want the old featherweight stub: one cell, L1, for the stamp.
    if (!sheetData) {
      return {
        getName: () => name, getLastRow: () => lastRow || 1, getLastColumn: () => 11,
        getDataRange: () => ({ getValues: () => [[]] }),
        getRange: () => ({
          getValue: () => cells.L1, setValue: v => { cells.L1 = String(v); },
          getValues: () => [], setValues: () => {}
        }),
        hideSheet: () => {}
      };
    }
    return (made[name] = made[name] || book.sheet(name));
  };
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, RegExp, isFinite, parseInt,
    Logger: { log: () => {} },
    /* Script Properties, in memory. The push code keeps the VAPID private key here, so
       a spec can generate one, sign with it and read it back within a run. */
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; }
      })
    },
    /* Outbound HTTP is recorded, never sent. `fetchOutbox` holds every request and
       `fetchReply` decides the response, so a spec can make a push service answer 201,
       410 or 500 and check what the code does about it. */
    UrlFetchApp: {
      fetchAll: (reqs) => reqs.map((r) => {
        fetchOutbox.push(r);
        const code = fetchReply(r);
        return { getResponseCode: () => code, getContentText: () => 'body ' + code };
      }),
      fetch: (url, opt) => {
        fetchOutbox.push(Object.assign({ url }, opt || {}));
        const code = fetchReply({ url });
        return { getResponseCode: () => code, getContentText: () => 'body ' + code };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ _text: s, setMimeType() { return this; }, getContent: () => s })
    },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getScriptTimeZone: () => 'Europe/London' },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => cache },
    SpreadsheetApp: {
      getActive: () => ({
        getId: () => 'SHEET_ID',
        getSpreadsheetTimeZone: () => 'Europe/London',
        getSheets: () => (sheetData ? book.names().map(n => sheet(n)) : []),
        getSheetByName: n => (sheetData && !book.grids[n] ? null : sheet(n, n === 'Registers' ? 1 : 2)),
        insertSheet: n => sheet(n, 1),
        setActiveSheet: () => {},
        toast: () => {}, getName: () => 'Attendance'
      }),
      newDataValidation: () => {
        const spec = {};
        const b = {};
        ['requireValueInRange', 'requireDate', 'setHelpText']
          .forEach(m => { b[m] = () => b; });
        // The list is the whole point of the assertion, so keep it.
        b.requireValueInList = vals => { spec.list = vals; return b; };
        b.setAllowInvalid = v => { spec.allowInvalid = v; return b; };
        b.build = () => spec;
        return b;
      },
      flush: () => {},
      getUi: () => ({
        alert: () => {},
        prompt: () => ({ getSelectedButton: () => 'ok', getResponseText: () => '2' }),
        Button: { OK: 'ok' }, ButtonSet: { OK: 1, OK_CANCEL: 2 },
        createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; },
                             addSubMenu() { return this; }, addToUi() {} })
      })
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (fn) => {
        const t = { getHandlerFunction: () => fn };
        const chain = { everyMinutes: () => chain, atHour: () => chain, everyDays: () => chain,
                        inTimezone: () => chain, create: () => { triggers.push(t); return t; } };
        return { timeBased: () => chain };
      }
    },
    /* Real digests, not a placeholder. computeDigest used to return [1,2,3], which is
       fine while nothing depends on the value — but the VAPID signer does, and a stub
       hash would let a broken signature pass every test. Apps Script hands back SIGNED
       bytes (-128..127), so match that exactly or the byte plumbing is tested against
       the wrong shape. */
    Utilities: {
      formatDate,
      /* Unique, like the real one. A constant here made every push subscription share
         a device key, which quietly turned 'unsubscribe this device' into 'unsubscribe
         whichever device happens to be first'. */
      getUuid: () => 'uuid-' + (++uuidN),
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
      MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
      computeDigest: (alg, value) =>
        toSigned(crypto.createHash('sha256').update(toBuf(value)).digest()),
      computeHmacSha256Signature: (value, key) =>
        toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
      base64Encode: (v) => toBuf(v).toString('base64'),
      base64EncodeWebSafe: (v) => toBuf(v).toString('base64url'),
      base64Decode: (s) => toSigned(Buffer.from(String(s), 'base64')),
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(String(s), 'base64url')),
      newBlob: (v) => ({ getBytes: () => (typeof v === 'string' ? toSigned(Buffer.from(v, 'utf8')) : v) }),
      sleep: () => {}
    }
  };
  ctx.globalThis = ctx;
  return { ctx, store, cells, grids: book.grids, dv: book.dv, props, triggers,
           fetchOutbox, setFetchReply: (fn) => { fetchReply = fn; } };
}

/**
 * Evaluate Code.gs against the given tab fixtures.
 *
 * Pass `sheetData` (tab name -> 2D array, header row included) to get a spreadsheet
 * that really stores writes, which is what setup() and refreshDerived() need. Leave
 * it out and rows_() is stubbed from `fixtures` instead — faster, and all any
 * read-only spec wants.
 */
function loadWith(fixtures, opts) {
  opts = opts || {};
  const src = opts.file || SRC('Code.gs');
  const built = makeCtx(opts.sheetData);
  const { ctx } = built;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(src, 'utf8'), ctx, { filename: src });
  if (!opts.sheetData) ctx.rows_ = name => (fixtures[name] || []).map(r => Object.assign({}, r));
  return built;
}

/** Shared reporter, so every spec prints the same shape. */
function reporter() {
  let fails = 0;
  const ok = (label, cond, extra) => {
    console.log((cond ? '  ok    ' : '  FAIL  ') + label + (extra !== undefined && extra !== '' ? '   ' + extra : ''));
    if (!cond) fails++;
  };
  ok.done = () => {
    console.log(fails ? '\n' + fails + ' FAILED\n' : '\nall passed\n');
    process.exit(fails ? 1 : 0);
  };
  ok.fails = () => fails;
  return ok;
}

module.exports = { SRC, makeCtx, loadWith, reporter, DOW, formatDate };
