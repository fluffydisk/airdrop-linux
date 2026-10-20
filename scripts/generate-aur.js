#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const version = require('../package.json').version;
const input = path.resolve(process.argv[2] || 'release'), output = path.resolve(process.argv[3] || '.test-artifacts/aur');
const specs = ['x64', 'arm64'].map(arch => JSON.parse(fs.readFileSync(path.join(input, `airdrop-deb-${arch}.json`), 'utf8')));
if (specs.some(value => value.version !== version)) throw new Error('AUR metadata version mismatch');
const packages = Object.assign({}, ...specs.map(value => value.deb));
for (const cpu of ['x64', 'arm64']) if (!/^[a-f0-9]{64}$/.test(packages[cpu]?.sha256 || '')) throw new Error('Both verified DEB architectures are required');
fs.mkdirSync(output, { recursive: true });
const deps = ['alsa-lib', 'at-spi2-core', 'cairo', 'dbus', 'expat', 'glib2', 'glibc', 'gtk3', 'libcups', 'mesa', 'libx11', 'libxcb', 'libxcomposite', 'libxdamage', 'libxext', 'libxfixes', 'libxkbcommon', 'libxrandr', 'nspr', 'nss', 'pango', 'systemd-libs', 'python', 'python-dbus', 'python-gobject', 'polkit', 'xdg-utils'];
const text = `# Maintainer: fluffydisk <omerfarukbozkurt.2007@gmail.com>
pkgname=airdrop-linux-bin
pkgver=${version}
pkgrel=1
install=airdrop.install
pkgdesc='Private files and clipboard between your devices'
arch=('x86_64' 'aarch64')
url='https://github.com/fluffydisk/airdrop-linux'
license=('MIT')
depends=(${deps.map(x => `'${x}'`).join(' ')})
makedepends=('binutils')
optdepends=('tailscale: private network connection, also installable in the setup wizard')
provides=('airdrop-linux' 'airdrop-system-bridge')
conflicts=('airdrop-linux' 'airdrop-system-bridge')
source_x86_64=('https://github.com/fluffydisk/airdrop-linux/releases/download/v${version}/${packages.x64.name}')
source_aarch64=('https://github.com/fluffydisk/airdrop-linux/releases/download/v${version}/${packages.arm64.name}')
sha256sums_x86_64=('${packages.x64.sha256}')
sha256sums_aarch64=('${packages.arm64.sha256}')
noextract=('${packages.x64.name}' '${packages.arm64.name}')
package() {
  local debarch=amd64
  [[ "$CARCH" != aarch64 ]] || debarch=arm64
  ar p "$srcdir/airdrop-linux_\${pkgver}_\${debarch}.deb" data.tar.gz | bsdtar -xf - -C "$pkgdir"
  mkdir -p "$pkgdir/usr/lib/systemd/system"
  mv "$pkgdir/lib/systemd/system/airdrop-system-bridge.service" "$pkgdir/usr/lib/systemd/system/"
  rmdir "$pkgdir/lib/systemd/system" "$pkgdir/lib/systemd" "$pkgdir/lib"
  printf '%s\\n' '{"schema":1,"channel":"arch"}' > "$pkgdir/opt/airdrop/install-source.json"
  install -Dm644 "$pkgdir/opt/airdrop/licenses/Airdrop-LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
`;
fs.writeFileSync(path.join(output, 'PKGBUILD'), text);
fs.writeFileSync(path.join(output, 'airdrop.install'), 'pre_upgrade() { /opt/airdrop/server/scripts/package-lifecycle.sh upgrade; }\npre_remove() { /opt/airdrop/server/scripts/package-lifecycle.sh remove; }\npost_upgrade() { /opt/airdrop/server/scripts/resume-user-sessions.sh; }\npost_install() { systemctl daemon-reload; }\npost_remove() { systemctl daemon-reload; }\n');
const info = ['pkgbase = airdrop-linux-bin', `\tpkgdesc = Private files and clipboard between your devices`, `\tpkgver = ${version}`, '\tpkgrel = 1', '\tinstall = airdrop.install', '\turl = https://github.com/fluffydisk/airdrop-linux', '\tarch = x86_64', '\tarch = aarch64', '\tlicense = MIT', '\tmakedepends = binutils', ...deps.map(x => '\tdepends = ' + x), '\toptdepends = tailscale: private network connection, also installable in the setup wizard', '\tprovides = airdrop-linux', '\tprovides = airdrop-system-bridge', '\tconflicts = airdrop-linux', '\tconflicts = airdrop-system-bridge', ...['x64', 'arm64'].flatMap(cpu => { const arch = cpu === 'x64' ? 'x86_64' : 'aarch64'; return [`\tsource_${arch} = https://github.com/fluffydisk/airdrop-linux/releases/download/v${version}/${packages[cpu].name}`, `\tsha256sums_${arch} = ${packages[cpu].sha256}`]; }), ...['x64', 'arm64'].map(cpu => '\tnoextract = ' + packages[cpu].name), '', 'pkgname = airdrop-linux-bin', ''];
fs.writeFileSync(path.join(output, '.SRCINFO'), info.join('\n'));
console.log('Prepared AUR recipe and metadata. No AUR submission performed.');
