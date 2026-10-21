# Notice and Provenance — MommyTV

*MommyTV is dedicated to Mami Analida.*

## Project Identity
- **Application Name:** MommyTV
- **Application ID:** `org.jpi59.mommytv`
- **Maintainer:** jpi59 (IDEH Labs, Fundación IDEH)
- **License:** GNU General Public License, version 3 or any later version (GPL-3.0-or-later)

## What MommyTV Is
MommyTV is a player for M3U playlists on LG webOS TVs and Android devices. Each device keeps the
playlist its user chooses locally. MommyTV ships no channels, streams or playlists.

## Third-Party Components
| Component | Version | License | File |
|---|---|---|---|
| webOSTV.js (LG Electronics) | 1.2.13 | Apache-2.0 | `js/webOSTV.js`, `licenses/webOSTV.js-LICENSE-2.0.txt` |
| Plus Jakarta Sans (Tokotype) | Google Fonts v12 | SIL OFL 1.1 | `fonts/`, `licenses/PlusJakartaSans-OFL.txt` |
| Country names (Unicode CLDR) | 47.0 | Unicode License v3 | `js/countries.js`, `licenses/CLDR-LICENSE.txt` |

## Playlist Metadata
- Country, language and category information is read from standard M3U attributes supplied in the
  user's own playlist (`tvg-country`, `tvg-language`, and `group-title`). Without `tvg-country`, the
  country is read from the ISO 3166-1 code that ends an iptv-org channel id (`tvg-id`). No data is
  downloaded for this.

## Original Assets
The app icon (`img/icon.svg` and its PNG exports) and the user interface are original designs
created for MommyTV.
