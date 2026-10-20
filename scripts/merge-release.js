'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(process.argv[2] || 'release');
const manifests = ['x64', 'arm64'].map(arch => JSON.parse(fs.readFileSync(path.join(directory, `airdrop-update-${arch}.json`), 'utf8')));
if (manifests.some(value => value.version !== manifests[0].version || value.minimumNode !== manifests[0].minimumNode)) throw new Error('Release versions do not match');
const images = ['x64', 'arm64'].map(arch => JSON.parse(fs.readFileSync(path.join(directory, `airdrop-appimage-${arch}.json`), 'utf8')));
if (images.some(value => value.version !== manifests[0].version)) throw new Error('AppImage version mismatch');
const result = { appImages: Object.assign({}, ...images.map(value => value.appImages)), version: manifests[0].version, minimumNode: manifests[0].minimumNode, packages: Object.assign({}, ...manifests.map(value => value.packages)) };
for (const format of ['deb', 'flatpak']) {
  const filenames = ['x64', 'arm64'].map(arch => path.join(directory, `airdrop-${format}-${arch}.json`));
  if (!filenames.some(file => fs.existsSync(file))) continue;
  if (!filenames.every(file => fs.existsSync(file))) throw new Error(`Both ${format} architectures are required`);
  const metadata = filenames.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  if (metadata.some(value => value.version !== result.version)) throw new Error(`Managed ${format} version mismatch`);
  result[format] = Object.assign({}, ...metadata.map(value => value[format]));
  if (format === 'deb') {
    result.bridge = Object.assign({}, ...metadata.map(value => value.bridge));
    if (result.bridge.x64.name !== result.bridge.arm64.name || result.bridge.x64.sha256 !== result.bridge.arm64.sha256) throw new Error('Architecture-independent bridge packages differ');
  }
}
fs.writeFileSync(path.join(directory, 'airdrop-update.json'), JSON.stringify(result, null, 2));

const assets = fs.readdirSync(directory).filter(name => /\.(zip|tar\.gz|AppImage|deb|flatpak)$/.test(name) || ['install-prebuilt.sh', 'airdrop-update.json'].includes(name)).sort();
(async () => {
  const lines = [];
  for (const name of assets) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(directory, name))) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), lines.join('\n') + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
