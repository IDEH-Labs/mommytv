'use strict';
const assert = require('assert');
const I18N = require('../js/i18n.js');

// every language has every key, with the same placeholders
const base = I18N.dicts.es;
for (const lang of I18N.languages) {
  const d = I18N.dicts[lang];
  for (const key of Object.keys(base)) {
    assert.ok(key in d, lang + ' lacks ' + key);
    if (typeof base[key] === 'string') {
      const ph = (s) => (s.match(/\{\d\}/g) || []).sort().join();
      assert.strictEqual(ph(d[key]), ph(base[key]), lang + '.' + key + ' placeholders');
    } else {
      assert.strictEqual(d[key].length, base[key].length, lang + '.' + key + ' length');
    }
  }
  assert.ok(/Analida/.test(d.dedication), lang + ' dedication names Mami Analida');
}
assert.strictEqual(I18N.t('appFail', 'X', -1).indexOf('{'), -1);
const COUNTRY_NAMES = require('../js/countries.js');
for (const lang of I18N.languages) assert.ok(COUNTRY_NAMES[lang] && COUNTRY_NAMES[lang].CO, lang + ' names Colombia');
assert.strictEqual(COUNTRY_NAMES.es.CO, 'Colombia');
console.log('i18n: ok (' + I18N.languages.join(', ') + ')');
