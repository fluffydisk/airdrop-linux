#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { prepareNative } = require('./build-native');
const spec = require('../packaging/flatpak/github-package.json');
async function main() {
  const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
  const arch = process.arch === 'x64' ? 'x86_64' : 'aarch64';
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'airdrop-flatpak-'));
  try {
    const build = path.join(work, 'build');
    // All application code is already compiled; the platform suffices as a build SDK.
    execFileSync('flatpak', ['build-init', '--arch=' + arch, '--base=' + spec.base, '--base-version=' + spec.branch, build, spec.id, spec.runtime, spec.runtime, spec.branch], { stdio: 'inherit' });
    const app = path.join(build, 'files/airdrop');
    if (process.env.AIRDROP_NATIVE_STAGE) await fsp.cp(process.env.AIRDROP_NATIVE_STAGE, app, { recursive: true });
    else await prepareNative(app);
    await fsp.writeFile(path.join(app, 'install-source.json'), JSON.stringify({ schema: 1, channel: 'flatpak' }));
    const put = async (name, content, mode = 0o644) => { const file = path.join(build, 'files', name); await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, content, { mode }); };
    await put('bin/airdrop', '#!/bin/sh\nexport AIRDROP_APP_DIR=/app/airdrop\nexec /app/bin/zypak-wrapper /app/airdrop/desktop/Airdrop "$@"\n', 0o755);
    await put('share/applications/' + spec.id + '.desktop', `[Desktop Entry]\nType=Application\nName=Airdrop\nExec=airdrop\nIcon=${spec.id}\nTerminal=false\nCategories=Network;Utility;\n`);
    await put('share/icons/hicolor/192x192/apps/' + spec.id + '.png', await fsp.readFile(path.join(root, 'ui/icon-192.png')));
    await put('share/metainfo/' + spec.id + '.metainfo.xml', await fsp.readFile(path.join(root, 'packaging/airdrop.metainfo.xml')));
    execFileSync('flatpak', ['build-finish', '--command=airdrop', ...spec.permissions, build], { stdio: 'inherit' });
    // Never connect these smoke-test servers to the developer's host network.
    execFileSync('flatpak', ['build', '--readonly', '--unshare=network', '--nosocket=system-bus', '--nosocket=session-bus', build, '/app/airdrop/runtime/node', '-e', await fsp.readFile(path.join(root, 'tests/flatpak-runtime.cjs'), 'utf8')], { stdio: 'inherit', timeout: 60000 });
    const repo = path.join(work, 'repo'); execFileSync('flatpak', ['build-export', repo, build, 'stable'], { stdio: 'inherit' });
    const out = path.join(root, 'release'); await fsp.mkdir(out, { recursive: true });
    const name = `airdrop-linux-${process.arch}-${version}.flatpak`;
    execFileSync('flatpak', ['build-bundle', '--arch=' + arch, '--runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo', repo, path.join(out, name), spec.id, 'stable'], { stdio: 'inherit' });
    const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(path.join(out, name))) hash.update(chunk);
    await fsp.writeFile(path.join(out, `airdrop-flatpak-${process.arch}.json`), JSON.stringify({ version, flatpak: { [process.arch]: { name, size: (await fsp.stat(path.join(out, name))).size, sha256: hash.digest('hex') } } }, null, 2));
    console.log('Prepared GitHub Flatpak bundle (not a Flathub submission).');
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
