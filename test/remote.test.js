'use strict';
const assert = require('assert');
const { Remote, CODE_MS, MAX_FAILS } = require('../manager/remote.js');

let t = 1000;
const store = { tvs: [] };
let saves = 0;
const r = new Remote(store, () => saves++, () => t);

const { secret } = r.registerTv();
const tv = r.tv(secret);
assert.ok(tv);
assert.notStrictEqual(store.tvs[0].secret, secret); // only the hash is kept
assert.strictEqual(r.tv('nope'), null);

// a code pairs once and only once
const { code } = r.newCode(tv);
assert.match(code, /^\d{6}$/);
const ok = r.pair(code, 'Moto');
assert.ok(ok.token);
assert.strictEqual(r.pair(code, 'Otro').error, 'wrong');
assert.strictEqual(r.phone(ok.token).phone.name, 'Moto');
assert.notStrictEqual(store.tvs[0].phones[0].token, ok.token);
assert.strictEqual(r.phone('nope'), null);

// a new code replaces the old one; codes expire
const a = r.newCode(tv).code;
const b = r.newCode(tv).code;
if (a !== b) assert.strictEqual(r.pair(a, 'x').error, 'wrong');
t += CODE_MS + 1;
assert.strictEqual(r.pair(b, 'x').error, 'wrong');

// too many wrong codes lock pairing for everyone, even with a right code
for (let i = 0; i < MAX_FAILS; i++) r.pair('000000', 'x');
const c = r.newCode(tv).code;
assert.strictEqual(r.pair(c, 'x').error, 'locked');
t += 10 * 60 * 1000 + 1;
assert.strictEqual(r.pair(c, 'x').error, 'wrong'); // expired meanwhile
assert.ok(r.pair(r.newCode(tv).code, 'Tablet').token);

// unpairing removes the phone's access
const tablet = store.tvs[0].phones.find((p) => p.name === 'Tablet');
assert.ok(r.unpair(tv, tablet.id));
assert.deepStrictEqual(r.phones(tv).map((p) => p.name), ['Moto']);

// the state keeps only known fields and safe values
r.setState(tv, { view: 'player', title: 'Canal\n1', logo: 'javascript:alert(1)', url: 'https://a/b.m3u8', extra: 'x' });
assert.deepStrictEqual(r.state(tv), { view: 'player', title: 'Canal1', logo: '', url: 'https://a/b.m3u8', at: t });
assert.ok(saves >= 4);
console.log('remote: ok');
