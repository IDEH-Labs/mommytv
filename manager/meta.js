'use strict';
// Country, language and category data for iptv-org channels, from the public iptv-org API (public domain).
// Downloaded at most once a day and kept in a compact cache, so the TV receives the list already sorted.

const fs = require('fs');

const API = 'https://iptv-org.github.io/api/';
const MAX_AGE_MS = 24 * 3600 * 1000;

const CATEGORY_ES = {
  auto: 'Motor', animation: 'Animación', business: 'Negocios', classic: 'Clásicos', comedy: 'Comedia',
  cooking: 'Cocina', culture: 'Cultura', documentary: 'Documentales', education: 'Educación',
  entertainment: 'Entretenimiento', family: 'Familia', general: 'General', interactive: 'Interactivos',
  kids: 'Infantil', legislative: 'Parlamentos', lifestyle: 'Estilo de vida', movies: 'Películas',
  music: 'Música', news: 'Noticias', outdoor: 'Aire libre', public: 'Públicos', relax: 'Relax',
  religious: 'Religiosos', series: 'Series', science: 'Ciencia', shop: 'Teletienda', sports: 'Deportes',
  travel: 'Viajes', weather: 'Clima', xxx: 'Adultos'
};

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(['es'], { type: 'region' });
    return (code) => { try { return names.of(code) || code; } catch (e) { return code; } };
  } catch (e) {
    return (code) => code;
  }
})();

// { ch: { id: [country, 'cat;cat', nsfw] }, feed: { 'id@feed': 'spa;eng' }, main: { id: 'spa' } }
function compact(channels, feeds) {
  const out = { ch: {}, feed: {}, main: {} };
  for (const c of channels) out.ch[c.id] = [c.country || '', (c.categories || []).join(';'), c.is_nsfw ? 1 : 0];
  for (const f of feeds) {
    const langs = (f.languages || []).join(';');
    out.feed[f.channel + '@' + f.id] = langs;
    if (f.is_main || !(f.channel in out.main)) out.main[f.channel] = langs;
  }
  return out;
}

async function loadMeta(cacheFile, fetchText) {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { /* first run */ }
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached;
  try {
    const [channels, feeds] = await Promise.all([fetchText(API + 'channels.json'), fetchText(API + 'feeds.json')]);
    const meta = Object.assign({ at: Date.now() }, compact(JSON.parse(channels), JSON.parse(feeds)));
    fs.writeFileSync(cacheFile, JSON.stringify(meta), { mode: 0o600 });
    return meta;
  } catch (e) {
    return cached; // offline: keep the last good copy, or none
  }
}

const has = (line, name) => new RegExp('\\s' + name + '="', 'i').test(line);

// Adds tvg-country, mommytv-country-es, tvg-language, mommytv-cats and mommytv-nsfw to #EXTINF lines
// whose tvg-id is an iptv-org id ("Channel.co@SD"). Other lines are left exactly as they are.
function enrich(lines, meta) {
  if (!meta) return lines;
  return lines.map((line) => {
    if (!line.startsWith('#EXTINF') || has(line, 'mommytv-cats')) return line;
    const m = /\stvg-id="([^"@]+)(?:@([^"]+))?"/.exec(line);
    const c = m && meta.ch[m[1]];
    if (!c) return line;
    const langs = (m[2] && meta.feed[m[1] + '@' + m[2]]) || meta.main[m[1]] || '';
    const cats = c[1].split(';').filter(Boolean).map((k) => CATEGORY_ES[k] || k).join(';');
    let attrs = '';
    if (c[0] && !has(line, 'tvg-country')) attrs += ' tvg-country="' + c[0] + '" mommytv-country-es="' + regionName(c[0]).replace(/"/g, '') + '"';
    if (langs && !has(line, 'tvg-language')) attrs += ' tvg-language="' + langs + '"';
    if (cats) attrs += ' mommytv-cats="' + cats + '"';
    if (c[2]) attrs += ' mommytv-nsfw="1"';
    return line.replace(/^#EXTINF:\s*(-?[\d.]+)?/, (x) => x + attrs);
  });
}

module.exports = { loadMeta, enrich, compact, CATEGORY_ES };
