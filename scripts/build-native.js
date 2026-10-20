#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const lock = require('../packaging/runtime-assets.json');
const version = require('../package.json').version;
async function download(spec, target) {
  if (fs.existsSync(target) && crypto.createHash('sha256').update(await fsp.readFile(target)).digest('hex') === spec.sha256) return;
  const response = await fetch(spec.url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Runtime download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== spec.sha256) throw new Error('Runtime checksum mismatch');
  await fsp.writeFile(target, bytes);
}
async function prepareNative(target, arch = process.arch) {
  if (!lock[arch]) throw new Error('Unsupported native architecture');
  const desktop = path.join(root, `desktop/out/Airdrop-linux-${arch}`);
  if (JSON.parse(await fsp.readFile(path.join(desktop, 'resources/app/package.json'), 'utf8')).version !== version) throw new Error('Rebuild the desktop package first');
  await fsp.mkdir(path.join(target, 'server'), { recursive: true });
  for (const name of ['push-server.js', 'package.json', 'package-lock.json', 'lib', 'bin', 'scripts']) await fsp.cp(path.join(root, name), path.join(target, 'server', name), { recursive: true });
  await fsp.copyFile(path.join(root, 'packaging/debian/prerm'), path.join(target, 'server/scripts/package-lifecycle.sh'));
  await fsp.chmod(path.join(target, 'server/scripts/package-lifecycle.sh'), 0o755);
  await fsp.chmod(path.join(target, 'server/scripts/resume-user-sessions.sh'), 0o755);
  await fsp.mkdir(path.join(target, 'server/ui')); await fsp.copyFile(path.join(root, 'ui/zip.js'), path.join(target, 'server/ui/zip.js'));
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path.join(target, 'server'), stdio: 'inherit' });
  await fsp.cp(path.join(root, 'ui'), path.join(target, 'ui'), { recursive: true });
  await fsp.cp(desktop, path.join(target, 'desktop'), { recursive: true });
  await fsp.mkdir(path.join(target, 'runtime'), { recursive: true });
  const cache = path.join(root, '.cache/native-runtime'); await fsp.mkdir(cache, { recursive: true });
  for (const name of ['node', 'dufs']) {
    const spec = lock[arch][name]; const archive = path.join(cache, path.basename(spec.url)); await download(spec, archive);
    const binary = execFileSync('tar', ['-xOf', archive, spec.member], { maxBuffer: 150 * 1024 * 1024 });
    await fsp.writeFile(path.join(target, 'runtime', name), binary, { mode: 0o755 });
  }
  // The Node and dufs license texts are copied from the exact verified source archives.
  const licenses = path.join(target, 'licenses'); await fsp.mkdir(licenses);
  for (const name of ['node', 'dufs']) {
    const spec = lock[arch][name], archive = path.join(cache, path.basename(spec.url));
    const members = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).split('\n');
    const member = members.find(member => /(^|\/)(LICENSE|LICENSE-MIT|LICENSE\.txt)$/i.test(member));
    if (member) await fsp.writeFile(path.join(licenses, name + '-LICENSE'), execFileSync('tar', ['-xOf', archive, member]));
    else if (name === 'dufs') {
      // Upstream's binary archive omits the MIT text; this is the source tag license.
      const response = await fetch('https://raw.githubusercontent.com/sigoden/dufs/v' + lock.dufsVersion + '/LICENSE-MIT');
      if (!response.ok) throw new Error('Could not retrieve dufs license');
      await fsp.writeFile(path.join(licenses, 'dufs-LICENSE'), await response.text());
    } else throw new Error('Missing runtime license');
  }
  await fsp.copyFile(path.join(root, 'LICENSE'), path.join(licenses, 'Airdrop-LICENSE'));
  await fsp.writeFile(path.join(licenses, 'runtime-versions.json'), JSON.stringify(lock, null, 2));
  await fsp.cp(path.join(root, 'system'), path.join(target, 'system'), { recursive: true, filter: name => !name.includes('__pycache__') });
}
async function main() {
  const target = path.resolve(process.argv[2] || '.test-artifacts/native-app');
  if (fs.existsSync(target)) throw new Error('Native staging directory already exists');
  await prepareNative(target); console.log(target);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareNative, download };
