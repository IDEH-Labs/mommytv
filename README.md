# MommyTV

*Dedicated to Mami Analida.*

A minimal M3U / M3U8 playlist player for LG webOS TVs, built first for the
LG 43LM6300 (webOS TV 4.5, Chromium 53 web engine). MommyTV is only a player:
it ships no channels or playlists. Use playlists you are entitled to watch.

## Features

- Playlists managed from a PC or phone with MommyTV Manager; the TV finds it on the LAN and
  uses it only after you press Load.
- Groups by country (the TV's own first), Spanish-language channels, all countries and
  categories, from the public iptv-org data. Adult channels are never shown.
- Search, Favoritos (only the channels you mark, stored on the device only); the last channel
  watched is selected on start, and nothing plays until you choose.
- Parental control: categories locked behind a 4-digit PIN set in the manager.
- HLS starts at top quality and allows the panel's own resolution; freeze watchdog,
  automatic reconnect and live-edge catch-up.
- Shortcuts that open installed official apps.
- Nightly check in the manager hides dead channels (index request only, never video).
- Opt-in diagnostics (blue key), saved only on the user's PC.
- Interface in the language chosen in the TV settings: Spanish, English, French, German,
  Italian, Portuguese, Chinese or Japanese (English otherwise).
- No accounts, no analytics.

## Remote control

| Screen | Key | Action |
|---|---|---|
| List | Up / Down | Move |
| List | Right / OK on a group | Open the group |
| List | OK on a channel | Play |
| List / Player | Hold OK (or yellow key) | Add to / remove from Favoritos |
| Player | Blue key | Diagnostics panel |
| List | Ajustes → OK on "Cambiar lista" | Change the playlist URL |
| List | Back | Groups column, then exit |
| Player | Up / Down, CH+ / CH− | Next / previous channel |
| Player | OK | Show the channel name |
| Player | Back | Return to the list |

## Phone remote

The Android app on a phone can follow the TV through MommyTV Manager:

1. On the TV: Ajustes (Settings) → "Controlar con el teléfono" shows a 6-digit code (one use, 5 minutes).
2. On the phone: the gear button → "Controlar la TV", type the code.

The phone then shows what the TV is playing, and a TV button next to search chooses where a
tapped channel plays: on the TV (default once paired) or on the phone. The TV keeps one
long-poll request open to the manager. A channel of the TV's own list plays within its list
(locked categories ask for the PIN on the TV); one from another list on the phone plays on
its own, leaves no trace on the TV (watch time, Favoritos, last channel) and asks for the PIN
whenever parental control is on, since its category is unknown there. Orders not picked up
within 30 seconds are dropped, and a restarted TV never replays old ones. The TV reports what
became of each order (received, playing, PIN, failed) and the phone tells the user; if the
TV does not have MommyTV open, the phone says so. A phone remembers the manager it paired
through, and looks for it on the LAN when it uses a playlist from elsewhere. The TV plays on its own: the phone can be closed, used for calls or
other apps, or switched off. Only hashes of the TV secret and the
phone tokens are stored; after 10 wrong codes in 10 minutes pairing is locked for 10 minutes.
Paired phones can be removed in the manager's panel.

## HTTPS at home

With a certificate for a host name that points to the PC (for example a DNS `A` record
`tv.example.org → 192.168.1.9` and a Let's Encrypt certificate obtained with a DNS
challenge, so nothing is opened to the internet), create `~/.config/mommytv/tls.json`:

```json
{ "name": "tv.example.org", "cert": "/path/fullchain.cer", "key": "/path/tv.example.org.key" }
```

The manager then serves everything over HTTPS on port 8643 and reloads the certificate
daily, so renewals need no restart. Port 8642 stays plain HTTP only for discovery: it
answers `mommytv.json` with the secure address and redirects every other request. The TV
and Android apps follow that redirect and keep the HTTPS address. webOS 4.5 accepts Let's
Encrypt certificates (chain to ISRG Root X1). The PC needs a fixed address on the LAN
(a DHCP reservation in the router) so the name keeps pointing to it.

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

The Android app uses `android-app://<package>` the same way. In the manager each
shortcut can have a webOS app id, an Android package or both; the TV asks for
`playlist.m3u` and the Android app for `playlist.m3u?os=android`, and each gets
only the shortcuts for its own system.

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
