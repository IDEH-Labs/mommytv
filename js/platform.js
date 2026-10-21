/* What differs between LG webOS and Samsung Tizen TVs; the rest of MommyTV is shared. ES5 only. */
(function (root) {
  'use strict';

  var tizen = !!root.tizen; // only Samsung's runtime has it (webOSTV.js defines webOS everywhere)

  var webosPlatform = {
    name: 'webos',
    keys: { BACK: 461, CH_UP: 33, CH_DOWN: 34 },
    shortcut: 'webos-app://', // playlist entry that opens an installed app instead of a stream
    // mediaOption: start HLS at the top quality instead of ramping up (the player still steps down if
    // the network can't keep up) and allow up to the panel's own resolution.
    hlsType: function (screen) {
      return 'application/vnd.apple.mpegurl;mediaOption=' + encodeURI(JSON.stringify({
        mediaTransportType: 'HLS',
        option: { adaptiveStreaming: { bps: { start: 50000000 }, maxWidth: screen.w, maxHeight: screen.h } }
      }));
    },
    // fail(code): -101 means the app is not installed
    launchApp: function (id, fail) {
      if (!root.webOS || !root.webOS.service) { fail(null); return; }
      root.webOS.service.request('luna://com.webos.applicationManager', {
        method: 'launch',
        parameters: { id: id },
        onFailure: function (err) { fail(err.errorCode === -101 ? 'missing' : err.errorCode); }
      });
    },
    screenSize: function (done) {
      if (root.webOS && root.webOS.deviceInfo) {
        root.webOS.deviceInfo(function (info) {
          if (info && info.screenWidth && info.screenHeight) done({ w: info.screenWidth, h: info.screenHeight });
        });
      }
    },
    // A paired phone opens MommyTV through LG's second-screen link with these parameters.
    launchParams: function () { return (root.webOSSystem || root.PalmSystem || {}).launchParams; },
    onRelaunch: function (handle) { root.document.addEventListener('webOSRelaunch', function (e) { handle(e.detail); }); },
    init: function () {}
  };

  var tizenPlatform = {
    name: 'tizen',
    keys: { BACK: 10009, CH_UP: 427, CH_DOWN: 428 },
    shortcut: 'tizen-app://',
    hlsType: function () { return 'application/vnd.apple.mpegurl'; },
    launchApp: function (id, fail) {
      try {
        root.tizen.application.launch(id, null, function (err) { fail(err && err.name === 'NotFoundError' ? 'missing' : (err && err.name) || null); });
      } catch (e) { fail(e && e.name); }
    },
    screenSize: function (done) {
      var s = root.screen;
      if (s && s.width && s.height) done({ w: s.width, h: s.height });
    },
    launchParams: function () { return null; }, // no phone pairing on Samsung yet
    onRelaunch: function () {},
    // Arrows, OK and Back reach the app by themselves; numbers, CH+/CH- and the colour keys must be asked for.
    // Exit is never registered: Samsung requires it to return to Home.
    init: function () {
      var keys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'ChannelUp', 'ChannelDown', 'ColorF2Yellow', 'ColorF3Blue'];
      try {
        if (root.tizen.tvinputdevice.registerKeyBatch) root.tizen.tvinputdevice.registerKeyBatch(keys);
        else for (var i = 0; i < keys.length; i++) root.tizen.tvinputdevice.registerKey(keys[i]);
      } catch (e) { /* a missing key on an older remote must not stop the app */ }
    }
  };

  var platform = tizen ? tizenPlatform : webosPlatform;
  // Any "name-app://" entry: shortcuts meant for another system are left out of this TV's list.
  platform.isShortcut = function (url) { return /^[a-z]+-app:\/\//.test(url); };
  root.PLATFORM = platform;
})(this);
