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
  var STORE_COPY = 'mtvListCopy';  // a copy of the remembered playlist, used when its site does not answer
  var STORE_TLS = 'mtvLetsEncrypt'; // { ok: bool, at: ms }: can this TV open Let's Encrypt HTTPS?
  var TLS_PROBE = 'https://acme-v02.api.letsencrypt.org/directory'; // official, tiny, allows CORS
  var TLS_MAX_AGE = 7 * 24 * 3600 * 1000;
  var FAV_MAX = 30;
  var SEARCH_MAX = 300;
  var SHORTCUT = 'webos-app://';   // playlist entry that opens an installed app instead of a stream
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
  var t = I18N.t;
  var VERSION = '0.1.0';
  // Ajustes: the rows that do something first, then the dedication and the information
  var ROW_CHANGE = 0;
  var ROW_DELETE = 1;
  var SETTINGS = [
    ['change', t('change')],
    ['trash', t('deleteList')],
    ['heart', t('dedication')],
    ['info', 'MommyTV ' + VERSION + ' · ' + t('org')],
    ['info', t('license')],
    ['info', t('source')],
    ['info', t('noChannels')],
    ['info', t('lgLib')],
    ['info', t('font')]
  ];

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
    pin: $('pin'), pinMsg: $('pin-msg'), pinDots: $('pin-dots'), remember: $('remember')
  };

  var view = 'setup';
  var channels = [];
  var groups = [];        // [{ name, kind, items: [channel index] }]
  var setupSel = 0;       // 0 = input, 1 = remember box, 2 = button
  var rememberList = true; // "Recordar esta lista", on unless the user unticks it
  var deleteArmed = 0;    // time of the first OK on "Eliminar lista"; a second one within 5 s deletes
  var col = 'g';          // 'g' groups rail, 'c' channel list, 's' search field
  var gSel = 0;
  var searchGroup = null; // groups the code reaches by name, not by position
  var favGroup = null;
  var cSel = 0;
  var playItems = [];     // the list CH+/CH- moves through
  var playIdx = 0;
  var osdTimer = null;
  var bannerTimer = null;
  var searchTimer = null;
  var watchTimer = null;
  var diagOn = false;     // blue key: on-screen stats, also saved on the user's own PC by the manager
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
    ui.date.textContent = I18N.date(d);
    ui.bannerTime.textContent = clockText();
  }

  /* ---------- setup ---------- */

  function status(text, busy) {
    ui.msg.textContent = text;
    ui.setupSpin.className = 'spinner small' + (busy ? '' : ' hidden');
  }

  function renderSetup() {
    ui.url.className = setupSel === 0 ? 'focus' : '';
    ui.remember.className = 'check' + (rememberList ? ' on' : '') + (setupSel === 1 ? ' focus' : '');
    ui.load.className = setupSel === 2 ? 'focus' : '';
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

  // Loads the playlist the user gave. Remembered (with a copy) unless "Recordar esta lista" is off;
  // when its site does not answer, a remembered list starts from the copy.
  function load(url, fromCopy) {
    url = url.trim();
    if (!url) { fail(t('needUrl')); return; }
    status(t('loading'), true);
    var copy = function (why) {
      var saved = fromCopy && store(STORE_COPY);
      if (saved && store(STORE_URL) === url) { useText(saved); osd(t('usingCopy')); } else fail(why);
    };
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) { copy(t('httpError', xhr.status)); return; }
      if (!M3U.parse(xhr.responseText).length) { fail(t('emptyList')); return; }
      if (rememberList) { store(STORE_URL, url); store(STORE_COPY, xhr.responseText); } else forgetList(false);
      useText(xhr.responseText);
    };
    xhr.onerror = function () { copy(t('noConnect')); };
    xhr.ontimeout = function () { copy(t('slow')); };
    xhr.send();
  }

  function useText(text) {
    var list = M3U.parse(text);
    var head = M3U.header(text);
    var pin = head.pin.split(':');
    parental = { salt: pin[0] || '', hash: pin[1] || '', locked: {} };
    head.locked.split(';').forEach(function (c) { if (c) parental.locked[c] = true; });
    checkLetsEncrypt(function (ok) {
      var usable = ok ? list : list.filter(function (ch) { return ch.cert !== 'letsencrypt'; });
      if (usable.length) useList(usable); else fail(t('incompatible'));
    });
  }

  // "Eliminar lista": the playlist, its copy and what belongs to it (Favoritos, watch time, last channel).
  function forgetList(everything) {
    var keys = [STORE_URL, STORE_COPY];
    if (everything) keys.push(STORE_LAST, STORE_PINS, STORE_WATCH, STORE_HIDDEN);
    for (var i = 0; i < keys.length; i++) { try { localStorage.removeItem(keys[i]); } catch (e) { /* storage unavailable */ } }
    if (everything) pinsCache = null;
  }

  function fail(text) {
    status(text, false);
    if (view !== 'setup') show('setup');
  }

  /* ---------- channels and groups ---------- */

  var QUALITY = { 2160: '4K', 1440: 'QHD', 1080: 'FULL HD', 720: 'HD' };

  // "Canal (1080p) [Not 24/7]" -> title "Canal", quality "FULL HD"
  function describe(ch) {
    var m = /\((\d{3,4})[pi]\)/.exec(ch.name); // 1080p, also 480i
    ch.q = m ? (QUALITY[m[1]] || '') : '';
    ch.title = ch.name.replace(/\s*\(\d{3,4}[pi]\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim() || ch.name;
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
    var shortcuts = { name: t('shortcuts'), kind: 'apps', items: [] };
    var all = { name: t('all'), kind: 'list', items: [] };
    var home = { name: '', kind: 'list', items: [] };
    var spanish = { name: t('inLang'), kind: 'list', items: [] };
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
      var names = ch.cats ? ch.cats.split(';') : [ch.group || t('noGroup')];
      for (var n = 0; n < names.length; n++) {
        if (names[n]) add(byCat, cats, names[n], function () { return { name: names[n], kind: 'list', items: [] }; }).items.push(i);
      }
      if (ch.country) {
        add(byCountry, countries, ch.country, function () { return { code: ch.country, name: ch.countryName || ch.country, items: [] }; }).items.push(i);
        if (ch.country === region) { home.items.push(i); home.name = ch.countryName || region; }
      }
      if ((';' + ch.langs + ';').indexOf(';' + I18N.iso3 + ';') >= 0) spanish.items.push(i);
    }
    var bySize = function (a, b) { return b.items.length - a.items.length; };
    cats.sort(bySize);
    countries.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
    groups = [
      searchGroup = { name: t('search'), kind: 'search', items: [], query: '' },
      favGroup = { name: t('favs'), kind: 'fav', items: [] }
    ];
    if (shortcuts.items.length) groups.push(shortcuts);
    if (home.items.length) groups.push(home);
    if (spanish.items.length) groups.push(spanish);
    if (countries.length > 1) groups.push({ name: t('countries'), kind: 'countries', countries: countries, country: null, items: [] });
    if (all.items.length) groups.push(all);
    if (cats.length > 1) groups = groups.concat(cats); // a single group would only repeat "Todos"
    groups.push({ name: t('settings'), kind: 'settings', items: [] });
    refreshFavourites();
    col = 'g'; cSel = 0;
    gSel = groups.indexOf(favGroup);
    if (!favGroup.items.length) {
      gSel = groups.indexOf(home.items.length ? home : all);
      if (gSel < 0) gSel = Math.min(2, groups.length - 1); // first group after Favoritos
    }
    status('', false);
    show('browser');
    selectLast(all);
    if (pendingPlay) { var c = pendingPlay; pendingPlay = null; remotePlay(c); }
  }

  // Marks the last channel watched; playback waits for the user.
  function selectLast(all) {
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
    renderBrowser();
  }

  var urlIndex = null; // url -> channel index, rebuilt only when a new list arrives
  function indexByUrl() {
    if (urlIndex) return urlIndex;
    urlIndex = {};
    for (var i = 0; i < channels.length; i++) if (!channels[i].foreign && !(channels[i].url in urlIndex)) urlIndex[channels[i].url] = i;
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
    favGroup.items = items;
  }

  var pinsCache = null; // the pinned list, read from storage once and kept in sync by togglePin
  function pins() { if (!pinsCache) pinsCache = storeJson(STORE_PINS) || []; return pinsCache; }
  function isPinned(ch) { return pins().indexOf(ch.url) >= 0; }

  function inFavourites(ch) {
    refreshFavourites();
    var fav = favGroup.items;
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
    osd(removing ? t('favRemoved', ch.title) : t('favAdded', ch.title));
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
    var g = searchGroup;
    var q = normalize(ui.search.value.trim());
    g.query = ui.search.value;
    g.items = [];
    if (q) {
      for (var i = 0; i < channels.length && g.items.length < SEARCH_MAX; i++) {
        if (!channels[i].foreign && channels[i].key.indexOf(q) >= 0) g.items.push(i);
      }
    }
    cSel = 0;
    renderBrowser();
  }

  // "Países" first lists countries; OK opens one and then it lists that country's channels.
  function channelsText(n) { return n === 1 ? t('oneChannel') : t('nChannels', n); }

  function showingCountries(g) { return g.kind === 'countries' && !g.country; }
  function listLength(g) { return g.kind === 'settings' ? SETTINGS.length : showingCountries(g) ? g.countries.length : g.items.length; }

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
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="0.6" fill="currentColor"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"><path d="M10.23,4.92L10.50,2.52L13.50,2.52L13.77,4.92L15.76,5.74L17.64,4.23L19.77,6.36L18.26,8.24L19.08,10.23L21.48,10.50L21.48,13.50L19.08,13.77L18.26,15.76L19.77,17.64L17.64,19.77L15.76,18.26L13.77,19.08L13.50,21.48L10.50,21.48L10.23,19.08L8.24,18.26L6.36,19.77L4.23,17.64L5.74,15.76L4.92,13.77L2.52,13.50L2.52,10.50L4.92,10.23L5.74,8.24L4.23,6.36L6.36,4.23L8.24,5.74ZM12,8.8a3.2,3.2 0 1,0 0,6.4a3.2,3.2 0 1,0 0,-6.4"/></svg>',
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
      var name = { search: 'search', fav: 'fav', apps: 'apps', countries: 'globe', settings: 'settings' }[g.kind];
      if (!name && parental.locked[g.name] && parental.hash && !unlocked) name = 'lock';
      if (name) li.appendChild(icon(name, g.kind === 'fav' ? 'gold' : ''));
      li.appendChild(span('label', g.name));
      if (g.kind === 'countries') li.appendChild(span('count', g.countries.length));
      else if (g.kind !== 'search' && g.kind !== 'settings') li.appendChild(span('count', g.items.length));
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

  var settingsFill = {
    stamp: function (i) { return 'settings' + i; },
    row: function (li, i) {
      var heart = SETTINGS[i][0] === 'heart';
      li.appendChild(icon(SETTINGS[i][0], heart ? 'rose' : ''));
      li.appendChild(span('name' + (heart ? ' dedication' : ''), SETTINGS[i][1]));
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
    ui.heroLive.className = 'live' + (ch && g.kind !== 'search' && ch.url.indexOf(SHORTCUT) !== 0 ? '' : ' hidden');
    if (g.kind === 'settings') {
      ui.heroLive.className = 'live hidden';
      ui.heroTile.textContent = '';
      var logo = document.createElement('img');
      logo.src = 'img/icon_130x130.png';
      ui.heroTile.appendChild(logo);
      ui.heroName.textContent = t('settings');
      ui.heroGroup.textContent = 'MommyTV ' + VERSION; // the licence has its own row
      ui.heroQ.textContent = '';
      return;
    }
    if (showingCountries(g)) {
      var c = g.countries[Math.min(cSel, g.countries.length - 1)];
      heroIcon('globe');
      ui.heroName.textContent = col === 'c' && c ? c.name : t('countries');
      ui.heroGroup.textContent = col === 'c' && c ? channelsText(c.items.length) + '  ·  ' + t('openHint') : t('nCountries', g.countries.length);
      ui.heroQ.textContent = '';
      return;
    }
    if (searching) {
      heroIcon('search');
      ui.heroGroup.textContent = g.items.length ? (g.items.length === 1 ? t('oneResult') : t('nResults', g.items.length)) : (g.query ? t('noResults') : t('typeHint'));
      ui.heroQ.textContent = '';
      return;
    }
    if (!ch) {
      if (g.kind === 'fav') heroIcon('fav'); else setTile(ui.heroTile, null);
      ui.heroName.textContent = g.kind === 'fav' ? t('noFavs') : g.name;
      ui.heroGroup.textContent = g.kind === 'fav' ? t('noFavsHint') : '';
      ui.heroQ.textContent = '';
      return;
    }
    setTile(ui.heroTile, ch);
    ui.heroName.textContent = ch.title;
    var where = g.kind === 'countries' ? g.country.name : (ch.cats ? ch.cats.split(';')[0] : ch.group || t('noGroup'));
    ui.heroGroup.textContent = (ch.url.indexOf(SHORTCUT) === 0 ? t('officialApp') : where) + (isPinned(ch) ? '  ·  ' + t('favourite') : '');
    ui.heroQ.textContent = ch.q;
  }

  function renderBrowser() {
    renderWindow(ui.groups, groups.length, gSel, col === 'g', RAIL_ROWS, railFill);
    var g = groups[gSel];
    renderWindow(ui.channels, listLength(g), cSel, col === 'c', LIST_ROWS, g.kind === 'settings' ? settingsFill : showingCountries(g) ? countryFill : listFill);
    renderHero();
  }

  function openSearch() {
    col = 's';
    renderBrowser();
    ui.search.focus();
  }

  function closeSearch(toResults) {
    ui.search.blur();
    col = toResults && searchGroup.items.length ? 'c' : 'g';
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
        gSel = (gSel + d + groups.length) % groups.length; // wraps: up from the top reaches Ajustes
        cSel = 0;
        if (groups[gSel].kind === 'fav') refreshFavourites();
      } else {
        cSel = Math.max(0, Math.min(listLength(g) - 1, cSel + d));
      }
    } else if (k === KEY.OK && col === 'g' && g.kind === 'search') {
      openSearch();
      return true;
    } else if (k === KEY.RIGHT || (k === KEY.OK && col === 'g')) {
      if (listLength(g)) col = 'c';
    } else if (k === KEY.LEFT) {
      col = 'g';
    } else if (k === KEY.OK && g.kind === 'settings') {
      if (cSel === ROW_CHANGE) {
        ui.url.value = store(STORE_URL) || ui.url.value;
        setupSel = 0;
        show('setup');
        return true;
      }
      if (cSel === ROW_DELETE && store(STORE_URL)) {
        if (Date.now() - deleteArmed > 5000) { deleteArmed = Date.now(); osd(t('deleteConfirm')); return true; }
        deleteArmed = 0;
        forgetList(true);
        channels = [];
        ui.url.value = '';
        setupSel = 0;
        show('setup');
        status(t('listDeleted'), false);
        return true;
      } // the other rows are information only
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
    } else if (k === KEY.YELLOW && col === 'c' && items.length && !showingCountries(g) && g.kind !== 'settings') {
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
    if (!window.webOS || !webOS.service) { osd(t('appsOnlyTv')); return; }
    webOS.service.request('luna://com.webos.applicationManager', {
      method: 'launch',
      parameters: { id: ch.url.slice(SHORTCUT.length) },
      onFailure: function (err) {
        osd(err.errorCode === -101 ? t('appMissing', ch.title) : t('appFail', ch.title, err.errorCode));
      }
    });
  }

  /* ---------- phone remote: a paired phone relaunches MommyTV through LG's own second-screen link ---------- */

  // Plays what a phone chose. A channel of this TV's list plays within "Todos", so CH+/CH- move on
  // from it; one from the phone's own list plays alone and leaves no trace (watch time, Favoritos,
  // last channel, search), and asks the PIN when parental control is on.
  function remotePlay(c) {
    if (!/^https?:\/\//.test(c.url || '') || !channels.length) return;
    var idx = indexByUrl()[c.url], items = null;
    for (var i = 0; idx !== undefined && i < groups.length; i++) {
      if (groups[i].kind === 'list' && groups[i].name === t('all') && groups[i].items.indexOf(idx) >= 0) items = groups[i].items;
    }
    if (!items) { idx = foreignChannel(c); items = [idx]; }
    play(items, items.indexOf(idx));
  }

  function foreignChannel(c) {
    for (var i = channels.length - 1; i >= 0 && channels[i].foreign; i--) if (channels[i].url === c.url) return i;
    var ch = { name: c.title || c.url, logo: c.logo || '', group: '', cert: '', country: '', countryName: '', langs: '', cats: '', nsfw: '', url: c.url, foreign: true };
    describe(ch);
    channels.push(ch);
    return channels.length - 1;
  }

  var pendingPlay = null; // a channel that arrived before its playlist was ready

  // Launch parameters from a paired phone: { mtvList } loads and remembers that playlist,
  // { mtvPlay, mtvTitle, mtvLogo } plays a channel; both together play it from that list.
  function phoneOrder(p) {
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return; } }
    if (!p || typeof p !== 'object') return;
    var c = /^https?:\/\//.test(p.mtvPlay || '') ? { url: p.mtvPlay, title: p.mtvTitle || '', logo: p.mtvLogo || '' } : null;
    if (/^https?:\/\//.test(p.mtvList || '')) {
      pendingPlay = c;
      rememberList = true;
      ui.url.value = p.mtvList;
      show('setup');
      load(p.mtvList, false);
      return;
    }
    if (c) { if (channels.length) remotePlay(c); else pendingPlay = c; }
  }

  document.addEventListener('webOSRelaunch', function (e) { phoneOrder(e.detail); });

  /* ---------- parental control ---------- */

  function isLocked(ch) {
    if (!parental.hash || unlocked) return false;
    if (ch.foreign) return true; // from a phone's list: its category is unknown here
    var cats = ch.cats ? ch.cats.split(';') : [ch.group || ''];
    for (var i = 0; i < cats.length; i++) if (parental.locked[cats[i]]) return true;
    return false;
  }

  function renderPin(msg) {
    ui.pinMsg.textContent = msg || t('pinPrompt');
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
    if (Date.now() < pinWaitUntil) { renderPin(t('pinWait')); return; }
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
    if (pinFails >= 5) { pinFails = 0; pinWaitUntil = Date.now() + 60000; renderPin(t('pinWait')); }
    else renderPin(t('pinWrong'));
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
    ui.bannerGroup.textContent = (ch.group || t('noGroup')) + (isPinned(ch) ? '  ·  Favorito' : '');
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
    if (!retry) { showBanner(); if (!ch.foreign) store(STORE_LAST, ch.url); }
  }

  // Many IPTV hiccups are momentary: reconnect quietly a few times before giving up.
  function reconnect() {
    if (retries >= RETRIES) return false;
    retries++;
    osd(t('reconnecting', current().title));
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
    if (current().foreign) return;
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
    osd(t('cantPlay', current().title), true);
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

  function renderDiag(d) {
    var line = function (label, value, bad) { return '<div' + (bad ? ' class="bad"' : '') + '>' + label + ' <b>' + value + '</b></div>'; };
    var esc = function (t) { var e = document.createElement('i'); e.textContent = t; return e.innerHTML; };
    ui.diag.innerHTML =
      line(esc(t('dChannel')), esc(d.channel || '')) +
      line(esc(t('dRes')), d.width ? d.width + '×' + d.height : '—', d.width && d.height < 720) +
      line(esc(t('dBuffer')), d.ahead.toFixed(1) + ' s', d.ahead < 3) +
      line(esc(t('dStart')), d.startupMs ? (d.startupMs / 1000).toFixed(1) + ' s' : esc(t('dLoading')), d.startupMs > 5000) +
      line(esc(t('dStalls')), d.stalls + (d.stallMs ? ' (' + (d.stallMs / 1000).toFixed(1) + ' s)' : ''), d.stalls > 0) +
      line(esc(t('dDropped')), esc(t('dOf', d.dropped, d.decoded)), d.decoded && d.dropped / d.decoded > 0.01) +
      '<div style="margin-top:10px;color:#94a3b8;font-size:20px">' + esc(t('dScreen') + ' · ' + t('dClose')) + '</div>';
  }

  setInterval(function () {
    if (!diagOn || view !== 'player') return;
    var d = sample();
    renderDiag(d);
  }, 2000);

  function toggleDiag() {
    diagOn = !diagOn;
    ui.diag.className = diagOn ? '' : 'hidden';
    if (diagOn) { renderDiag(sample()); osd(t('diagOn')); }
    else osd(t('diagOff'));
  }

  function playerKey(k) {
    if (k === KEY.BLUE) { toggleDiag(); return; }
    if ((k === KEY.UP || k === KEY.CH_UP) && playItems.length > 1) play(playItems, playIdx + 1);
    else if ((k === KEY.DOWN || k === KEY.CH_DOWN) && playItems.length > 1) play(playItems, playIdx - 1);
    else if (k === KEY.OK) showBanner();
    else if (k === KEY.YELLOW && !current().foreign) { togglePin(current()); showBanner(); }
    else if (k === KEY.BACK) {
      stop();
      if (groups[gSel].kind === 'fav') refreshFavourites();
      show('browser');
    }
  }

  /* ---------- keys ---------- */

  function setupKey(k, e) {
    if (k === KEY.UP || k === KEY.DOWN) {
      setupSel = Math.max(0, Math.min(2, setupSel + (k === KEY.UP ? -1 : 1)));
      renderSetup();
    } else if (k === KEY.OK && setupSel === 1) {
      rememberList = !rememberList;
      renderSetup();
    } else if (k === KEY.OK && setupSel === 2) {
      load(ui.url.value, false);
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
    if (view === 'player') return current().foreign ? null : current();
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

  I18N.apply(document);
  tick();
  setInterval(tick, 15000);
  if (window.webOS && webOS.deviceInfo) {
    webOS.deviceInfo(function (info) {
      if (info && info.screenWidth && info.screenHeight) screenSize = { w: info.screenWidth, h: info.screenHeight };
    });
  }

  try { localStorage.removeItem('mtvRemote'); } catch (e) { /* the old remote through a PC manager */ }
  var launch = (window.webOSSystem || window.PalmSystem || {}).launchParams;
  var saved = store(STORE_URL);
  if (saved) {
    ui.url.value = saved;
    setupSel = 2; // keep the on-screen keyboard closed while the saved list loads
    show('setup');
    load(saved, true);
  } else {
    show('setup');
  }
  if (launch && launch !== '{}') phoneOrder(launch); // opened by a phone
})();
