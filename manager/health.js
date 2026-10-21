'use strict';
// Nightly check of the channels in the enabled lists, so the TV does not show dead links.
// Only the small HLS index (a few KB) is requested, never video. A channel is hidden after two
// failed checks in a row and comes back as soon as it answers again.

const fs = require('fs');
const http = require('http');
const https = require('https');

const FAILS_TO_HIDE = 2;
const CONCURRENCY = 24;

function probe(url, redirects = 3) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : url.startsWith('http:') ? http : null;
    if (!lib) return resolve(true); // not something we can check: never hide it
    const req = lib.get(url, { timeout: 10000, headers: { 'User-Agent': 'MommyTV-Manager' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(probe(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      let head = '';
      res.on('data', (c) => {
        head += c;
        if (head.length > 2048) req.destroy();
      });
      const done = () => resolve(!/\.m3u8?(\?|$)/i.test(url) || head.indexOf('#EXTM3U') >= 0);
      res.on('end', done);
      res.on('close', done);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function streamUrls(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l));
}

class Health {
  constructor(file) {
    this.file = file;
    try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { this.state = {}; } // { url: { fails, at } }
    this.running = false;
  }

  dead(url) { const s = this.state[url]; return !!s && s.fails >= FAILS_TO_HIDE; }

  summary(urls) {
    let hidden = 0;
    for (const u of urls) if (this.dead(u)) hidden++;
    return { hidden, checked: urls.filter((u) => this.state[u]).length, total: urls.length };
  }

  async check(urls) {
    if (this.running) return;
    this.running = true;
    const queue = Array.from(new Set(urls));
    const worker = async () => {
      while (queue.length) {
        const url = queue.pop();
        const ok = await probe(url);
        const prev = this.state[url] || { fails: 0 };
        this.state[url] = { fails: ok ? 0 : prev.fails + 1, at: Date.now() };
      }
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      for (const u of Object.keys(this.state)) if (urls.indexOf(u) < 0) delete this.state[u]; // forget removed channels
      fs.writeFileSync(this.file, JSON.stringify(this.state), { mode: 0o600 });
    } finally {
      this.running = false;
    }
  }

  // Drops each dead stream URL together with its #EXTINF / #EXTVLCOPT lines.
  filter(lines) {
    const out = [];
    let pending = [];
    for (const line of lines) {
      if (line.startsWith('#EXTINF') || line.startsWith('#EXTVLCOPT') || line.startsWith('#EXTGRP')) { pending.push(line); continue; }
      if (/^https?:\/\//i.test(line.trim()) && this.dead(line.trim())) { pending = []; continue; }
      out.push(...pending, line);
      pending = [];
    }
    return out.concat(pending);
  }
}

module.exports = { Health, streamUrls, probe, FAILS_TO_HIDE };
