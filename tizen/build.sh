#!/bin/sh
# Builds the Samsung Tizen TV app from the same web files as the LG one (js/platform.js picks the system).
# Signing needs Samsung's Tizen CLI and a certificate profile made with the owner's Samsung account:
#   ./tizen/build.sh <certificate profile>   →  dist/tizen/MommyTV.wgt
# Without a profile it only prepares dist/tizen/app (for a check, not installable).
set -eu
cd "$(dirname "$0")/.."
node test/m3u.test.js
node test/sha256.test.js
node test/i18n.test.js
rm -rf dist/tizen
mkdir -p dist/tizen/app
cp -r index.html css js img fonts licenses LICENSE NOTICE.md dist/tizen/app/
rm dist/tizen/app/js/webOSTV.js
sed -i '/js\/webOSTV.js/d' dist/tizen/app/index.html
cp tizen/config.xml dist/tizen/app/
rsvg-convert -w 512 -h 512 img/icon.svg -o dist/tizen/app/icon.png
if [ $# -ge 1 ]; then
  tizen package -t wgt -s "$1" -- dist/tizen/app
  mv dist/tizen/app/*.wgt dist/tizen/MommyTV.wgt
  ls dist/tizen/MommyTV.wgt
else
  echo "dist/tizen/app ready; to sign: ./tizen/build.sh <certificate profile>"
fi
