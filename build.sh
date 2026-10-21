#!/bin/sh
# Tests, then packages only the app files into dist/.
set -eu
cd "$(dirname "$0")"
node test/m3u.test.js
node test/playlist.test.js
node test/meta.test.js
node test/health.test.js
node test/sha256.test.js
rm -rf dist
mkdir -p dist/app
cp -r appinfo.json index.html css js img fonts licenses dist/app/
ares-package -o dist dist/app
rm -rf dist/app
ls dist/*.ipk
