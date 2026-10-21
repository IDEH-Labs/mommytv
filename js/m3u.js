/* M3U / M3U8 playlist parser. ES5 only: webOS TV 4.x runs Chromium 53. */
(function (root) {
  'use strict';

  function attr(line, name) {
    var m = new RegExp('\\s' + name + '="([^"]*)"', 'i').exec(line);
    return m ? m[1].trim() : '';
  }

  // The title follows the first comma outside quoted attribute values.
  function titleOf(line) {
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) return line.slice(i + 1).trim();
    }
    return '';
  }

  function parse(text) {
    var lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    var channels = [];
    var info = null;
    var group = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.indexOf('#EXTINF') === 0) {
        info = {
          name: titleOf(line) || attr(line, 'tvg-name'),
          logo: attr(line, 'tvg-logo'),
          group: attr(line, 'group-title'),
          cert: attr(line, 'mommytv-cert'), // "letsencrypt": hidden on TVs that reject that CA
          // added by MommyTV Manager from the public iptv-org data
          country: attr(line, 'tvg-country'),
          countryName: attr(line, 'mommytv-country-es'),
          langs: attr(line, 'tvg-language'),
          cats: attr(line, 'mommytv-cats'),
          nsfw: attr(line, 'mommytv-nsfw')
        };
      } else if (line.indexOf('#EXTGRP:') === 0) {
        group = line.slice(8).trim();
      } else if (line.charAt(0) !== '#') {
        var ch = info || { name: '', logo: '', group: '', cert: '', country: '', countryName: '', langs: '', cats: '', nsfw: '' };
        ch.url = line;
        if (!ch.name) ch.name = line;
        if (!ch.group) ch.group = group;
        channels.push(ch);
        info = null;
        group = '';
      }
    }
    return channels;
  }

  // Attributes of the "#EXTM3U ..." line, e.g. the parental control sent by MommyTV Manager.
  function header(text) {
    var first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
    if (first.indexOf('#EXTM3U') !== 0) return { pin: '', locked: '' };
    return { pin: attr(first, 'mommytv-pin'), locked: attr(first, 'mommytv-locked') };
  }

  var api = { parse: parse, header: header };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.M3U = api;
})(this);
