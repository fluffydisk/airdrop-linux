'use strict';
// Development build only. Production packaging deliberately does not call this.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
async function build() {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw Error('Unsupported Quick Share helper platform');
  const root = path.resolve(__dirname, '..'), cwd = path.join(root, 'network/quickshare');
  execFileSync('cargo', ['build', '--locked', '--bin', 'airdrop-quickshare'], { cwd, stdio: 'inherit' });
  const output = path.join(root, '.cache/quickshare', process.arch); await fs.mkdir(output, { recursive: true });
  const target = path.join(output, 'airdrop-quickshare'); await fs.copyFile(path.join(cwd, 'target/debug/airdrop-quickshare'), target); await fs.chmod(target, 0o700);
  const metadata = { schema: 1, arch: process.arch, experimental: true, sha256: crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex'), source: 'fb9c8f9502e5313e3d788aa3498659773ef12d28', capabilities: { lan: true, ble: false, direct: false } };
  await fs.writeFile(path.join(output, 'helper.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log('Verified development helper prepared. Stable builds remain disabled.');
}
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build };
