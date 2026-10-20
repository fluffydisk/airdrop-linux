#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const archiver = require('archiver');
async function main() {
  const arch = process.arch;
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Build on Linux x64 or arm64');
  const root = path.resolve(__dirname, '..'); const pkg = require('../package.json');
  if (process.platform !== 'linux' || require('../desktop/package.json').version !== pkg.version) throw new Error('Matching Linux server/desktop versions required');
  const out = path.join(root, 'release'); await fsp.mkdir(out, { recursive: true });
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'airdrop-release-'));
  try {
    const app = path.join(stage, 'app'); const server = path.join(app, 'server'); await fsp.mkdir(server, { recursive: true });
    for (const name of ['push-server.js', 'package.json', 'package-lock.json', 'lib', 'bin', 'scripts']) await fsp.cp(path.join(root, name), path.join(server, name), { recursive: true });
    await fsp.mkdir(path.join(server, 'ui')); await fsp.copyFile(path.join(root, 'ui/zip.js'), path.join(server, 'ui/zip.js'));
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: server, stdio: 'inherit' });
    await fsp.cp(path.join(root, 'ui'), path.join(app, 'ui'), { recursive: true });
    const desktop = path.join(root, `desktop/out/Airdrop-linux-${arch}`);
    await fsp.access(path.join(desktop, 'Airdrop'));
    const desktopVersion = JSON.parse(await fsp.readFile(path.join(desktop, 'resources/app/package.json'), 'utf8')).version;
    if (desktopVersion !== pkg.version) throw new Error('Rebuild the desktop package before creating a release');
    await fsp.cp(desktop, path.join(app, 'desktop'), { recursive: true });
    const name = `airdrop-linux-${arch}-${pkg.version}.zip`;
    const archive = archiver('zip', { zlib: { level: 6 } }); const output = fs.createWriteStream(path.join(out, name));
    const done = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); });
    archive.pipe(output);
    async function append(directory, prefix) {
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        const source = path.join(directory, entry.name), target = prefix + '/' + entry.name;
        if (entry.isSymbolicLink()) continue; // dependency .bin links are unnecessary at runtime
        if (entry.isDirectory()) { archive.append('', { name: target + '/', mode: 0o755 }); await append(source, target); }
        else if (entry.isFile()) { const stat = await fsp.stat(source); archive.file(source, { name: target, mode: stat.mode & 0o111 ? 0o755 : 0o644 }); }
        else throw new Error(`Unsupported package entry: ${target}`);
      }
    }
    await append(app, 'app'); await archive.finalize(); await done;
    const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(path.join(out, name))) hash.update(chunk);
    const manifest = { version: pkg.version, minimumNode: '18.0.0', packages: { [arch]: { name, size: (await fsp.stat(path.join(out, name))).size, sha256: hash.digest('hex') } } };
    await fsp.writeFile(path.join(out, `airdrop-update-${arch}.json`), JSON.stringify(manifest, null, 2));
    // The stand-alone shell installer only needs standard tar + curl. Ship a
    // complete native application alongside the existing system-setup scripts.
    const bootstrap = path.join(stage, 'bootstrap/airdrop'); await fsp.mkdir(bootstrap, { recursive: true });
    for (const entry of ['install.sh', 'install-desktop.sh', 'install-prebuilt.sh', 'package.json', 'package-lock.json', 'push-server.js', 'lib', 'bin', 'scripts', 'ui', '.env.example', 'LICENSE']) await fsp.cp(path.join(root, entry), path.join(bootstrap, entry), { recursive: true });
    await fsp.mkdir(path.join(bootstrap, 'desktop')); await fsp.copyFile(path.join(root, 'desktop/package.json'), path.join(bootstrap, 'desktop/package.json'));
    await fsp.mkdir(path.join(bootstrap, 'prebuilt'));
    await fsp.cp(app, path.join(bootstrap, 'prebuilt/app'), { recursive: true, filter: async source => !(await fsp.lstat(source)).isSymbolicLink() });
    await fsp.writeFile(path.join(bootstrap, 'prebuilt/manifest.json'), JSON.stringify({ version: pkg.version, arch }));
    execFileSync('tar', ['-czf', path.join(out, `airdrop-bundle-linux-${arch}-${pkg.version}.tar.gz`), '-C', path.dirname(bootstrap), 'airdrop']);
    await fsp.copyFile(path.join(root, 'install-prebuilt.sh'), path.join(out, 'install-prebuilt.sh'));
    console.log(`Prepared ${name} and the stand-alone install bundle.`);
  } finally { await fsp.rm(stage, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
