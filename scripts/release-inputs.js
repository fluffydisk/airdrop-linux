'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Exclude native development inputs from general runtime copies. The portable
// release builders explicitly stage the verified helper after copying Electron.
function allowReleaseInput(source) {
  const parts = path.resolve(source).split(path.sep);
  if (parts.some((part, index) => (part === 'network' || part === '.cache') && parts[index + 1] === 'quickshare')) return false;
  if (/^airdrop-quickshare(?:\.exe)?$/.test(path.basename(source))) {
    throw new Error('Experimental Quick Share binaries are not approved for runtime distribution.');
  }
  return true;
}

async function copyReleaseInput(source, destination) {
  await fs.cp(source, destination, { recursive: true, filter: allowReleaseInput });
}

async function stageQuickShare(root, desktop) {
  if (process.env.AIRDROP_PACKAGE_QUICK_SHARE !== '1') return;

  const source = path.join(root, '.cache/quickshare', process.arch);
  const target = path.join(desktop, 'resources/quickshare', process.arch);
  const helper = await fs.readFile(path.join(source, 'airdrop-quickshare'));
  const metadata = await fs.readFile(path.join(source, 'helper.json'), 'utf8');
  const parsed = JSON.parse(metadata);
  if (parsed.arch !== process.arch || !parsed.capabilities?.ble || !parsed.capabilities?.classicReceive ||
      parsed.sha256 !== createHash('sha256').update(helper).digest('hex')) {
    throw new Error('Invalid experimental Quick Share release helper');
  }
  await fs.mkdir(target, { recursive: true });
  const executable = path.join(target, 'airdrop-quickshare');
  await fs.writeFile(executable, helper, { mode: 0o755, flag: 'wx' });
  execFileSync('strip', ['--strip-unneeded', executable]);
  parsed.sha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
  parsed.desktopDefault = true;
  await fs.writeFile(path.join(target, 'helper.json'), JSON.stringify(parsed, null, 2) + '\n', { flag: 'wx' });
  const nativeSource = path.join(root, 'network/quickshare');
  for (const entry of ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'MODIFICATIONS.md', 'licenses']) {
    await fs.cp(path.join(nativeSource, entry), path.join(target, entry), { recursive: true });
  }
}

module.exports = { allowReleaseInput, copyReleaseInput, stageQuickShare };
