'use strict';
// Phone remote: a TV shows a one-time code, a phone types it and gets its own token.
// Only hashes of the secrets are stored; codes and the TV's state live in memory.

const crypto = require('crypto');

const CODE_MS = 5 * 60 * 1000;
const MAX_FAILS = 10; // wrong codes allowed per window, from any phone
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_PHONES = 8;
const COMMAND_MS = 30 * 1000; // an order the TV did not pick up by then is dropped, never played late
const LISTENING_MS = 40 * 1000; // a TV that asked for orders this recently is listening

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = () => crypto.randomBytes(24).toString('base64url');
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

class Remote {
  // store: { tvs: [{ id, secret (hash), phones: [{ id, name, token (hash), at }] }] }; save() persists it
  constructor(store, save, now = Date.now) {
    this.store = store;
    this.save = save;
    this.now = now;
    this.codes = new Map(); // code -> { tvId, until }
    this.fails = [];
    this.states = new Map(); // tvId -> what the TV is showing
    this.queues = new Map(); // tvId -> { seq, cmds: [{ seq, type, url, at }], waiters: Set, seen }
  }

  // A TV without a secret registers itself once and keeps the secret.
  registerTv() {
    const secret = token();
    const tv = { id: crypto.randomBytes(6).toString('hex'), secret: hash(secret), phones: [] };
    this.store.tvs.push(tv);
    this.save();
    return { id: tv.id, secret };
  }

  tv(secret) {
    const h = hash(secret);
    return this.store.tvs.find((t) => crypto.timingSafeEqual(Buffer.from(t.secret), Buffer.from(h))) || null;
  }

  phone(tok) {
    const h = hash(tok);
    for (const tv of this.store.tvs) {
      const phone = tv.phones.find((p) => crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(h)));
      if (phone) return { tv, phone };
    }
    return null;
  }

  // One live code per TV; asking again replaces it.
  newCode(tv) {
    for (const [c, v] of this.codes) if (v.tvId === tv.id || v.until < this.now()) this.codes.delete(c);
    let code;
    do code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); while (this.codes.has(code));
    this.codes.set(code, { tvId: tv.id, until: this.now() + CODE_MS });
    return { code, expiresIn: CODE_MS / 1000 };
  }

  locked() {
    const since = this.now() - FAIL_WINDOW_MS;
    this.fails = this.fails.filter((t) => t > since);
    return this.fails.length >= MAX_FAILS;
  }

  // Returns { token, tvId } or { error: 'locked' | 'wrong' | 'full' }.
  pair(code, name) {
    if (this.locked()) return { error: 'locked' };
    const c = this.codes.get(String(code || '').trim());
    if (!c || c.until < this.now()) { this.fails.push(this.now()); return { error: 'wrong' }; }
    const tv = this.store.tvs.find((t) => t.id === c.tvId);
    if (!tv) return { error: 'wrong' };
    if (tv.phones.length >= MAX_PHONES) return { error: 'full' };
    this.codes.delete(String(code).trim());
    const tok = token();
    tv.phones.push({ id: crypto.randomBytes(6).toString('hex'), name: clean(name, 40) || 'Phone', token: hash(tok), at: new Date(this.now()).toISOString() });
    this.save();
    return { token: tok, tvId: tv.id };
  }

  phones(tv) { return tv.phones.map((p) => ({ id: p.id, name: p.name, at: p.at })); }

  unpair(tv, phoneId) {
    const before = tv.phones.length;
    tv.phones = tv.phones.filter((p) => p.id !== phoneId);
    if (tv.phones.length !== before) this.save();
    return before !== tv.phones.length;
  }

  // What the TV reports: the screen and the channel it plays, nothing else.
  setState(tv, s) {
    this.states.set(tv.id, {
      view: ['setup', 'browser', 'player'].includes(s.view) ? s.view : 'browser',
      title: clean(s.title, 120),
      logo: /^https?:\/\/\S+$/i.test(String(s.logo || '')) ? String(s.logo).slice(0, 500) : '',
      url: clean(s.url, 2000),
      at: this.now(),
    });
  }

  state(tv) { return this.states.get(tv.id) || null; }

  queue(tv) {
    let q = this.queues.get(tv.id);
    if (!q) { q = { seq: 0, cmds: [], waiters: new Set(), seen: 0 }; this.queues.set(tv.id, q); }
    q.cmds = q.cmds.filter((c) => c.at > this.now() - COMMAND_MS);
    return q;
  }

  listening(tv) { const q = this.queue(tv); return q.waiters.size > 0 || q.seen > this.now() - LISTENING_MS; }

  // A paired phone asks the TV to play a channel; the TV checks it against its own list.
  // Returns whether a TV is listening right now.
  send(tv, type, url) {
    if (type !== 'play') return false;
    const q = this.queue(tv);
    q.cmds.push({ seq: ++q.seq, type, url: clean(url, 2000), at: this.now() });
    for (const w of q.waiters) w();
    return this.listening(tv);
  }

  // The TV waits for orders newer than `after` (-1 when it starts: only new ones from now on);
  // cb({ seq, cmds }) at once if there are some,
  // else when one arrives or after timeoutMs with none. Returns a function that cancels the wait.
  wait(tv, after, timeoutMs, cb) {
    const q = this.queue(tv);
    q.seen = this.now();
    if (after < 0) { cb({ seq: q.seq, cmds: [] }); return () => {}; }
    const ready = () => q.cmds.filter((c) => c.seq > after);
    const reply = () => { cleanup(); cb({ seq: q.seq, cmds: ready().map((c) => ({ seq: c.seq, type: c.type, url: c.url })) }); };
    const cleanup = () => { clearTimeout(timer); q.waiters.delete(check); q.seen = this.now(); };
    const check = () => { if (ready().length) reply(); };
    const timer = setTimeout(reply, timeoutMs);
    q.waiters.add(check);
    check();
    return cleanup;
  }
}

module.exports = { Remote, CODE_MS, MAX_FAILS, COMMAND_MS };
