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

  // Some generators write the JavaScript value "undefined" rather than omitting group-title.
  // Keep it as an absent category so the UI can use its localized "No group" label.
  function cleanGroup(value) {
    var parts = String(value || '').split(';');
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part && part.toLowerCase() !== 'undefined') kept.push(part);
    }
    return kept.join(';');
  }

  function parse(text) {
    var lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
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
          group: cleanGroup(attr(line, 'group-title')), // may hold several categories: "Animation;Kids"
          country: attr(line, 'tvg-country'),
          langs: attr(line, 'tvg-language')
        };
      } else if (line.indexOf('#EXTGRP:') === 0) {
        group = cleanGroup(line.slice(8));
      } else if (line.charAt(0) !== '#') {
        var ch = info || { name: '', logo: '', group: '', country: '', langs: '' };
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

  var api = { parse: parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.M3U = api;
})(this);
