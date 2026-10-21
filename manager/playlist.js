'use strict';
// Builds the single playlist the TV reads from the enabled lists and shortcuts.

const SHORTCUT = 'webos-app://';
const APP_ID = /^[a-z0-9][a-z0-9.-]+$/;

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

function build(shortcuts, lists) {
  const out = ['#EXTM3U'];
  for (const s of shortcuts) {
    if (!APP_ID.test(s.appId)) continue;
    out.push('#EXTINF:-1' + (s.logo ? ' tvg-logo="' + clean(s.logo) + '"' : '') + ',' + clean(s.name));
    out.push(SHORTCUT + s.appId);
  }
  for (const l of lists) out.push(...withGroup(l.text, l.name));
  return out.join('\n') + '\n';
}

module.exports = { build, withGroup, APP_ID };
