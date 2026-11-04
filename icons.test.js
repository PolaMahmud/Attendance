/* The home-screen and tab icons (4 Nov, liquid glass "Bold three"). Reads the PNGs' own
   headers and pixels, so a wrong size, stray alpha or a mark outside the maskable safe zone
   fails here rather than on someone's phone. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const R = n => [path.join(__dirname, n), path.join(__dirname, '..', n)].find(fs.existsSync);
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok ' : '  FAIL ') + n); };

function png(n) {
  const b = fs.readFileSync(R(n));
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], type = b[25];
  const idat = []; for (let i = 8; i < b.length;) { const len = b.readUInt32BE(i), t = b.toString('ascii', i + 4, i + 8);
    if (t === 'IDAT') idat.push(b.slice(i + 8, i + 8 + len)); i += 12 + len; }
  const ch = type === 6 ? 4 : type === 2 ? 3 : 0, raw = zlib.inflateSync(Buffer.concat(idat)), st = w * ch;
  const px = Buffer.alloc(w * h * ch); let prev = Buffer.alloc(st);
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)], line = raw.slice(y * (st + 1) + 1, (y + 1) * (st + 1)), out = Buffer.alloc(st);
    for (let x = 0; x < st; x++) { const a = x >= ch ? out[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      out[x] = (line[x] + [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f]) & 255; }
    out.copy(px, y * st); prev = out; }
  return { w, h, depth, type, ch, at: (x, y) => Array.from(px.slice((y * w + x) * ch, (y * w + x) * ch + ch)) };
}

const sizes = { 'icon.png': 1024, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180, 'favicon-32.png': 32 };
for (const [n, s] of Object.entries(sizes)) { const p = png(n); ok(`${n} is ${s}x${s}`, p.w === s && p.h === s); }
for (const n of ['icon.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-192.png', 'apple-touch-icon.png'])
  ok(`${n} has no alpha (iOS puts transparency on black)`, png(n).type === 2);

// Light, full bleed: every corner is the light background, so iOS's mask has no dark rim.
for (const n of ['icon.png', 'apple-touch-icon.png', 'icon-192.png']) {
  const p = png(n), e = p.w - 1;
  ok(`${n} corners are the light background`, [[0, 0], [e, 0], [0, e], [e, e]].every(([x, y]) => p.at(x, y).slice(0, 3).every(v => v > 200)));
}
// The mark is optically centred: the coloured pixels' box has equal margins (within 1%).
{ const p = png('icon.png'); let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < 1024; y += 2) for (let x = 0; x < 1024; x += 2) { const [r, g, b] = p.at(x, y);
    if (Math.max(r, g, b) - Math.min(r, g, b) > 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  ok('mark is centred left-right', Math.abs(x0 - (1023 - x1)) <= 10);
  ok('mark is centred top-bottom', Math.abs(y0 - (1023 - y1)) <= 10); }
// Maskable: nothing coloured outside the 80% safe circle Android may crop to.
{ const p = png('icon-maskable-512.png'); let out = 0;
  for (let y = 0; y < 512; y += 2) for (let x = 0; x < 512; x += 2) { if (Math.hypot(x - 256, y - 256) <= 0.4 * 512) continue;
    const [r, g, b] = p.at(x, y); if (Math.max(r, g, b) - Math.min(r, g, b) > 60) out++; }
  ok('maskable mark stays inside the safe circle', out === 0); }

const man = JSON.parse(fs.readFileSync(R('manifest.webmanifest'), 'utf8'));
for (const i of man.icons) { const n = i.src.replace('./', ''), p = png(n);
  ok(`manifest ${n} is the size it declares`, i.sizes === `${p.w}x${p.h}`); }
ok('manifest has a maskable icon', man.icons.some(i => i.purpose === 'maskable'));

const idx = fs.readFileSync(R('index.html'), 'utf8'), sw = fs.readFileSync(R('sw.js'), 'utf8');
ok('index links the 180 touch icon', /rel="apple-touch-icon" sizes="180x180" href="\.\/apple-touch-icon\.png"/.test(idx));
ok('index links the SVG tab icon after the PNG', idx.indexOf('href="./favicon.svg"') > idx.indexOf('href="./favicon-32.png"') && idx.indexOf('href="./favicon-32.png"') > 0);
const svg = fs.readFileSync(R('favicon.svg'), 'utf8');
ok('SVG tab icon follows dark mode', /prefers-color-scheme:\s*dark/.test(svg) && /viewBox="0 0 64 64"/.test(svg));
ok('worker keeps the SVG tab icon', /'\.\/favicon\.svg'/.test(sw));
ok('worker cache renamed so phones drop the old icons', /SHELL = 'ks5-shell-v4'/.test(sw));
for (const u of (sw.match(/ASSETS = \[([^\]]*)\]/)[1].match(/'\.\/[^']+'/g)))
  ok(`worker asset ${u} exists`, !!R(u.slice(3, -1)));

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
