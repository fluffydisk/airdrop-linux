#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { prepareNative } = require('./build-native');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const arch = process.arch === 'x64' ? 'amd64' : process.arch;
const dependencies = 'libc6 (>= 2.35), libasound2 | libasound2t64, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libatk1.0-0 | libatk1.0-0t64, libcairo2, libcups2 | libcups2t64, libdbus-1-3, libexpat1, libgbm1, libglib2.0-0 | libglib2.0-0t64, libgtk-3-0 | libgtk-3-0t64, libnspr4, libnss3, libpango-1.0-0, libudev1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, python3, python3-dbus, python3-gi, dbus, systemd, policykit-1 | polkitd, xdg-utils, ca-certificates, gnupg, apt';
async function put(base, name, content, mode = 0o644) { const file = path.join(base, name); await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, content, { mode }); }
async function bridgeFiles(stage) {
  await fsp.cp(path.join(root, 'system'), path.join(stage, 'opt/airdrop/system'), { recursive: true, filter: name => !name.includes('__pycache__') });
  for (const [source, destination] of [
    ['io.github.fluffydisk.Airdrop.System.conf', 'usr/share/dbus-1/system.d/io.github.fluffydisk.Airdrop.System.conf'],
    ['io.github.fluffydisk.Airdrop.System.service', 'usr/share/dbus-1/system-services/io.github.fluffydisk.Airdrop.System.service'],
    ['io.github.fluffydisk.airdrop.policy', 'usr/share/polkit-1/actions/io.github.fluffydisk.airdrop.policy'],
    ['airdrop-system-bridge.service', 'lib/systemd/system/airdrop-system-bridge.service']
  ]) await put(stage, destination, await fsp.readFile(path.join(root, 'packaging/debian', source)));
}
async function archive(stage, name, control, out) {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'airdrop-deb-'));
  try {
    await fsp.mkdir(path.join(work, 'control')); await put(work, 'control/control', control);
    for (const script of ['postinst', 'prerm', 'postrm']) await put(work, 'control/' + script, await fsp.readFile(path.join(root, 'packaging/debian', script)), 0o755);
    execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', path.join(work, 'control.tar.gz'), '-C', path.join(work, 'control'), '.']);
    execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', path.join(work, 'data.tar.gz'), '-C', stage, '.']);
    await fsp.writeFile(path.join(work, 'debian-binary'), '2.0\n');
    execFileSync('ar', ['rcD', path.join(out, name), 'debian-binary', 'control.tar.gz', 'data.tar.gz'], { cwd: work });
    const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(path.join(out, name))) hash.update(chunk);
    return { name, size: (await fsp.stat(path.join(out, name))).size, sha256: hash.digest('hex') };
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}
async function main() {
  if (!['amd64', 'arm64'].includes(arch)) throw new Error('Unsupported DEB architecture');
  const out = path.join(root, 'release'); await fsp.mkdir(out, { recursive: true });
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'airdrop-deb-stage-'));
  try {
    const stage = path.join(work, 'full'); const app = path.join(stage, 'opt/airdrop'); await fsp.mkdir(app, { recursive: true });
    if (process.env.AIRDROP_NATIVE_STAGE) await fsp.cp(process.env.AIRDROP_NATIVE_STAGE, app, { recursive: true });
    else await prepareNative(app);
    await put(stage, 'opt/airdrop/install-source.json', JSON.stringify({ schema: 1, channel: 'deb' }));
    await bridgeFiles(stage);
    await put(stage, 'usr/bin/airdrop-desktop', '#!/bin/sh\nexport AIRDROP_APP_DIR=/opt/airdrop\nexec /opt/airdrop/desktop/Airdrop "$@"\n', 0o755);
    await put(stage, 'usr/bin/airdrop', '#!/bin/sh\nexport AIRDROP_APP_DIR=/opt/airdrop\nexec /opt/airdrop/runtime/node /opt/airdrop/server/bin/airdrop.js "$@"\n', 0o755);
    await put(stage, 'usr/share/applications/io.github.fluffydisk.airdrop-linux.desktop', await fsp.readFile(path.join(root, 'packaging/debian/airdrop.desktop')));
    await put(stage, 'usr/share/icons/hicolor/192x192/apps/io.github.fluffydisk.airdrop-linux.png', await fsp.readFile(path.join(root, 'ui/icon-192.png')));
    await put(stage, 'usr/lib/systemd/user/airdrop-session.service', await fsp.readFile(path.join(root, 'packaging/debian/airdrop-session.service')));
    await put(stage, 'usr/lib/systemd/user/airdrop-prepare-stop.service', await fsp.readFile(path.join(root, 'packaging/debian/airdrop-prepare-stop.service')));
    await put(stage, 'etc/xdg/autostart/io.github.fluffydisk.airdrop-linux.desktop', '[Desktop Entry]\nType=Application\nName=Airdrop sharing\nExec=/opt/airdrop/runtime/node /opt/airdrop/server/scripts/session-start.js\nNoDisplay=true\n');
    await put(stage, 'usr/share/doc/airdrop-linux/copyright', await fsp.readFile(path.join(root, 'LICENSE')));
    const common = `Version: ${version}\nMaintainer: fluffydisk <omerfarukbozkurt.2007@gmail.com>\nSection: net\nPriority: optional\nHomepage: https://github.com/fluffydisk/airdrop-linux\n`;
    const deb = await archive(stage, `airdrop-linux_${version}_${arch}.deb`, `Package: airdrop-linux\n${common}Architecture: ${arch}\nDepends: ${dependencies}\nProvides: airdrop-system-bridge\nConflicts: airdrop-system-bridge\nDescription: Private files and clipboard between your devices\n Complete desktop, local servers and guided Tailscale connection setup.\n`, out);
    const bridgeStage = path.join(work, 'bridge'); await fsp.mkdir(bridgeStage); await bridgeFiles(bridgeStage);
    await put(bridgeStage, 'usr/share/doc/airdrop-system-bridge/copyright', await fsp.readFile(path.join(root, 'LICENSE')));
    const bridge = await archive(bridgeStage, `airdrop-system-bridge_${version}_all.deb`, `Package: airdrop-system-bridge\n${common}Architecture: all\nDepends: python3, python3-dbus, python3-gi, dbus, systemd, policykit-1 | polkitd, ca-certificates, gnupg, apt\nConflicts: airdrop-linux\nDescription: Authorized Tailscale setup bridge for Airdrop Flatpak\n Limited D-Bus interface for private connection setup.\n`, out);
    // The architecture-independent helper is published only once by the merger.
    await fsp.writeFile(path.join(out, `airdrop-deb-${process.arch}.json`), JSON.stringify({ version, deb: { [process.arch]: deb }, bridge: { [process.arch]: bridge } }, null, 2));
    console.log(`Prepared ${deb.name} and ${bridge.name}`);
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { archive, dependencies };
