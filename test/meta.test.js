'use strict';
const assert = require('assert');
const { compact, enrich } = require('../manager/meta.js');
const M3U = require('../js/m3u.js');

const meta = compact(
  [{ id: 'Canal1.co', country: 'CO', categories: ['news', 'general'], is_nsfw: false },
   { id: 'Adult.us', country: 'US', categories: ['xxx'], is_nsfw: true }],
  [{ channel: 'Canal1.co', id: 'SD', is_main: true, languages: ['spa'] },
   { channel: 'Canal1.co', id: 'EN', is_main: false, languages: ['eng'] }]);

const out = enrich([
  '#EXTINF:-1 tvg-id="Canal1.co@SD" group-title="Noticias",Canal 1 (720p)',
  'http://a/1.m3u8',
  '#EXTINF:-1 tvg-id="Canal1.co@EN",Canal 1 EN',
  '#EXTINF:-1 tvg-id="Adult.us@SD",X',
  '#EXTINF:-1 tvg-id="Unknown.xx@SD",Desconocido',
  '#EXTINF:-1,Sin id'
], meta, 'es');

assert.ok(out[0].includes(' tvg-country="CO" mommytv-country-name="Colombia"'), out[0]);
assert.ok(out[0].includes(' tvg-language="spa"'));
assert.ok(out[0].includes(' mommytv-cats="Noticias;General"'));
assert.strictEqual(out[1], 'http://a/1.m3u8');
assert.ok(out[2].includes(' tvg-language="eng"'));
assert.ok(out[3].includes(' mommytv-nsfw="1"'));
assert.strictEqual(out[4], '#EXTINF:-1 tvg-id="Unknown.xx@SD",Desconocido');
assert.strictEqual(out[5], '#EXTINF:-1,Sin id');
assert.deepStrictEqual(enrich(out, meta, 'es'), out, 'enriching twice changes nothing');
const en = enrich(['#EXTINF:-1 tvg-id="Canal1.co@SD",C'], meta, 'en')[0];
assert.ok(en.includes('mommytv-country-name="Colombia"') && en.includes('mommytv-cats="News;General"'), en);
const fr = enrich(['#EXTINF:-1 tvg-id="Adult.us@SD",X'], meta, 'fr')[0];
assert.ok(fr.includes('mommytv-country-name="États-Unis"'), fr);
const { CATEGORIES } = require('../manager/meta.js');
for (const l of Object.keys(CATEGORIES)) assert.deepStrictEqual(Object.keys(CATEGORIES[l]).sort(), Object.keys(CATEGORIES.es).sort(), l);

const ch = M3U.parse(out.slice(0, 2).join('\n'))[0];
assert.strictEqual(ch.name, 'Canal 1 (720p)');
assert.strictEqual(ch.group, 'Noticias');
assert.strictEqual(ch.country, 'CO');
assert.strictEqual(ch.countryName, 'Colombia');
assert.strictEqual(ch.langs, 'spa');
assert.strictEqual(ch.cats, 'Noticias;General');
assert.strictEqual(ch.nsfw, '');
console.log('meta: ok');
