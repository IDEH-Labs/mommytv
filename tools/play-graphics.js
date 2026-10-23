'use strict';
// Generates the Google Play store graphics in android/play/: the 512x512 icon (square, Play rounds it)
// and the 1024x500 feature graphic per listing language, from img/icon.svg and the app's own font.
// Needs rsvg-convert (librsvg) and Google Chrome.
// Usage: node tools/play-graphics.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'android', 'play');
const svg = fs.readFileSync(path.join(ROOT, 'img', 'icon.svg'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mommytv-play-'));

// Play wants the icon as a 32-bit PNG with alpha; librsvg writes opaque images as 24-bit RGB.
// Rewrites an 8-bit RGB PNG as RGBA with the same pixels and full opacity.
function toRGBA(file) {
  const zlib = require('zlib');
  const png = fs.readFileSync(file);
  let pos = 8, w, h, idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) {
        if (data[9] === 6) return; // already RGBA
        throw new Error(file + ': expected 8-bit non-interlaced RGB');
      }
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * (1 + w * 4));
  let prev = Buffer.alloc(w * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (1 + w * 3)], row = Buffer.from(raw.subarray(y * (1 + w * 3) + 1, (y + 1) * (1 + w * 3)));
    for (let i = 0; i < row.length; i++) {
      const a = i >= 3 ? row[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
      if (f === 1) row[i] += a;
      else if (f === 2) row[i] += b;
      else if (f === 3) row[i] += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
    }
    out[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      row.copy(out, y * (1 + w * 4) + 1 + x * 4, x * 3, x * 3 + 3);
      out[y * (1 + w * 4) + 1 + x * 4 + 3] = 255;
    }
    prev = row;
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

// Icon: the artwork without its rounded clip.
const square = path.join(tmp, 'square.svg');
fs.writeFileSync(square, svg.replace('<g clip-path="url(#shape)">', '<g>'));
execFileSync('rsvg-convert', ['-w', '512', '-h', '512', square, '-o', path.join(OUT, 'icon-512.png')]);
toRGBA(path.join(OUT, 'icon-512.png'));

// Feature graphic: icon, name and the tagline, on the banner's colours.
const iconData = execFileSync('rsvg-convert', ['-w', '280', '-h', '280', path.join(ROOT, 'img', 'icon.svg')]).toString('base64');
const font = (w) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(ROOT, 'fonts', 'plus-jakarta-sans-' + w + '-latin.woff2')).toString('base64');
const TAGLINE = {
  'en-US': 'Your own M3U playlists. No accounts, no tracking.',
  'es-419': 'Tus propias listas M3U. Sin cuentas ni rastreo.',
};
for (const [lang, tagline] of Object.entries(TAGLINE)) {
  const html = path.join(tmp, 'feature.html');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: J; font-weight: 800; src: url(${font(800)}) format('woff2'); }
@font-face { font-family: J; font-weight: 600; src: url(${font(600)}) format('woff2'); }
html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; }
body { display: flex; align-items: center; gap: 56px; padding: 0 72px; box-sizing: border-box;
  background: linear-gradient(120deg, #1e3a8a 0%, #3730a3 55%, #581c87 100%); font-family: J, sans-serif; }
img { width: 280px; height: 280px; filter: drop-shadow(0 18px 40px rgba(0,0,0,.35)); }
h1 { margin: 0; color: #fff; font-weight: 800; font-size: 104px; letter-spacing: -3px; line-height: 1; }
p { margin: 18px 0 0; color: #e0e7ff; font-weight: 600; font-size: 34px; line-height: 1.25; max-width: 560px; }
.d { margin-top: 22px; color: #fda4af; font-size: 26px; }
</style><img src="data:image/png;base64,${iconData}" alt=""><div><h1>MommyTV</h1><p>${tagline}</p><p class="d">Mami Analida</p></div>`);
  const shot = path.join(tmp, 'feature.png');
  execFileSync('google-chrome-stable', ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--user-data-dir=' + path.join(tmp, 'chrome'), '--window-size=1024,500', '--screenshot=' + shot, 'file://' + html], { stdio: 'ignore' });
  fs.mkdirSync(path.join(OUT, 'listing', lang), { recursive: true });
  fs.copyFileSync(shot, path.join(OUT, 'listing', lang, 'feature-graphic.png'));
}
fs.rmSync(tmp, { recursive: true });
console.log('play graphics: icon-512.png and feature graphics written');
