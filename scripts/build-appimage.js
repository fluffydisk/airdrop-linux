#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
async function download(spec, target) {
  if (fs.existsSync(target) && crypto.createHash('sha256').update(await fsp.readFile(target)).digest('hex') === spec.sha256) return;
  const response = await fetch(spec.url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Build tool download failed: HTTP ${response.status}`);
  const temp = target + '.part';
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp, { mode: 0o700 }));
    if (crypto.createHash('sha256').update(await fsp.readFile(temp)).digest('hex') !== spec.sha256) throw new Error('AppImage build tool checksum changed. Review and update packaging/appimage-tools.json.');
    await fsp.rename(temp, target);
  } finally { await fsp.rm(temp, { force: true }); }
}
async function main() {
  const arch = process.arch; const tools = require('../packaging/appimage-tools.json')[arch];
  if (process.platform !== 'linux' || !tools) throw new Error('Build AppImages natively on Linux x64 or arm64');
  const root = path.resolve(__dirname, '..'), version = require('../desktop/package.json').version;
  const out = path.join(root, 'release'); await fsp.mkdir(out, { recursive: true });
  const cache = path.join(root, '.cache/appimage-tools'); await fsp.mkdir(cache, { recursive: true });
  const tool = path.join(cache, `appimagetool-${arch}`), runtime = path.join(cache, `runtime-${arch}`);
  await download(tools.tool, tool); await download(tools.runtime, runtime); await fsp.chmod(tool, 0o755);
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'airdrop-appimage-'));
  try {
    const appdir = path.join(work, 'Airdrop.AppDir'); await fsp.mkdir(path.join(appdir, 'usr/lib'), { recursive: true });
    const source = path.join(root, `desktop/out/Airdrop-linux-${arch}`);
    const metadata = JSON.parse(await fsp.readFile(path.join(source, 'resources/app/package.json'), 'utf8'));
    if (metadata.version !== version) throw new Error('Rebuild the desktop package first');
    await fsp.cp(source, path.join(appdir, 'usr/lib/airdrop'), { recursive: true });
    await fsp.writeFile(path.join(appdir, 'AppRun'), '#!/bin/sh\nset -eu\nappdir="${APPDIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"\nexec "$appdir/usr/lib/airdrop/Airdrop" "$@"\n', { mode: 0o755 });
    await fsp.writeFile(path.join(appdir, 'airdrop.desktop'), '[Desktop Entry]\nType=Application\nName=Airdrop\nComment=Private files and clipboard over Tailscale\nExec=AppRun\nIcon=airdrop\nTerminal=false\nCategories=Network;\nStartupWMClass=airdrop-desktop\n');
    const icon = await fsp.readFile(path.join(root, 'ui/icon-192.png')); await fsp.writeFile(path.join(appdir, 'airdrop.png'), icon); await fsp.writeFile(path.join(appdir, '.DirIcon'), icon);
    // Run the build tool without FUSE; the runtime itself is pinned by checksum.
    const extracted = await exec(tool, ['--appimage-extract'], { cwd: work, maxBuffer: 8 * 1024 * 1024 });
    if (extracted.stderr) process.stderr.write(extracted.stderr);
    const name = `Airdrop-${version}-${tools.appImageArch}.AppImage`;
    const result = await exec(path.join(work, 'squashfs-root/AppRun'), ['--no-appstream', '--comp', 'zstd', '--runtime-file', runtime, appdir, path.join(out, name)], { cwd: work, env: { ...process.env, ARCH: tools.appImageArch, VERSION: version }, maxBuffer: 8 * 1024 * 1024 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(path.join(out, name))) hash.update(chunk);
    await fsp.chmod(path.join(out, name), 0o755);
    await fsp.writeFile(path.join(out, `airdrop-appimage-${arch}.json`), JSON.stringify({ version, appImages: { [arch]: { name, size: (await fsp.stat(path.join(out, name))).size, sha256: hash.digest('hex') } } }, null, 2));
    console.log(`Prepared ${name}`);
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { download };
