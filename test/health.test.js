'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Health, streamUrls } = require('../manager/health.js');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mtv-')), 'health.json');
const h = new Health(file);
h.state = { 'http://dead/a.m3u8': { fails: 2 }, 'http://flaky/b.m3u8': { fails: 1 } };

const lines = [
  '#EXTM3U',
  '#EXTINF:-1,Muerto', '#EXTVLCOPT:http-user-agent=x', 'http://dead/a.m3u8',
  '#EXTINF:-1,Inestable', 'http://flaky/b.m3u8',
  '#EXTINF:-1,App', 'webos-app://com.example.app',
  '#EXTINF:-1,Vivo', 'http://ok/c.m3u8'
];
assert.deepStrictEqual(h.filter(lines), [
  '#EXTM3U',
  '#EXTINF:-1,Inestable', 'http://flaky/b.m3u8',
  '#EXTINF:-1,App', 'webos-app://com.example.app',
  '#EXTINF:-1,Vivo', 'http://ok/c.m3u8'
]);
assert.deepStrictEqual(streamUrls(lines.join('\n')), ['http://dead/a.m3u8', 'http://flaky/b.m3u8', 'http://ok/c.m3u8']);
assert.deepStrictEqual(h.summary(['http://dead/a.m3u8', 'http://ok/c.m3u8']), { hidden: 1, checked: 1, total: 2 });
console.log('health: ok');
