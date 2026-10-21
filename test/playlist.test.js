'use strict';
const assert = require('assert');
const { build, withGroup } = require('../manager/playlist.js');
const M3U = require('../js/m3u.js');

assert.deepStrictEqual(withGroup('#EXTM3U\n#EXTINF:-1,A\nhttp://a\n', 'Mi "lista"'),
  ['#EXTINF:-1 group-title="Mi lista",A', 'http://a']);
assert.deepStrictEqual(withGroup('#EXTINF:-1 group-title="News",B\nhttp://b', 'X'),
  ['#EXTINF:-1 group-title="News",B', 'http://b']);
assert.deepStrictEqual(withGroup('#EXTINF:,C\nhttp://c', 'Y'),
  ['#EXTINF: group-title="Y",C', 'http://c']);

const text = build(
  [{ name: 'ditu', appId: 'com.example.ditu', androidId: 'com.example.Ditu_tv', logo: '' }, { name: 'bad', appId: 'x; rm' }, { name: 'solo android', androidId: 'com.a.b' }],
  [{ name: 'Prueba', text: '#EXTM3U\n#EXTINF:-1,Apple\nhttps://a/m.m3u8\n' }]);
const ch = M3U.parse(text);
assert.strictEqual(ch.length, 2);
assert.deepStrictEqual(ch[0], { name: 'ditu', logo: '', group: '', cert: '', country: '', countryName: '', langs: '', cats: '', nsfw: '', url: 'webos-app://com.example.ditu' });
assert.deepStrictEqual(ch[1], { name: 'Apple', logo: '', group: 'Prueba', cert: '', country: '', countryName: '', langs: '', cats: '', nsfw: '', url: 'https://a/m.m3u8' });
const android = M3U.parse(build(
  [{ name: 'ditu', appId: 'com.example.ditu', androidId: 'com.example.Ditu_tv' }, { name: 'solo lg', appId: 'com.lg.only' }, { name: 'bad', androidId: 'x; rm' }],
  [], 'android'));
assert.deepStrictEqual(android.map((c) => c.url), ['android-app://com.example.Ditu_tv']);
console.log('playlist: ok');
