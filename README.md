# MommyTV

A minimal M3U / M3U8 playlist player for LG webOS TVs, built first for the
LG 43LM6300 (webOS TV 4.5, Chromium 53 web engine). MommyTV is only a player:
it ships no channels or playlists. Use playlists you are entitled to watch.

## Features

- Playlists managed from a PC or phone with MommyTV Manager; the TV finds it on the LAN.
- Groups by country (the TV's own first), Spanish-language channels, all countries and
  categories, from the public iptv-org data. Adult channels are never shown.
- Search, Favoritos (pinned plus most watched, all stored on the TV only) and resume on the
  last channel.
- Parental control: categories locked behind a 4-digit PIN set in the manager.
- HLS starts at top quality and allows the panel's own resolution; freeze watchdog,
  automatic reconnect and live-edge catch-up.
- Shortcuts that open installed official apps.
- Nightly check in the manager hides dead channels (index request only, never video).
- Opt-in diagnostics (blue key), saved only on the user's PC.
- No accounts, no analytics.

## Remote control

| Screen | Key | Action |
|---|---|---|
| List | Up / Down | Move |
| List | Right / OK on a group | Open the group |
| List | OK on a channel | Play |
| List / Player | Hold OK (or yellow key) | Add to / remove from Favoritos |
| Player | Blue key | Diagnostics panel |
| List | OK on "Cambiar lista" | Change the playlist URL |
| List | Back | Groups column, then exit |
| Player | Up / Down, CH+ / CH− | Next / previous channel |
| Player | OK | Show the channel name |
| Player | Back | Return to the list |

## Shortcuts to official apps

A playlist entry whose URL is `webos-app://<app id>` is shown under
"Accesos directos" and opens that installed webOS app with the official
Application Manager `launch` API (ACG group `application.launcher`).
The TV does not let apps list other installed apps, so the app id must be
known; with the app open on the TV, `ares-launch --device tv --running`
shows it.

```
#EXTINF:-1 tvg-logo="https://example.org/logo.png",Official app
webos-app://com.example.officialapp
```

## Build and install

Requires the [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)
and the Developer Mode app on the TV.

```sh
npm install -g --prefix ~/.local @webos-tools/cli
./build.sh                      # runs the tests, then packages dist/*.ipk
node manager/server.js          # or ~/.local/bin/mommytv-manager, which restarts it
ares-setup-device --add tv -i "host=<TV IP>" -i "port=9922" -i "username=prisoner"
ares-novacom --device tv --getkey
ares-install --device tv dist/org.jpi59.mommytv_0.1.0_all.ipk
ares-launch --device tv org.jpi59.mommytv
```

Code is plain ES5 because webOS TV 4.x runs Chromium 53.

## Third-party code

`js/webOSTV.js` is LG's webOSTV.js 1.2.13, downloaded from
webostv.developer.lge.com, under the Apache License 2.0
(`licenses/webOSTV.js-LICENSE-2.0.txt`).
