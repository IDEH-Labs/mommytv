'use strict';
const assert = require('assert');
const M3U = require('../js/m3u.js');

const sample = '﻿#EXTM3U x-tvg-url="http://epg.example/guide.xml"\r\n' +
  '#EXTINF:-1 tvg-id="a" tvg-logo="http://l/a.png" group-title="News, World",Channel A\r\n' +
  'http://s/a.m3u8\r\n' +
  '\r\n' +
  '#EXTINF:-1 tvg-name="Only Attr",\n' +
  '#EXTVLCOPT:http-user-agent=Foo\n' +
  'http://s/b.m3u8\n' +
  '#EXTINF:0,Channel C\n' +
  '#EXTGRP:Sports\n' +
  'http://s/c.ts\n' +
  'http://s/bare.m3u8\n';

const ch = M3U.parse(sample);
assert.strictEqual(ch.length, 4);
assert.deepStrictEqual(ch[0], { name: 'Channel A', logo: 'http://l/a.png', group: 'News, World', country: '', langs: '', url: 'http://s/a.m3u8' });
assert.strictEqual(ch[1].name, 'Only Attr');
assert.strictEqual(ch[1].url, 'http://s/b.m3u8');
assert.strictEqual(ch[2].group, 'Sports');
assert.deepStrictEqual(ch[3], { name: 'http://s/bare.m3u8', logo: '', group: '', country: '', langs: '', url: 'http://s/bare.m3u8' });
assert.strictEqual(M3U.parse('#EXTINF:-1 tvg-country="CO" group-title="Animation;Kids",K\nhttps://k/x.m3u8')[0].group, 'Animation;Kids');
assert.strictEqual(M3U.parse('#EXTINF:-1 group-title="Undefined",K\nhttps://k/x.m3u8')[0].group, '');
assert.strictEqual(M3U.parse('#EXTINF:-1 group-title="News; undefined ;World",K\nhttps://k/x.m3u8')[0].group, 'News;World');
assert.strictEqual(M3U.parse('#EXTINF:-1 tvg-id="CaracolTV.co@SD",C\nhttps://k/c.m3u8')[0].country, 'CO');
assert.strictEqual(M3U.parse('#EXTINF:-1 tvg-id="Channel.5.uk",C\nhttps://k/c.m3u8')[0].country, 'UK');
assert.strictEqual(M3U.parse('#EXTINF:-1 tvg-id="X.co@SD" tvg-country="MX",C\nhttps://k/c.m3u8')[0].country, 'MX');
assert.strictEqual(M3U.parse('#EXTINF:-1 tvg-id="nodot",C\nhttps://k/c.m3u8')[0].country, '');
assert.strictEqual(M3U.parse('').length, 0);
assert.strictEqual(M3U.parse('<html>not a playlist</html>').length, 1);
console.log('m3u: ok');
