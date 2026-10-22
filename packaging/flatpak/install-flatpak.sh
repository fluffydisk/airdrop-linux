#!/usr/bin/env bash
# Application assembly runs inside flatpak-builder's network-disabled sandbox.
set -euo pipefail
umask 022
python3 -c 'import socket; assert [n for _,n in socket.if_nameindex()] == ["lo"], "Build must be offline"'
app=/app/lib/airdrop-linux
mkdir -p "$app/server/scripts" "$app/server/ui" "$app/desktop"
cp -a push-server.js package.json package-lock.json lib bin "$app/server/"
cp scripts/{managed-runtime,migrate-layout,register-install}.js "$app/server/scripts/"
cp ui/zip.js "$app/server/ui/"
cp -a ui "$app/"
cp -a electron-runtime/. "$app/desktop/"
mv "$app/desktop/electron" "$app/desktop/Airdrop"
# Zypak supplies the sandbox integration; the upstream SUID helper is unused.
rm -f "$app/desktop/chrome-sandbox" "$app/desktop/resources/default_app.asar"
desktop="$app/desktop/resources/app"
mkdir -p "$desktop"
node scripts/prepare-desktop.js
cp -a desktop/. "$desktop/"
for component in "$app/server" "$desktop" "$PWD/build-tools"; do
  npm ci --prefix "$component" --offline --omit=dev --ignore-scripts --no-audit --no-fund --registry=http://127.0.0.1:9
done
# JSZip's browser asset is regenerated from its JS sources, not dist/.
NODE_PATH="$PWD/build-tools/node_modules" node - "$app" <<'JS'
const fs=require('node:fs'),path=require('node:path');
const base=process.argv[2];
const entry=path.join(base,'server/node_modules/jszip/lib/index.js');
const bundle=require('browserify')(entry,{standalone:'JSZip',browserField:'__airdrop_source__'});
bundle.on('error',error=>{console.error(error);process.exitCode=1;});
bundle.bundle().pipe(fs.createWriteStream(path.join(base,'ui/vendor/jszip.min.js')));
JS
# Bare-runtime optional addons are not used by Node/Electron. Keep the JS fallback.
find "$app/server/node_modules" "$desktop/node_modules" -type d \( -name prebuilds -o -name .bin \) -prune -exec rm -rf '{}' +
node - "$app" <<'JS'
const fs=require('node:fs'),path=require('node:path');
const base=process.argv[2],version=require(path.join(base,'server/package.json')).version;
fs.writeFileSync(path.join(base,'distribution.json'),JSON.stringify({source:'flatpak',version,arch:process.arch}));
for(const name of Object.keys(require(path.join(base,'server/package.json')).dependencies))require(path.join(base,'server/node_modules',name));
require(path.join(base,'desktop/resources/app/core/lib/explorer'));
JS
cc -Wall -Wextra -Werror packaging/flatpak/background-portal.c -o /app/bin/airdrop-background-portal $(pkg-config --cflags --libs gio-2.0)
install -Dm644 io.github.fluffydisk.airdrop-linux.desktop /app/share/applications/$FLATPAK_ID.desktop
install -Dm644 io.github.fluffydisk.airdrop-linux.metainfo.xml /app/share/metainfo/$FLATPAK_ID.metainfo.xml
install -Dm644 ui/icon-512.png /app/share/icons/hicolor/512x512/apps/$FLATPAK_ID.png
install -Dm644 LICENSE /app/share/licenses/$FLATPAK_ID/LICENSE
install -Dm644 electron-runtime/LICENSE /app/share/licenses/$FLATPAK_ID/electron/LICENSE
install -Dm644 electron-runtime/LICENSES.chromium.html /app/share/licenses/$FLATPAK_ID/electron/LICENSES.chromium.html
# Preserve licenses for Browserify's generated runtime and bundled shims too.
find build-tools/node_modules -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' \) -exec cp --parents '{}' /app/share/licenses/$FLATPAK_ID/ \;
cat > /app/bin/airdrop-desktop <<'SH'
#!/bin/sh
export GTK_USE_PORTAL=1
exec /app/lib/airdrop-linux/runtime/node /app/lib/airdrop-linux/server/scripts/managed-runtime.js desktop "$@"
SH
chmod 755 /app/bin/airdrop-desktop
