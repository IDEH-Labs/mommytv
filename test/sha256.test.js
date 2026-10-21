'use strict';
const assert = require('assert');
const crypto = require('crypto');
const sha256 = require('../js/sha256.js');

const node = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const samples = ['', 'abc', '1234', 'a8f3c1:0000', 'ñandú 中文 🎬', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)];
for (const s of samples) assert.strictEqual(sha256(s), node(s), JSON.stringify(s).slice(0, 30));
for (let i = 0; i < 200; i++) { const s = crypto.randomBytes(i).toString('base64'); assert.strictEqual(sha256(s), node(s)); }
console.log('sha256: ok');
