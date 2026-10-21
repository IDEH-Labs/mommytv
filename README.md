# MommyTV

*Dedicated to Mami Analida.*

A minimal M3U / M3U8 playlist player for LG webOS TVs, built first for the
LG 43LM6300 (webOS TV 4.5, Chromium 53 web engine). MommyTV is only a player:
it ships no channels or playlists. Use playlists you are entitled to watch.

## Features

- Add a playlist URL directly on the TV or Android device. Choosing **Remember this playlist**
  saves its URL and a local copy; the copy can start when the site is temporarily unavailable.
- Search, favourites (only channels explicitly marked by the user), the last selected channel,
  and parental settings remain on that device only.
- Groups by country, device language, all channels, and categories from standard M3U attributes
  in the selected playlist (`tvg-country`, `tvg-language`, and `group-title`). When a channel has
  no `tvg-country`, its country is taken from an iptv-org style `tvg-id` (`Name.co@SD` → Colombia).
  Country names and iptv-org categories are shown in the interface language; everything is worked
  out on the device, with no online service.
- Per-device parental control: a four-digit PIN is salted and hashed locally; it can lock chosen
  categories and is required before changing or deleting a saved playlist.
- Android can pair directly with a compatible LG TV on the local network, play a selected channel
  there, and send the playlist URL. No PC service sits between the phone and TV.
- HLS starts at top quality and allows the panel's own resolution; freeze watchdog, automatic
  reconnect and live-edge catch-up are available on webOS.
- Playlist shortcuts can open installed official apps.
- Interface in the language chosen in the device settings: Spanish, English, French, German,
  Italian, Portuguese, Chinese or Japanese (English otherwise).
- No accounts and no analytics. MommyTV ships no channels or playlists.

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

## Phone and TV

On Android, open **Settings → Control the TV**, find the LG TV on the local network and accept
the pairing request shown by the TV. The phone can then choose whether a tapped channel plays on
the phone or the TV, and can send its saved playlist URL to the TV. The TV receives that URL only
through LG's local pairing mechanism; it keeps its own playlist copy and its own parental PIN.

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

The Android app uses `android-app://<package>` and Samsung TVs `tizen-app://<app id>` the same
way. A playlist may contain shortcuts for every platform; each device shows only its own.

## Build and install

Requires the [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)
and the Developer Mode app on the TV.

```sh
npm install -g --prefix ~/.local @webos-tools/cli
./build.sh                      # runs the tests, then packages dist/*.ipk
ares-setup-device --add tv -i "host=<TV IP>" -i "port=9922" -i "username=prisoner"
ares-novacom --device tv --getkey
ares-install --device tv dist/org.jpi59.mommytv_0.1.3_all.ipk
ares-launch --device tv org.jpi59.mommytv
```

For Android, set the four signing variables (`KEYSTORE_PATH`, `KEY_ALIAS`, `STORE_PASSWORD`, and
`KEY_PASSWORD`) only in the release environment, then run `./gradlew assembleRelease`. The
repository contains no signing key or password. Before distributing a release, install it on a
real TV and phone and manually verify playlist recovery, favourites, parental control, deleting a
playlist, and phone-to-TV playlist transfer.

Code is plain ES5 because webOS TV 4.x runs Chromium 53.

## Samsung Tizen TVs (preview)

The same web app runs on Samsung TVs from 2017 on (Tizen 3.0+); `js/platform.js` holds the few
differences (keys, shortcuts, HLS options). It starts without errors in a simulated Tizen
environment but **has not been tested on a Samsung TV yet**. Signing needs Samsung's Tizen CLI and
a certificate made with the owner's Samsung account, including the TV's DUID:

```sh
./tizen/build.sh <certificate profile>   # tests, then dist/tizen/MommyTV.wgt
tizen install -n dist/tizen/MommyTV.wgt -t <TV>
```

## Third-party code

`js/webOSTV.js` is LG's webOSTV.js 1.2.13, downloaded from
webostv.developer.lge.com, under the Apache License 2.0
(`licenses/webOSTV.js-LICENSE-2.0.txt`).
