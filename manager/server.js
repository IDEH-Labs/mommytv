'use strict';
// MommyTV Manager: a local web panel to manage the playlists the TV reads.
// Only Node built-ins. Data lives in ~/.config/mommytv; nothing leaves the LAN
// except the requests that download the lists you add.

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { build, APP_ID } = require('./playlist.js');
const { loadMeta, enrich } = require('./meta.js');

const PORT = Number(process.env.MOMMYTV_PORT) || 8642;
const DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mommytv');
const DATA = path.join(DIR, 'data.json');
const MAX_BYTES = 20 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;

fs.mkdirSync(path.join(DIR, 'files'), { recursive: true, mode: 0o700 });

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { return null; }
}
const data = loadData() || { key: crypto.randomBytes(12).toString('base64url'), lists: [], shortcuts: [] };
function save() { fs.writeFileSync(DATA, JSON.stringify(data, null, 2), { mode: 0o600 }); }
save();

const fileOf = (id) => path.join(DIR, 'files', id + '.m3u');
const DIAG = path.join(DIR, 'diag.log'); // playback stats the TV sends only while its diagnostic mode is on
const DIAG_MAX = 5 * 1024 * 1024;

function saveDiag(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
  req.on('end', () => {
    try {
      const d = JSON.parse(body);
      d.at = new Date().toISOString();
      if (fs.existsSync(DIAG) && fs.statSync(DIAG).size > DIAG_MAX) fs.renameSync(DIAG, DIAG + '.old');
      fs.appendFileSync(DIAG, JSON.stringify(d) + '\n', { mode: 0o600 });
      send(res, 204, '');
    } catch (e) {
      send(res, 400, { error: 'JSON inválido' });
    }
  });
}
const newId = () => crypto.randomBytes(6).toString('hex');

/* ---------- downloading lists ---------- */

const cache = {}; // id -> { text, at, error }

function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : url.startsWith('http:') ? http : null;
    if (!lib) return reject(new Error('Solo se admiten direcciones http o https'));
    const req = lib.get(url, { timeout: 20000, headers: { 'User-Agent': 'MommyTV-Manager' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new Error('La lista supera 20 MB')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
  });
}

async function listText(l) {
  if (l.file) return fs.readFileSync(fileOf(l.id), 'utf8');
  const c = cache[l.id];
  if (c && c.text && Date.now() - c.at < CACHE_MS) return c.text;
  try {
    const text = await fetchText(l.url);
    cache[l.id] = { text, at: Date.now(), error: '' };
    return text;
  } catch (e) {
    cache[l.id] = { text: c && c.text, at: c ? c.at : 0, error: e.message };
    return (c && c.text) || ''; // keep serving the last good copy
  }
}

async function playlist() {
  const lists = [];
  for (const l of data.lists.filter((x) => x.enabled)) lists.push({ name: l.name, text: await listText(l) });
  const meta = await loadMeta(path.join(DIR, 'meta.json'), fetchText);
  return enrich(build(data.shortcuts, lists).split('\n'), meta).join('\n');
}

/* ---------- http ---------- */

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', // the TV app runs from file://
    'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES + 65536) { reject(new Error('Demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); }
    });
  });
}

function authorized(req) {
  const given = Buffer.from(String(req.headers['x-key'] || ''));
  const key = Buffer.from(data.key);
  return given.length === key.length && crypto.timingSafeEqual(given, key);
}

function state() {
  return {
    lists: data.lists.map((l) => ({
      id: l.id, name: l.name, url: l.url || '', file: !!l.file, enabled: l.enabled,
      error: (cache[l.id] && cache[l.id].error) || ''
    })),
    shortcuts: data.shortcuts
  };
}

async function api(req, res, parts) {
  if (!authorized(req)) return send(res, 403, { error: 'Clave incorrecta' });
  const [kind, id] = parts;
  const body = req.method === 'POST' ? await readJson(req) : {};
  const name = String(body.name || '').trim().slice(0, 80);

  if (kind === 'state' && req.method === 'GET') return send(res, 200, state());

  if (kind === 'lists' && req.method === 'POST' && !id) {
    if (!name) return send(res, 400, { error: 'Falta el nombre' });
    const l = { id: newId(), name, enabled: true };
    if (typeof body.text === 'string') {
      fs.writeFileSync(fileOf(l.id), body.text, { mode: 0o600 });
      l.file = true;
    } else if (/^https?:\/\/\S+$/i.test(String(body.url || '').trim())) {
      l.url = body.url.trim();
    } else {
      return send(res, 400, { error: 'Escribe una dirección http o https, o elige un archivo' });
    }
    data.lists.push(l);
    save();
    if (l.url) await listText(l);
    return send(res, 200, state());
  }

  if (kind === 'lists' && id) {
    const i = data.lists.findIndex((l) => l.id === id);
    if (i < 0) return send(res, 404, { error: 'No existe' });
    if (req.method === 'POST') data.lists[i].enabled = !!body.enabled;
    else if (req.method === 'DELETE') {
      if (data.lists[i].file) fs.rmSync(fileOf(id), { force: true });
      delete cache[id];
      data.lists.splice(i, 1);
    } else return send(res, 405, { error: 'Método no permitido' });
    save();
    return send(res, 200, state());
  }

  if (kind === 'shortcuts' && req.method === 'POST' && !id) {
    const appId = String(body.appId || '').trim();
    if (!name || !APP_ID.test(appId)) return send(res, 400, { error: 'Escribe un nombre y un identificador válido (ej. com.empresa.app)' });
    const logo = /^https?:\/\/\S+$/i.test(String(body.logo || '').trim()) ? body.logo.trim() : '';
    data.shortcuts.push({ id: newId(), name, appId, logo });
    save();
    return send(res, 200, state());
  }

  if (kind === 'shortcuts' && id && req.method === 'DELETE') {
    data.shortcuts = data.shortcuts.filter((s) => s.id !== id);
    save();
    return send(res, 200, state());
  }

  return send(res, 404, { error: 'No encontrado' });
}

const panel = fs.readFileSync(path.join(__dirname, 'panel.html'));

http.createServer(async (req, res) => {
  try {
    const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && parts.length === 0) return send(res, 200, panel, 'text/html; charset=utf-8');
    if (req.method === 'GET' && parts[0] === 'mommytv.json') return send(res, 200, { app: 'mommytv-manager', playlist: '/playlist.m3u' });
    if (req.method === 'GET' && parts[0] === 'playlist.m3u') return send(res, 200, await playlist(), 'audio/x-mpegurl; charset=utf-8');
    if (req.method === 'POST' && parts[0] === 'diag') return saveDiag(req, res);
    if (parts[0] === 'api') return await api(req, res, parts.slice(1));
    send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('MommyTV Manager listo. Abre el panel en este PC o en tu móvil:');
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) console.log('  http://' + a.address + ':' + PORT + '/#k=' + data.key);
    }
  }
  console.log('La TV lo encuentra sola en tu red. Ctrl+C para cerrar.');
});
