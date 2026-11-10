'use strict';
// Development artifact only. Production packaging deliberately does not call this.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
async function build({ bleFastInit = false } = {}) {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw Error('Unsupported Quick Share helper platform');
  const root = path.resolve(__dirname, '..'), cwd = path.join(root, 'network/quickshare');
  execFileSync('cargo', ['build', '--locked', '--bin', 'airdrop-quickshare', ...(bleFastInit ? ['--features', 'ble-fastinit'] : [])], { cwd, stdio: 'inherit' });
  const cargo = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { cwd, encoding: 'utf8' }));
  const output = path.join(root, '.cache/quickshare', process.arch); await fs.mkdir(output, { recursive: true });
  const target = path.join(output, 'airdrop-quickshare');
  const next = target + '.' + crypto.randomBytes(8).toString('hex');
  try {
    await fs.copyFile(path.join(cargo.target_directory, 'debug/airdrop-quickshare'), next); await fs.chmod(next, 0o700);
    // A previous lab may still be exiting. Replace its inode, never truncate a
    // running executable (ETXTBSY) or expose a partially copied helper.
    await fs.rename(next, target);
  } finally { await fs.unlink(next).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  const metadata = { schema: 1, arch: process.arch, experimental: true, sha256: crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex'), source: 'fb9c8f9502e5313e3d788aa3498659773ef12d28', capabilities: { lan: true, ble: false, direct: false } };
  metadata.applicationCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  metadata.dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
  metadata.lockSha256 = crypto.createHash('sha256').update(await fs.readFile(path.join(cwd, 'Cargo.lock'))).digest('hex');
  metadata.compiler = execFileSync('rustc', ['-Vv'], { cwd, encoding: 'utf8' }).trim();
  metadata.profile = 'debug'; metadata.features = bleFastInit ? ['ble-fastinit'] : []; metadata.ipc = 1;
  metadata.capabilities.bleFastInit = bleFastInit;
  const sourceHash = crypto.createHash('sha256');
  async function hashSources(directory, relative = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.name === 'target' || entry.name.startsWith('.')) continue;
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await hashSources(path.join(directory, entry.name), name);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(path.join(directory, entry.name));
        sourceHash.update(name + '\0' + bytes.length + '\0'); sourceHash.update(bytes);
      } else throw Error('Unsupported Quick Share source entry');
    }
  }
  await hashSources(cwd); metadata.sourceTreeSha256 = sourceHash.digest('hex');
  const nextMetadata = path.join(output, '.helper-' + crypto.randomBytes(8).toString('hex') + '.json');
  try { await fs.writeFile(nextMetadata, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(nextMetadata, path.join(output, 'helper.json')); }
  finally { await fs.unlink(nextMetadata).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  console.log('Verified development helper prepared. Stable builds remain disabled.');
}
if (require.main === module) {
  if (process.argv.slice(2).some(flag => flag !== '--ble-fastinit')) throw Error('Unknown Quick Share build option');
  build({ bleFastInit: process.argv.includes('--ble-fastinit') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { build };
