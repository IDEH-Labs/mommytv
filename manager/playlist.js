'use strict';
// Builds the single playlist the TV reads from the enabled lists and shortcuts.

const APP_ID = /^[a-z0-9][a-z0-9.-]+$/;
const ANDROID_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
// Each shortcut opens the official app of the system asking for the list: webOS or Android.
const SYSTEMS = {
  webos: { key: 'appId', valid: APP_ID, scheme: 'webos-app://' },
  android: { key: 'androidId', valid: ANDROID_ID, scheme: 'android-app://' },
};

const clean = (s) => String(s).replace(/["\r\n]/g, '').trim();

// Channels without group-title get the name of the list they come from.
function withGroup(text, group) {
  const out = [];
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF') && !/\sgroup-title="/i.test(line)) {
      out.push(line.replace(/^#EXTINF:\s*(-?[\d.]+)?/, (m) => m + ' group-title="' + clean(group) + '"'));
    } else {
      out.push(line);
    }
  }
  return out;
}

function build(shortcuts, lists, os) {
  const sys = SYSTEMS[os] || SYSTEMS.webos;
  const out = ['#EXTM3U'];
  for (const s of shortcuts) {
    const id = s[sys.key];
    if (!id || !sys.valid.test(id)) continue;
    out.push('#EXTINF:-1' + (s.logo ? ' tvg-logo="' + clean(s.logo) + '"' : '') + ',' + clean(s.name));
    out.push(sys.scheme + id);
  }
  for (const l of lists) out.push(...withGroup(l.text, l.name));
  return out.join('\n') + '\n';
}

module.exports = { build, withGroup, APP_ID, ANDROID_ID };
