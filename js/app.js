/* MommyTV for webOS TV. ES5 only: webOS TV 4.x runs Chromium 53. */
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, CH_UP: 33, CH_DOWN: 34, YELLOW: 405, BLUE: 406 };
  var RAIL_ROWS = 11;
  var LIST_ROWS = 6;
  var STORE_URL = 'playlistUrl';
  var STORE_PINS = 'mtvPins';      // channel URLs marked as favourite, in order
  var STORE_WATCH = 'mtvWatch';    // { url: seconds watched }
  var STORE_LAST = 'mtvLast';      // URL of the last channel played: MommyTV opens on it, like a TV
  var STORE_HIDDEN = 'mtvHidden';  // channel URLs removed from Favoritos: never added back for being watched
  var STORE_TLS = 'mtvLetsEncrypt'; // { ok: bool, at: ms }: can this TV open Let's Encrypt HTTPS?
  var TLS_PROBE = 'https://acme-v02.api.letsencrypt.org/directory'; // official, tiny, allows CORS
  var TLS_MAX_AGE = 7 * 24 * 3600 * 1000;
  var FAV_MAX = 30;
  var SEARCH_MAX = 300;
  var SHORTCUT = 'webos-app://';   // playlist entry that opens an installed app instead of a stream
  var MANAGER_PORT = 8642;         // MommyTV Manager on a PC of the same network
  var screenSize = { w: 1920, h: 1080 }; // replaced by the panel size, so 4K TVs get the original 4K
  var FREEZE_S = 8;       // reconnect after this long without progress
  var RETRIES = 3;
  // Live sweet spot, measured on the 2019 test TV over Wi-Fi: right at the live edge the player keeps only
  // 3-6 s of buffer and drops to 240p on every network hiccup; 8 s behind it keeps ~15 s of buffer and
  // holds full quality, for about 12 s of total delay.
  var LIVE_TARGET_S = 8;
  var LIVE_LAG_S = 30;    // if a stall leaves us this far behind, come back to the sweet spot

  // webOS mediaOption: start HLS at the top quality instead of ramping up (the player still steps down if
  // the network can't keep up) and allow up to the panel's own resolution.
  function hlsType() {
    return 'application/vnd.apple.mpegurl;mediaOption=' + encodeURI(JSON.stringify({
      mediaTransportType: 'HLS',
      option: { adaptiveStreaming: { bps: { start: 50000000 }, maxWidth: screenSize.w, maxHeight: screenSize.h } }
    }));
  }
  var DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    topbar: $('topbar'), time: $('time'), date: $('date'), hint: $('hint'),
    setup: $('setup'), browser: $('browser'), player: $('player'),
    url: $('url'), load: $('load'), msg: $('setup-msg'), setupSpin: $('setup-spin'),
    groups: $('groups'), channels: $('channels'),
    heroTile: $('hero-tile'), heroLive: $('hero-live'), heroName: $('hero-name'), heroGroup: $('hero-group'), heroQ: $('hero-q'), search: $('search'),
    video: $('video'), playSpin: $('play-spin'), banner: $('banner'),
    bannerTile: $('banner-tile'), bannerNum: $('banner-num'), bannerName: $('banner-name'),
    bannerGroup: $('banner-group'), bannerQ: $('banner-q'), bannerTime: $('banner-time'),
    osd: $('osd'), diag: $('diag'),
    pin: $('pin'), pinMsg: $('pin-msg'), pinDots: $('pin-dots')
  };

  var view = 'setup';
  var channels = [];
  var groups = [];        // [{ name, kind, items: [channel index] }]
  var setupSel = 0;       // 0 = input, 1 = button
  var col = 'g';          // 'g' groups rail, 'c' channel list, 's' search field
  var gSel = 0;
  var cSel = 0;
  var playItems = [];     // the list CH+/CH- moves through
  var playIdx = 0;
  var osdTimer = null;
  var bannerTimer = null;
  var searchTimer = null;
  var watchTimer = null;
  var diagOn = false;     // blue key: on-screen stats, also saved on the user's own PC by the manager
  var diagTick = 0;
  var stats = {};
  var retries = 0;
  var parental = { salt: '', hash: '', locked: {} }; // from the playlist header written by MommyTV Manager
  var unlocked = false;   // the PIN was typed in this session
  var pinBuf = '';
  var pinDone = null;
  var pinFails = 0;
  var pinWaitUntil = 0;
  var lastTime = -1;
  var frozenS = 0;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable: nothing is remembered */ }
    return null;
  }

  function storeJson(key, value) {
    if (value !== undefined) { store(key, JSON.stringify(value)); return value; }
    try { return JSON.parse(store(key) || 'null'); } catch (e) { return null; }
  }

  function show(name) {
    view = name;
    ui.setup.className = 'view' + (name === 'setup' ? '' : ' hidden');
    ui.browser.className = 'view' + (name === 'browser' ? '' : ' hidden');
    ui.player.className = 'view' + (name === 'player' ? '' : ' hidden');
    ui.topbar.className = name === 'player' ? 'hidden' : '';
    ui.hint.className = name === 'browser' ? 'hint' : 'hint hidden';
    if (name === 'setup') renderSetup();
    if (name === 'browser') renderBrowser();
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function clockText() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function tick() {
    var d = new Date();
    ui.time.textContent = clockText();
    var day = DAYS[d.getDay()];
    ui.date.textContent = day.charAt(0).toUpperCase() + day.slice(1) + ' ' + d.getDate() + ' de ' + MONTHS[d.getMonth()];
    ui.bannerTime.textContent = clockText();
  }

  /* ---------- setup ---------- */

  function status(text, busy) {
    ui.msg.textContent = text;
    ui.setupSpin.className = 'spinner small' + (busy ? '' : ' hidden');
  }

  function renderSetup() {
    ui.url.className = setupSel === 0 ? 'focus' : '';
    ui.load.className = setupSel === 1 ? 'focus' : '';
    if (setupSel === 0) ui.url.focus(); else ui.url.blur();
  }

  // Older webOS TVs (e.g. 2019, Chromium 53) lack the current Let's Encrypt root; channels marked with it
  // are then hidden instead of failing one by one. Newer TVs keep them.
  function checkLetsEncrypt(cb) {
    var saved = storeJson(STORE_TLS);
    if (saved && Date.now() - saved.at < TLS_MAX_AGE) { cb(saved.ok); return; }
    var done = false;
    var finish = function (ok, remember) {
      if (done) return;
      done = true;
      if (remember) storeJson(STORE_TLS, { ok: ok, at: Date.now() });
      cb(ok);
    };
    var xhr = new XMLHttpRequest();
    xhr.open('GET', TLS_PROBE, true);
    xhr.timeout = 6000;
    xhr.onload = function () { finish(true, true); };
    xhr.onerror = function () { finish(false, navigator.onLine !== false); };
    xhr.ontimeout = function () { finish(true, false); }; // unknown: show everything, ask again next time
    xhr.send();
  }

  function load(url, onError) {
    url = url.trim();
    if (!url) { findManager(); return; }
    status('Cargando tu lista…', true);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
        (onError || fail)('El servidor respondió con el error ' + xhr.status + '.');
        return;
      }
      var list = M3U.parse(xhr.responseText);
      var head = M3U.header(xhr.responseText);
      var pin = head.pin.split(':');
      parental = { salt: pin[0] || '', hash: pin[1] || '', locked: {} };
      head.locked.split(';').forEach(function (c) { if (c) parental.locked[c] = true; });
      if (!list.length) { fail('La lista no contiene canales.'); return; }
      store(STORE_URL, url);
      checkLetsEncrypt(function (ok) {
        var usable = ok ? list : list.filter(function (ch) { return ch.cert !== 'letsencrypt'; });
        if (usable.length) useList(usable); else fail('Los canales de esta lista no son compatibles con este televisor.');
      });
    };
    xhr.onerror = function () { (onError || fail)('No se pudo conectar con esa dirección.'); };
    xhr.ontimeout = function () { (onError || fail)('La lista tardó demasiado en responder.'); };
    xhr.send();
  }

  /* ---------- finding MommyTV Manager on the local network ---------- */

  function myIp(cb) {
    if (!window.webOS || !webOS.service) { cb(''); return; }
    webOS.service.request('luna://com.palm.connectionmanager', {
      method: 'getStatus',
      onSuccess: function (r) { cb((r.wired && r.wired.ipAddress) || (r.wifi && r.wifi.ipAddress) || ''); },
      onFailure: function () { cb(''); }
    });
  }

  function probe(host, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://' + host + ':' + MANAGER_PORT + '/mommytv.json', true);
    xhr.timeout = 1500;
    xhr.onload = function () {
      var ok = false;
      try { ok = JSON.parse(xhr.responseText).app === 'mommytv-manager'; } catch (e) { /* not the manager */ }
      cb(ok);
    };
    xhr.onerror = xhr.ontimeout = function () { cb(false); };
    xhr.send();
  }

  // Probes every address of the TV's /24 network, 32 at a time; calls back with the playlist URL or ''.
  function discover(cb) {
    myIp(function (ip) {
      var m = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(ip);
      if (!m) { cb(''); return; }
      var hosts = [];
      for (var n = 1; n < 255; n++) if (String(n) !== m[2]) hosts.push(m[1] + '.' + n);
      var next = 0, pending = 0, found = false;
      (function pump() {
        while (!found && pending < 32 && next < hosts.length) {
          pending++;
          probe(hosts[next], (function (host) {
            return function (ok) {
              pending--;
              if (found) return;
              if (ok) { found = true; cb('http://' + host + ':' + MANAGER_PORT + '/playlist.m3u'); }
              else if (next < hosts.length) pump();
              else if (!pending) cb('');
            };
          })(hosts[next]));
          next++;
        }
      })();
    });
  }

  function findManager() {
    setupSel = 1; // keep the on-screen keyboard closed while searching
    show('setup');
    status('Buscando MommyTV Manager en tu red…', true);
    discover(function (url) {
      if (url) { ui.url.value = url; load(url); return; }
      status('No encontré MommyTV Manager. Ábrelo en tu PC o escribe la dirección de tu lista.', false);
      setupSel = 0;
      renderSetup();
    });
  }

  function fail(text) {
    status(text, false);
    if (view !== 'setup') show('setup');
  }

  /* ---------- channels and groups ---------- */

  var QUALITY = { 2160: '4K', 1440: 'QHD', 1080: 'FULL HD', 720: 'HD' };

  // "Canal (1080p) [Not 24/7]" -> title "Canal", quality "FULL HD"
  function describe(ch) {
    var m = /\((\d{3,4})p\)/.exec(ch.name);
    ch.q = m ? (QUALITY[m[1]] || '') : '';
    ch.title = ch.name.replace(/\s*\(\d{3,4}p\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim() || ch.name;
    ch.key = normalize(ch.title);
  }

  function normalize(s) {
    s = String(s).toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }

  function useList(list) {
    list = list.filter(function (ch) { return ch.nsfw !== '1'; }); // adult channels are never shown
    channels = list;
    urlIndex = null;
    var region = (/-([A-Za-z]{2})$/.exec(navigator.language || '') || [])[1];
    region = region ? region.toUpperCase() : '';
    var shortcuts = { name: 'Accesos directos', kind: 'apps', items: [] };
    var all = { name: 'Todos', kind: 'list', items: [] };
    var home = { name: '', kind: 'list', items: [] };
    var spanish = { name: 'En español', kind: 'list', items: [] };
    var cats = [], byCat = {}, countries = [], byCountry = {};
    var add = function (map, arr, key, make) {
      if (!map[key]) { map[key] = make(); arr.push(map[key]); }
      return map[key];
    };
    for (var i = 0; i < list.length; i++) {
      var ch = list[i];
      describe(ch);
      if (ch.url.indexOf(SHORTCUT) === 0) { shortcuts.items.push(i); continue; }
      all.items.push(i);
      var names = ch.cats ? ch.cats.split(';') : [ch.group || 'Sin grupo'];
      for (var n = 0; n < names.length; n++) {
        if (names[n]) add(byCat, cats, names[n], function () { return { name: names[n], kind: 'list', items: [] }; }).items.push(i);
      }
      if (ch.country) {
        add(byCountry, countries, ch.country, function () { return { code: ch.country, name: ch.countryName || ch.country, items: [] }; }).items.push(i);
        if (ch.country === region) { home.items.push(i); home.name = ch.countryName || region; }
      }
      if ((';' + ch.langs + ';').indexOf(';spa;') >= 0) spanish.items.push(i);
    }
    var bySize = function (a, b) { return b.items.length - a.items.length; };
    cats.sort(bySize);
    countries.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
    groups = [
      { name: 'Cambiar lista', kind: 'change', items: [] },
      { name: 'Buscar', kind: 'search', items: [], query: '' },
      { name: 'Favoritos', kind: 'fav', items: [] }
    ];
    if (shortcuts.items.length) groups.push(shortcuts);
    if (home.items.length) groups.push(home);
    if (spanish.items.length) groups.push(spanish);
    if (countries.length > 1) groups.push({ name: 'Países', kind: 'countries', countries: countries, country: null, items: [] });
    if (all.items.length) groups.push(all);
    if (cats.length > 1) groups = groups.concat(cats); // a single group would only repeat "Todos"
    refreshFavourites();
    col = 'g'; cSel = 0;
    gSel = 2;
    if (!groups[2].items.length) {
      gSel = groups.indexOf(home.items.length ? home : all);
      if (gSel < 0) gSel = Math.min(3, groups.length - 1);
    }
    status('', false);
    show('browser');
    resumeLast(all);
  }

  function resumeLast(all) {
    var last = store(STORE_LAST);
    if (!last) return;
    var g = groups[gSel], at = -1;
    for (var i = 0; i < g.items.length; i++) if (channels[g.items[i]].url === last) { at = i; break; }
    if (at < 0) {
      gSel = groups.indexOf(all);
      g = all;
      for (var j = 0; j < all.items.length; j++) if (channels[all.items[j]].url === last) { at = j; break; }
    }
    if (at < 0 || gSel < 0) return;
    col = 'c';
    cSel = at;
    play(g.items, at);
  }

  var urlIndex = null; // url -> channel index, rebuilt only when a new list arrives
  function indexByUrl() {
    if (urlIndex) return urlIndex;
    urlIndex = {};
    for (var i = 0; i < channels.length; i++) if (!(channels[i].url in urlIndex)) urlIndex[channels[i].url] = i;
    return urlIndex;
  }

  // Favourites: the channels pinned with the yellow key, then the most watched ones.
  function refreshFavourites() {
    var map = indexByUrl();
    var pinned = pins();
    var watch = storeJson(STORE_WATCH) || {};
    var items = [], seen = {};
    for (var i = 0; i < pinned.length && items.length < FAV_MAX; i++) {
      if (pinned[i] in map && !seen[pinned[i]]) { items.push(map[pinned[i]]); seen[pinned[i]] = true; }
    }
    var hidden = storeJson(STORE_HIDDEN) || [];
    var watched = Object.keys(watch).filter(function (u) { return watch[u] >= 60 && u in map && !seen[u] && hidden.indexOf(u) < 0; });
    watched.sort(function (a, b) { return watch[b] - watch[a]; });
    for (var j = 0; j < watched.length && items.length < FAV_MAX; j++) items.push(map[watched[j]]);
    groups[2].items = items;
  }

  var pinsCache = null; // the pinned list, read from storage once and kept in sync by togglePin
  function pins() { if (!pinsCache) pinsCache = storeJson(STORE_PINS) || []; return pinsCache; }
  function isPinned(ch) { return pins().indexOf(ch.url) >= 0; }

  function inFavourites(ch) {
    refreshFavourites();
    var fav = groups[2].items;
    for (var i = 0; i < fav.length; i++) if (channels[fav[i]].url === ch.url) return true;
    return false;
  }

  // One action for the user: if the channel is in Favoritos (pinned or most watched) it leaves for good,
  // otherwise it is pinned.
  function togglePin(ch) {
    if (ch.url.indexOf(SHORTCUT) === 0) return;
    var pinned = pins().slice();
    var hidden = storeJson(STORE_HIDDEN) || [];
    var removing = inFavourites(ch);
    var at = pinned.indexOf(ch.url);
    if (at >= 0) pinned.splice(at, 1);
    var h = hidden.indexOf(ch.url);
    if (h >= 0) hidden.splice(h, 1);
    if (removing) hidden.unshift(ch.url); else pinned.unshift(ch.url);
    pinsCache = pinned.slice(0, 200);
    storeJson(STORE_PINS, pinsCache);
    storeJson(STORE_HIDDEN, hidden.slice(0, 300));
    refreshFavourites();
    osd(removing ? '«' + ch.title + '» ya no está en Favoritos' : '«' + ch.title + '» añadido a Favoritos');
  }

  function addWatch(url, seconds) {
    var watch = storeJson(STORE_WATCH) || {};
    watch[url] = (watch[url] || 0) + seconds;
    var urls = Object.keys(watch);
    if (urls.length > 300) { // keep only the most watched so storage stays small
      urls.sort(function (a, b) { return watch[b] - watch[a]; });
      for (var i = 300; i < urls.length; i++) delete watch[urls[i]];
    }
    storeJson(STORE_WATCH, watch);
  }

  function runSearch() {
    var g = groups[1];
    var q = normalize(ui.search.value.trim());
    g.query = ui.search.value;
    g.items = [];
    if (q) {
      for (var i = 0; i < channels.length && g.items.length < SEARCH_MAX; i++) {
        if (channels[i].key.indexOf(q) >= 0) g.items.push(i);
      }
    }
    cSel = 0;
    renderBrowser();
  }

  // "Países" first lists countries; OK opens one and then it lists that country's channels.
  function channelsText(n) { return n === 1 ? '1 canal' : n + ' canales'; }

  function showingCountries(g) { return g.kind === 'countries' && !g.country; }
  function listLength(g) { return showingCountries(g) ? g.countries.length : g.items.length; }

  /* ---------- browser rendering ---------- */

  // Draws a window of rows into a fixed pool of <li>, so focus changes animate instead of rebuilding.
  function renderWindow(el, total, sel, focused, rows, fill) {
    var start = Math.max(0, Math.min(sel - Math.floor(rows / 2), total - rows));
    var count = Math.min(rows, total);
    while (el.children.length > count) el.removeChild(el.lastChild);
    while (el.children.length < count) el.appendChild(document.createElement('li'));
    for (var k = 0; k < count; k++) {
      var li = el.children[k], i = start + k;
      var stamp = i + '|' + fill.stamp(i);
      if (li.getAttribute('data-stamp') !== stamp) {
        li.textContent = '';
        fill.row(li, i);
        li.setAttribute('data-stamp', stamp);
      }
      li.className = i === sel ? (focused ? 'focus' : 'current') : '';
    }
  }

  function initial(text) {
    var m = /[A-Za-z0-9À-ɏ]/.exec(text);
    return m ? m[0].toUpperCase() : '•';
  }

  function setTile(el, ch) {
    el.textContent = '';
    var letter = function () { el.textContent = initial(ch ? ch.title : ''); };
    if (ch && ch.logo) {
      var img = document.createElement('img');
      img.onerror = letter;
      img.src = ch.logo;
      el.appendChild(img);
    } else {
      letter();
    }
  }

  function span(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  var ICONS = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>',
    fav: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>',
    change: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 3.5v5.2h-5.2"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20.5v-5.2h5.2"/></svg>',
    apps: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></svg>'
  };

  function icon(name, cls) {
    var s = document.createElement('span');
    s.className = 'icon ' + (cls || '');
    s.innerHTML = ICONS[name]; // static markup, never playlist data
    return s;
  }

  function heroIcon(name) {
    ui.heroTile.textContent = '';
    ui.heroTile.appendChild(icon(name, name === 'fav' ? 'big gold' : 'big'));
  }

  var railFill = {
    stamp: function (i) { return groups[i].name + listLength(groups[i]) + (unlocked ? 'u' : ''); },
    row: function (li, i) {
      var g = groups[i];
      var name = { search: 'search', fav: 'fav', change: 'change', apps: 'apps', countries: 'globe' }[g.kind];
      if (!name && parental.locked[g.name] && parental.hash && !unlocked) name = 'lock';
      if (name) li.appendChild(icon(name, g.kind === 'fav' ? 'gold' : ''));
      li.appendChild(span('label', g.name));
      if (g.kind === 'countries') li.appendChild(span('count', g.countries.length));
      else if (g.kind !== 'change' && g.kind !== 'search') li.appendChild(span('count', g.items.length));
    }
  };

  var countryFill = {
    stamp: function (i) { return 'country' + groups[gSel].countries[i].code; },
    row: function (li, i) {
      var c = groups[gSel].countries[i];
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.textContent = c.code;
      li.appendChild(tile);
      li.appendChild(span('name', c.name));
      li.appendChild(span('count', channelsText(c.items.length)));
    }
  };

  var listFill = {
    stamp: function (i) { var ch = channels[groups[gSel].items[i]]; return gSel + ch.url + (isPinned(ch) ? '*' : ''); },
    row: function (li, i) {
      var ch = channels[groups[gSel].items[i]];
      var tile = document.createElement('div');
      tile.className = 'tile';
      setTile(tile, ch);
      li.appendChild(tile);
      li.appendChild(span('num', i + 1));
      li.appendChild(span('name', ch.title));
      if (isPinned(ch)) li.appendChild(icon('fav', 'gold star'));
      if (ch.q) li.appendChild(span('chip', ch.q));
    }
  };

  function renderHero() {
    var g = groups[gSel];
    var searching = g.kind === 'search';
    ui.search.className = searching ? (col === 's' ? 'focus' : '') : 'hidden';
    ui.heroName.className = searching ? 'hidden' : '';
    var ch = g.items.length ? channels[g.items[Math.min(cSel, g.items.length - 1)]] : null;
    ui.heroLive.className = 'live' + (ch && g.kind !== 'search' && g.kind !== 'change' && ch.url.indexOf(SHORTCUT) !== 0 ? '' : ' hidden');
    if (showingCountries(g)) {
      var c = g.countries[Math.min(cSel, g.countries.length - 1)];
      heroIcon('globe');
      ui.heroName.textContent = col === 'c' && c ? c.name : 'Países';
      ui.heroGroup.textContent = col === 'c' && c ? channelsText(c.items.length) + '  ·  OK para abrir' : g.countries.length + ' países';
      ui.heroQ.textContent = '';
      return;
    }
    if (searching) {
      heroIcon('search');
      ui.heroGroup.textContent = g.items.length ? g.items.length + ' resultados' : (g.query ? 'Sin resultados' : 'Pulsa OK y escribe el nombre');
      ui.heroQ.textContent = '';
      return;
    }
    if (g.kind === 'change') {
      heroIcon('change');
      ui.heroName.textContent = 'Cambiar de lista';
      ui.heroGroup.textContent = 'Pulsa OK para elegir otra lista o buscar MommyTV Manager';
      ui.heroQ.textContent = '';
      return;
    }
    if (!ch) {
      if (g.kind === 'fav') heroIcon('fav'); else setTile(ui.heroTile, null);
      ui.heroName.textContent = g.kind === 'fav' ? 'Aún no hay favoritos' : g.name;
      ui.heroGroup.textContent = g.kind === 'fav' ? 'Mantén pulsado OK sobre un canal, o mira canales y aparecerán aquí' : '';
      ui.heroQ.textContent = '';
      return;
    }
    setTile(ui.heroTile, ch);
    ui.heroName.textContent = ch.title;
    var where = g.kind === 'countries' ? g.country.name : (ch.cats ? ch.cats.split(';')[0] : ch.group || 'Sin grupo');
    ui.heroGroup.textContent = (ch.url.indexOf(SHORTCUT) === 0 ? 'App oficial' : where) + (isPinned(ch) ? '  ·  Favorito' : '');
    ui.heroQ.textContent = ch.q;
  }

  function renderBrowser() {
    renderWindow(ui.groups, groups.length, gSel, col === 'g', RAIL_ROWS, railFill);
    var g = groups[gSel];
    renderWindow(ui.channels, listLength(g), cSel, col === 'c', LIST_ROWS, showingCountries(g) ? countryFill : listFill);
    renderHero();
  }

  function openSearch() {
    col = 's';
    renderBrowser();
    ui.search.focus();
  }

  function closeSearch(toResults) {
    ui.search.blur();
    col = toResults && groups[1].items.length ? 'c' : 'g';
    renderBrowser();
  }

  ui.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });

  function browserKey(k) {
    var g = groups[gSel];
    var items = g.items;
    if (col === 's') {
      if (k === KEY.OK || k === KEY.DOWN) { clearTimeout(searchTimer); runSearch(); closeSearch(true); return true; }
      if (k === KEY.BACK) { closeSearch(false); return true; }
      return false; // let the field receive the typing
    }
    if (k === KEY.UP || k === KEY.DOWN) {
      var d = k === KEY.UP ? -1 : 1;
      if (col === 'g') {
        gSel = Math.max(0, Math.min(groups.length - 1, gSel + d));
        cSel = 0;
        if (groups[gSel].kind === 'fav') refreshFavourites();
      } else {
        cSel = Math.max(0, Math.min(listLength(g) - 1, cSel + d));
      }
    } else if (k === KEY.OK && col === 'g' && g.kind === 'change') {
      ui.url.value = store(STORE_URL) || ui.url.value;
      setupSel = 0;
      show('setup');
      return true;
    } else if (k === KEY.OK && col === 'g' && g.kind === 'search') {
      openSearch();
      return true;
    } else if (k === KEY.RIGHT || (k === KEY.OK && col === 'g')) {
      if (listLength(g)) col = 'c';
    } else if (k === KEY.LEFT) {
      col = 'g';
    } else if (k === KEY.OK && showingCountries(g)) {
      g.country = g.countries[cSel];
      g.items = g.country.items;
      g.back = cSel;
      cSel = 0;
    } else if (k === KEY.BACK && col === 'c' && g.kind === 'countries' && g.country) {
      g.country = null;
      g.items = [];
      cSel = g.back || 0;
    } else if (k === KEY.OK) {
      var ch = channels[items[cSel]];
      if (ch.url.indexOf(SHORTCUT) === 0) launchApp(ch); else play(items, cSel);
      return true;
    } else if (k === KEY.YELLOW && col === 'c' && items.length && !showingCountries(g)) {
      togglePin(channels[items[cSel]]);
      if (g.kind === 'fav') { refreshFavourites(); cSel = Math.min(cSel, Math.max(0, g.items.length - 1)); if (!g.items.length) col = 'g'; }
    } else if (k === KEY.BACK) {
      if (col === 'c') col = 'g'; else window.close();
    }
    renderBrowser();
    return true;
  }

  /* ---------- shortcuts ---------- */

  function launchApp(ch) {
    if (!window.webOS || !webOS.service) { osd('Los accesos directos solo funcionan en la TV.'); return; }
    webOS.service.request('luna://com.webos.applicationManager', {
      method: 'launch',
      parameters: { id: ch.url.slice(SHORTCUT.length) },
      onFailure: function (err) {
        osd(err.errorCode === -101 ?
          'La app «' + ch.title + '» no está instalada en esta TV.' :
          'No se pudo abrir «' + ch.title + '» (error ' + err.errorCode + ').');
      }
    });
  }

  /* ---------- parental control ---------- */

  function isLocked(ch) {
    if (!parental.hash || unlocked) return false;
    var cats = ch.cats ? ch.cats.split(';') : [ch.group || ''];
    for (var i = 0; i < cats.length; i++) if (parental.locked[cats[i]]) return true;
    return false;
  }

  function renderPin(msg) {
    ui.pinMsg.textContent = msg || 'Escribe el PIN con los números del mando';
    for (var i = 0; i < 4; i++) ui.pinDots.children[i].className = i < pinBuf.length ? 'on' : '';
  }

  function askPin(done) {
    pinDone = done;
    pinBuf = '';
    ui.pin.className = '';
    renderPin();
  }

  function closePin() {
    pinDone = null;
    ui.pin.className = 'hidden';
  }

  function pinKey(k) {
    if (k === KEY.BACK) { closePin(); return; }
    var digit = k >= 48 && k <= 57 ? k - 48 : k >= 96 && k <= 105 ? k - 96 : -1;
    if (digit < 0) return;
    if (Date.now() < pinWaitUntil) { renderPin('Demasiados intentos. Espera un minuto.'); return; }
    pinBuf += digit;
    renderPin();
    if (pinBuf.length < 4) return;
    if (sha256(parental.salt + ':' + pinBuf) === parental.hash) {
      unlocked = true;
      pinFails = 0;
      var done = pinDone;
      closePin();
      if (view === 'browser') renderBrowser();
      if (done) done();
      return;
    }
    pinFails++;
    pinBuf = '';
    if (pinFails >= 5) { pinFails = 0; pinWaitUntil = Date.now() + 60000; renderPin('Demasiados intentos. Espera un minuto.'); }
    else renderPin('PIN incorrecto. Inténtalo de nuevo.');
  }

  /* ---------- player ---------- */

  function osd(text, sticky) {
    clearTimeout(osdTimer);
    ui.osd.textContent = text;
    ui.osd.className = '';
    if (!sticky) osdTimer = setTimeout(function () { ui.osd.className = 'hidden'; }, 4000);
  }

  function hideOsd() {
    clearTimeout(osdTimer);
    ui.osd.className = 'hidden';
  }

  function current() { return channels[playItems[playIdx]]; }

  function showBanner() {
    var ch = current();
    setTile(ui.bannerTile, ch);
    ui.bannerNum.textContent = playIdx + 1;
    ui.bannerName.textContent = ch.title;
    ui.bannerGroup.textContent = (ch.group || 'Sin grupo') + (isPinned(ch) ? '  ·  Favorito' : '');
    ui.bannerQ.textContent = ch.q;
    ui.bannerTime.textContent = clockText();
    ui.banner.className = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { ui.banner.className = 'hidden'; }, 5000);
  }

  function play(items, i, retry) {
    if (!retry && items.length) {
      var target = channels[items[(i + items.length) % items.length]];
      if (isLocked(target)) { askPin(function () { play(items, i); }); return; }
    }
    stopWatch();
    if (!retry) { retries = 0; stats = { t0: Date.now(), startup: 0, stalls: 0, stallMs: 0, stallAt: 0 }; }
    lastTime = -1;
    frozenS = 0;
    playItems = items.slice();
    playIdx = (i + playItems.length) % playItems.length;
    if (playItems === groups[gSel].items || items === groups[gSel].items) cSel = playIdx;
    var ch = current();
    show('player');
    hideOsd();
    clearSource();
    ui.playSpin.className = 'spinner';
    if (/\.m3u8(\?|$)/i.test(ch.url)) {
      var source = document.createElement('source');
      source.src = ch.url;
      source.type = hlsType();
      source.addEventListener('error', playError); // with <source>, errors fire here, not on <video>
      ui.video.appendChild(source);
      ui.video.load();
    } else {
      ui.video.src = ch.url;
    }
    var p = ui.video.play();
    if (p && p.catch) p.catch(function () { /* reported by the error event */ });
    if (!retry) { showBanner(); store(STORE_LAST, ch.url); }
  }

  // Many IPTV hiccups are momentary: reconnect quietly a few times before giving up.
  function reconnect() {
    if (retries >= RETRIES) return false;
    retries++;
    osd('Reconectando «' + current().title + '»…');
    play(playItems, playIdx, true);
    return true;
  }

  setInterval(function () {
    if (view !== 'player' || ui.video.paused || !stats.startup) return;
    var t = ui.video.currentTime;
    if (t !== lastTime) { lastTime = t; frozenS = 0; return; }
    frozenS += 2;
    if (frozenS >= FREEZE_S) { frozenS = 0; reconnect(); }
  }, 2000);

  // Moves a live stream to LIVE_TARGET_S behind its edge when it is too close (first start) or,
  // after a stall, too far. Streams without a live window are left alone.
  function placeInLive(first) {
    var v = ui.video;
    try {
      if (!v.seekable.length) return;
      var start = v.seekable.start(0), edge = v.seekable.end(v.seekable.length - 1);
      if (edge - start < LIVE_TARGET_S + 4) return;
      var lag = edge - v.currentTime;
      if ((first && lag < LIVE_TARGET_S - 2) || lag > LIVE_LAG_S) v.currentTime = edge - LIVE_TARGET_S;
    } catch (e) { /* not seekable: keep playing where it is */ }
  }

  function startWatch() {
    stopWatch();
    var url = current().url;
    watchTimer = setInterval(function () { addWatch(url, 15); }, 15000);
  }

  function stopWatch() { clearInterval(watchTimer); watchTimer = null; }

  function stop() {
    stopWatch();
    hideOsd();
    clearTimeout(bannerTimer);
    ui.banner.className = 'hidden';
    ui.playSpin.className = 'spinner hidden';
    ui.video.pause();
    clearSource();
    ui.video.load();
  }

  function clearSource() {
    ui.video.removeAttribute('src');
    while (ui.video.firstChild) ui.video.removeChild(ui.video.firstChild);
  }

  function playError() {
    if (view !== 'player') return;
    stopWatch();
    if (reconnect()) return;
    ui.playSpin.className = 'spinner hidden';
    osd('No se puede reproducir «' + current().title + '». Prueba otro canal.', true);
  }

  ui.video.addEventListener('error', playError);
  ui.video.addEventListener('waiting', function () {
    if (view !== 'player') return;
    ui.playSpin.className = 'spinner';
    if (stats.startup && !stats.stallAt) { stats.stalls++; stats.stallAt = Date.now(); }
  });
  ui.video.addEventListener('playing', function () {
    if (view !== 'player') return;
    ui.playSpin.className = 'spinner hidden';
    if (!stats.startup) { stats.startup = Date.now() - stats.t0; placeInLive(true); }
    if (stats.stallAt) { stats.stallMs += Date.now() - stats.stallAt; stats.stallAt = 0; placeInLive(false); }
    if (retries) hideOsd();
    if (!watchTimer) startWatch();
  });

  /* ---------- diagnostics ---------- */

  function sample() {
    var v = ui.video, ahead = 0;
    for (var i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) > v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
    }
    var ch = current() || {};
    var host = (/^https?:\/\/([^\/:]+)/.exec(ch.url || '') || [])[1] || '';
    return {
      channel: ch.title, host: host, width: v.videoWidth, height: v.videoHeight,
      ahead: Math.round(ahead * 10) / 10, startupMs: stats.startup, stalls: stats.stalls,
      stallMs: stats.stallMs + (stats.stallAt ? Date.now() - stats.stallAt : 0),
      dropped: v.webkitDroppedFrameCount || 0, decoded: v.webkitDecodedFrameCount || 0,
      watchedS: Math.round((Date.now() - stats.t0) / 1000)
    };
  }

  function managerBase() {
    var m = /^(http:\/\/[^\/]+:8642)\/playlist\.m3u$/.exec(store(STORE_URL) || '');
    return m ? m[1] : '';
  }

  function renderDiag(d) {
    var line = function (label, value, bad) { return '<div' + (bad ? ' class="bad"' : '') + '>' + label + ' <b>' + value + '</b></div>'; };
    var esc = function (t) { var e = document.createElement('i'); e.textContent = t; return e.innerHTML; };
    ui.diag.innerHTML =
      line('Canal', esc(d.channel || '')) +
      line('Resolución real', d.width ? d.width + '×' + d.height : '—', d.width && d.height < 720) +
      line('Reserva', d.ahead.toFixed(1) + ' s', d.ahead < 3) +
      line('Arranque', d.startupMs ? (d.startupMs / 1000).toFixed(1) + ' s' : 'cargando…', d.startupMs > 5000) +
      line('Cortes', d.stalls + (d.stallMs ? ' (' + (d.stallMs / 1000).toFixed(1) + ' s)' : ''), d.stalls > 0) +
      line('Cuadros perdidos', d.dropped + ' de ' + d.decoded, d.decoded && d.dropped / d.decoded > 0.01) +
      '<div style="margin-top:10px;color:#94a3b8;font-size:20px">' + (managerBase() ? 'Se guarda solo en tu PC' : 'Solo en pantalla') + ' · botón azul para cerrar</div>';
  }

  setInterval(function () {
    if (!diagOn || view !== 'player') return;
    var d = sample();
    renderDiag(d);
    var base = managerBase();
    if (base && ++diagTick % 3 === 0) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', base + '/diag', true);
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.send(JSON.stringify(d));
    }
  }, 2000);

  function toggleDiag() {
    diagOn = !diagOn;
    ui.diag.className = diagOn ? '' : 'hidden';
    if (diagOn) { renderDiag(sample()); osd(managerBase() ? 'Diagnóstico activado: los datos se guardan solo en tu PC' : 'Diagnóstico activado'); }
    else osd('Diagnóstico desactivado');
  }

  function playerKey(k) {
    if (k === KEY.BLUE) { toggleDiag(); return; }
    if (k === KEY.UP || k === KEY.CH_UP) play(playItems, playIdx + 1);
    else if (k === KEY.DOWN || k === KEY.CH_DOWN) play(playItems, playIdx - 1);
    else if (k === KEY.OK) showBanner();
    else if (k === KEY.YELLOW) { togglePin(current()); showBanner(); }
    else if (k === KEY.BACK) {
      stop();
      if (groups[gSel].kind === 'fav') refreshFavourites();
      show('browser');
    }
  }

  /* ---------- keys ---------- */

  function setupKey(k, e) {
    if (k === KEY.UP || k === KEY.DOWN) {
      setupSel = k === KEY.UP ? 0 : 1;
      renderSetup();
    } else if (k === KEY.OK && setupSel === 1) {
      load(ui.url.value);
    } else if (k === KEY.BACK) {
      if (channels.length) show('browser'); else window.close();
    } else {
      return;
    }
    e.preventDefault();
  }

  // Holding OK toggles Favoritos on any remote. It is only used once the remote has shown it sends keyup;
  // until then OK acts on keydown as before, so a remote without keyup can never get stuck.
  var HOLD_MS = 700;
  var okTimer = null;
  var okHeld = false;
  var keyupSeen = false;

  function holdTarget() {
    if (view === 'player') return current();
    if (view !== 'browser' || col !== 'c') return null;
    var g = groups[gSel];
    if (showingCountries(g) || !g.items.length) return null;
    var ch = channels[g.items[cSel]];
    return ch.url.indexOf(SHORTCUT) === 0 ? null : ch;
  }

  function holdFavourite() {
    okTimer = null;
    okHeld = true;
    var ch = holdTarget();
    if (!ch) return;
    togglePin(ch);
    if (view === 'player') { showBanner(); return; }
    var g = groups[gSel];
    if (g.kind === 'fav') {
      refreshFavourites();
      cSel = Math.min(cSel, Math.max(0, g.items.length - 1));
      if (!g.items.length) col = 'g';
    }
    renderBrowser();
  }

  document.addEventListener('keyup', function (e) {
    keyupSeen = true; // any key: this remote reports releases
    if (pinDone) return;
    if (e.keyCode !== KEY.OK) return;
    if (okHeld) { okHeld = false; return; }
    if (!okTimer) return;
    clearTimeout(okTimer);
    okTimer = null;
    if (view === 'browser') browserKey(KEY.OK); else if (view === 'player') playerKey(KEY.OK);
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode === KEY.ESC ? KEY.BACK : e.keyCode;
    if (pinDone) { e.preventDefault(); pinKey(k); return; }
    if (k === KEY.OK && keyupSeen && (okTimer || okHeld || holdTarget())) {
      e.preventDefault();
      if (!okTimer && !okHeld && !e.repeat) okTimer = setTimeout(holdFavourite, HOLD_MS);
      return;
    }
    if (view === 'setup') { setupKey(k, e); return; }
    if (view === 'browser') { if (browserKey(k)) e.preventDefault(); return; }
    e.preventDefault();
    playerKey(k);
  });

  /* ---------- start ---------- */

  tick();
  setInterval(tick, 15000);
  if (window.webOS && webOS.deviceInfo) {
    webOS.deviceInfo(function (info) {
      if (info && info.screenWidth && info.screenHeight) screenSize = { w: info.screenWidth, h: info.screenHeight };
    });
  }

  var saved = store(STORE_URL);
  if (saved) {
    ui.url.value = saved;
    setupSel = 1; // keep the on-screen keyboard closed while the saved list loads
    show('setup');
    load(saved, findManager); // the manager's PC may have a new address
  } else {
    findManager();
  }
})();
