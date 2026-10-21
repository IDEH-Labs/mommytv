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
assert.deepStrictEqual(r.state(tv), { order: 0, result: '', view: 'player', title: 'Canal1', logo: '', url: 'https://a/b.m3u8', at: t });
r.setState(tv, { view: 'player', order: 7, result: 'pin' });
assert.strictEqual(r.state(tv).result, 'pin');
r.setState(tv, { order: 'x', result: 'hacked' });
assert.deepStrictEqual([r.state(tv).order, r.state(tv).result], [0, '']);
assert.ok(saves >= 4);
console.log('remote: ok');

// orders: delivered to a waiting TV at once, dropped when stale, never replayed
(async () => {
  const { COMMAND_MS } = require('../manager/remote.js');
  const got = [];
  const cancel = r.wait(tv, 0, 1000, (res) => got.push(res));
  assert.deepStrictEqual(r.send(tv, 'play', 'https://a/1.m3u8', 'Uno', 'javascript:x'), { seq: 1, listening: true });
  assert.deepStrictEqual(got, [{ seq: 1, cmds: [{ seq: 1, type: 'play', url: 'https://a/1.m3u8', title: 'Uno', logo: '' }] }]);
  cancel();
  assert.strictEqual(r.send(tv, 'shell', 'x'), null); // only known orders
  assert.strictEqual(r.send(tv, 'play', 'file:///etc/passwd'), null); // only web streams
  // an order waits for the next request, but not forever
  r.send(tv, 'play', 'https://a/2.m3u8');
  const early = await new Promise((ok) => r.wait(tv, 1, 1000, ok));
  assert.deepStrictEqual(early.cmds.map((c) => c.url), ['https://a/2.m3u8']);
  r.send(tv, 'play', 'https://a/3.m3u8');
  t += COMMAND_MS + 1;
  const late = await new Promise((ok) => r.wait(tv, 2, 30, ok));
  assert.deepStrictEqual(late.cmds, []); // stale: dropped
  assert.strictEqual(late.seq, 3);
  // a TV that stopped asking is not listening
  t += 60 * 1000;
  assert.strictEqual(r.send(tv, 'play', 'https://a/4.m3u8').listening, false);
  // a TV that (re)starts asks with -1 and gets only the current position, never old orders
  r.send(tv, 'play', 'https://a/5.m3u8');
  const start = await new Promise((ok) => r.wait(tv, -1, 1000, ok));
  assert.deepStrictEqual(start, { seq: 5, cmds: [] });
  console.log('remote orders: ok');
})().catch((e) => { console.error(e); process.exit(1); });
