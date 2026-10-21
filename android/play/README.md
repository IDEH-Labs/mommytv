# Google Play release

Everything the Play Console asks for MommyTV, kept with the code so each answer can be checked
against it. Phone and tablet only for now: Android TV is enabled once the app has been tested on a
real Android TV / Google TV device.

## Package and signing

- Package `org.jpi59.mommytv`, Android App Bundle, Play App Signing.
- Upload key: created once with `mommytv-clave-nueva` (random password, kept only encrypted with the
  owner's GPG key; a GPG-encrypted copy of the keystore must be stored outside this computer).
- Signed build: `mommytv-compilar-firmado` (asks for the GPG passphrase every time) →
  `android/app/build/outputs/bundle/release/app-release.aab`.
- Before every upload, install the R8 (release) build on a phone and check: start on "Open", search,
  favourites, parental PIN, adult lock, saved copy offline, sending a channel to the TV.

## Store listing

- Texts: `listing/<language>/title.txt`, `short_description.txt`, `full_description.txt`
  (en-US default, es-419).
- Graphics: `icon-512.png`, `listing/<language>/feature-graphic.png` (`node tools/play-graphics.js`).
- Screenshots: phone, taken with the demo playlist below only. Never real channels, logos or
  playlists: Google's intellectual-property policy treats them as encouraging infringement.
- Category: Video Players & Editors. Contact: support@ideh.top. Website: https://ideh.top/mommytv
- Privacy policy: https://ideh.top/mommytv-privacy

## App content

| Form | Answer | Why |
|---|---|---|
| Privacy policy | https://ideh.top/mommytv-privacy | |
| Ads | No ads | |
| App access | All functionality is available without special access; give reviewers the demo playlist | No accounts; the app is empty until a playlist is added |
| Data safety: collected | No data collected | Nothing is sent to IDEH; no analytics, crash reporting or SDKs that collect data |
| Data safety: shared | No data shared | The playlist, logo and stream servers are chosen by the user, not by the app |
| Data deletion | Not applicable (nothing collected); on-device data: "Delete playlist" or uninstall | |
| Target audience | 18 and over | Streams come from playlists the user chooses and are not moderated by the app |
| Content rating | Answer that the app plays media from sources the user adds and does not filter them; no violence, sex, gambling or user-to-user communication in the app itself | Honest description of an unmoderated player |
| News app | No | |
| Government app | No | |
| Financial features | None | |
| Health | None | |

## Instructions for reviewers (App access)

```
MommyTV is a player only and ships no channels. To try it:
1. Open the app, paste https://ideh.top/mommytv-demo.m3u and tap "Open".
2. The demo playlist holds only public test streams: Blender Foundation films (CC BY 3.0)
   and Apple's HLS test streams.
No account or login is needed.
```

## Release notes 0.1.3

- en-US: First release. Your own M3U playlists with search, favourites, country and category groups,
  parental PIN, and an encrypted link to control an LG TV from your phone. No accounts, no tracking.
- es-419: Primera versión. Tus propias listas M3U con búsqueda, favoritos, grupos por país y categoría,
  PIN parental y una conexión cifrada para controlar una TV LG desde tu teléfono. Sin cuentas ni rastreo.
