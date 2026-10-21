'use strict';
// Country, language and category data for iptv-org channels, from the public iptv-org API (public domain).
// Downloaded at most once a day and kept in a compact cache, so the TV receives the list already sorted.

const fs = require('fs');

const API = 'https://iptv-org.github.io/api/';
const MAX_AGE_MS = 24 * 3600 * 1000;

// iptv-org category ids in the 8 interface languages of the TV app
const CATEGORIES = {
  es: { auto: 'Motor', animation: 'Animación', business: 'Negocios', classic: 'Clásicos', comedy: 'Comedia', cooking: 'Cocina', culture: 'Cultura', documentary: 'Documentales', education: 'Educación', entertainment: 'Entretenimiento', family: 'Familia', general: 'General', interactive: 'Interactivos', kids: 'Infantil', legislative: 'Parlamentos', lifestyle: 'Estilo de vida', movies: 'Películas', music: 'Música', news: 'Noticias', outdoor: 'Aire libre', public: 'Públicos', relax: 'Relax', religious: 'Religiosos', series: 'Series', science: 'Ciencia', shop: 'Teletienda', sports: 'Deportes', travel: 'Viajes', weather: 'Clima', xxx: 'Adultos' },
  en: { auto: 'Motoring', animation: 'Animation', business: 'Business', classic: 'Classics', comedy: 'Comedy', cooking: 'Cooking', culture: 'Culture', documentary: 'Documentaries', education: 'Education', entertainment: 'Entertainment', family: 'Family', general: 'General', interactive: 'Interactive', kids: 'Kids', legislative: 'Parliament', lifestyle: 'Lifestyle', movies: 'Movies', music: 'Music', news: 'News', outdoor: 'Outdoor', public: 'Public', relax: 'Relax', religious: 'Religious', series: 'Series', science: 'Science', shop: 'Shopping', sports: 'Sports', travel: 'Travel', weather: 'Weather', xxx: 'Adult' },
  fr: { auto: 'Automobile', animation: 'Animation', business: 'Économie', classic: 'Classiques', comedy: 'Humour', cooking: 'Cuisine', culture: 'Culture', documentary: 'Documentaires', education: 'Éducation', entertainment: 'Divertissement', family: 'Famille', general: 'Généralistes', interactive: 'Interactif', kids: 'Jeunesse', legislative: 'Parlement', lifestyle: 'Art de vivre', movies: 'Cinéma', music: 'Musique', news: 'Info', outdoor: 'Plein air', public: 'Publiques', relax: 'Détente', religious: 'Religion', series: 'Séries', science: 'Sciences', shop: 'Téléachat', sports: 'Sport', travel: 'Voyages', weather: 'Météo', xxx: 'Adultes' },
  de: { auto: 'Motor', animation: 'Animation', business: 'Wirtschaft', classic: 'Klassiker', comedy: 'Comedy', cooking: 'Kochen', culture: 'Kultur', documentary: 'Dokus', education: 'Bildung', entertainment: 'Unterhaltung', family: 'Familie', general: 'Vollprogramm', interactive: 'Interaktiv', kids: 'Kinder', legislative: 'Parlament', lifestyle: 'Lifestyle', movies: 'Filme', music: 'Musik', news: 'Nachrichten', outdoor: 'Outdoor', public: 'Öffentlich', relax: 'Entspannung', religious: 'Religion', series: 'Serien', science: 'Wissenschaft', shop: 'Shopping', sports: 'Sport', travel: 'Reisen', weather: 'Wetter', xxx: 'Erwachsene' },
  it: { auto: 'Motori', animation: 'Animazione', business: 'Economia', classic: 'Classici', comedy: 'Comicità', cooking: 'Cucina', culture: 'Cultura', documentary: 'Documentari', education: 'Istruzione', entertainment: 'Intrattenimento', family: 'Famiglia', general: 'Generalisti', interactive: 'Interattivi', kids: 'Bambini', legislative: 'Parlamento', lifestyle: 'Stile di vita', movies: 'Film', music: 'Musica', news: 'Notizie', outdoor: 'All’aperto', public: 'Pubblici', relax: 'Relax', religious: 'Religiosi', series: 'Serie', science: 'Scienza', shop: 'Televendite', sports: 'Sport', travel: 'Viaggi', weather: 'Meteo', xxx: 'Adulti' },
  pt: { auto: 'Automóveis', animation: 'Animação', business: 'Negócios', classic: 'Clássicos', comedy: 'Comédia', cooking: 'Culinária', culture: 'Cultura', documentary: 'Documentários', education: 'Educação', entertainment: 'Entretenimento', family: 'Família', general: 'Generalistas', interactive: 'Interativos', kids: 'Infantil', legislative: 'Parlamento', lifestyle: 'Estilo de vida', movies: 'Filmes', music: 'Música', news: 'Notícias', outdoor: 'Ar livre', public: 'Públicos', relax: 'Relaxamento', religious: 'Religiosos', series: 'Séries', science: 'Ciência', shop: 'Televendas', sports: 'Desporto', travel: 'Viagens', weather: 'Meteorologia', xxx: 'Adultos' },
  zh: { auto: '汽车', animation: '动画', business: '财经', classic: '经典', comedy: '喜剧', cooking: '美食', culture: '文化', documentary: '纪录片', education: '教育', entertainment: '娱乐', family: '家庭', general: '综合', interactive: '互动', kids: '少儿', legislative: '议会', lifestyle: '生活', movies: '电影', music: '音乐', news: '新闻', outdoor: '户外', public: '公共', relax: '放松', religious: '宗教', series: '剧集', science: '科学', shop: '购物', sports: '体育', travel: '旅游', weather: '天气', xxx: '成人' },
  ja: { auto: '自動車', animation: 'アニメ', business: 'ビジネス', classic: 'クラシック', comedy: 'お笑い', cooking: '料理', culture: '文化', documentary: 'ドキュメンタリー', education: '教育', entertainment: 'エンタメ', family: 'ファミリー', general: '総合', interactive: 'インタラクティブ', kids: 'キッズ', legislative: '議会', lifestyle: 'ライフスタイル', movies: '映画', music: '音楽', news: 'ニュース', outdoor: 'アウトドア', public: '公共', relax: 'リラックス', religious: '宗教', series: 'ドラマ', science: 'サイエンス', shop: 'ショッピング', sports: 'スポーツ', travel: '旅行', weather: '天気', xxx: 'アダルト' }
};
const LANGS = Object.keys(CATEGORIES);

const regionNames = {};
function regionName(code, lang) {
  if (!regionNames[lang]) {
    try { regionNames[lang] = new Intl.DisplayNames([lang], { type: 'region' }); } catch (e) { regionNames[lang] = null; }
  }
  try { return (regionNames[lang] && regionNames[lang].of(code)) || code; } catch (e) { return code; }
}

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

// Adds tvg-country, mommytv-country-name, tvg-language, mommytv-cats and mommytv-nsfw to #EXTINF lines
// whose tvg-id is an iptv-org id ("Channel.co@SD"), names in `lang`. Other lines are left exactly as they are.
function enrich(lines, meta, lang) {
  if (!meta) return lines;
  if (LANGS.indexOf(lang) < 0) lang = 'es';
  const names = CATEGORIES[lang];
  return lines.map((line) => {
    if (!line.startsWith('#EXTINF') || has(line, 'mommytv-cats')) return line;
    const m = /\stvg-id="([^"@]+)(?:@([^"]+))?"/.exec(line);
    const c = m && meta.ch[m[1]];
    if (!c) return line;
    const langs = (m[2] && meta.feed[m[1] + '@' + m[2]]) || meta.main[m[1]] || '';
    const cats = c[1].split(';').filter(Boolean).map((k) => names[k] || CATEGORIES.en[k] || k).join(';');
    let attrs = '';
    if (c[0] && !has(line, 'tvg-country')) attrs += ' tvg-country="' + c[0] + '" mommytv-country-name="' + regionName(c[0], lang).replace(/"/g, '') + '"';
    if (langs && !has(line, 'tvg-language')) attrs += ' tvg-language="' + langs + '"';
    if (cats) attrs += ' mommytv-cats="' + cats + '"';
    if (c[2]) attrs += ' mommytv-nsfw="1"';
    return line.replace(/^#EXTINF:\s*(-?[\d.]+)?/, (x) => x + attrs);
  });
}

module.exports = { loadMeta, enrich, compact, CATEGORIES, LANGS };
