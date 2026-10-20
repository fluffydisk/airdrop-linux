#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { newer } = require('../lib/updater');
async function sha(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
function control(file) {
  const bytes = execFileSync('ar', ['p', file, 'control.tar.gz'], { maxBuffer: 1024 * 1024 });
  const content = execFileSync('tar', ['-xzOf', '-', './control'], { input: bytes, encoding: 'utf8' });
  const fields = {};
  for (const line of content.split('\n')) { const match = line.match(/^([A-Za-z-]+): (.*)$/); if (match) fields[match[1]] = match[2]; }
  return { content, fields };
}
async function build(input, output, key) {
  if (!/^[A-Fa-f0-9]{40}$/.test(key || '')) throw new Error('An explicit full signing-key fingerprint is required');
  if (fs.existsSync(output)) throw new Error('APT output must be a new staging directory');
  const releases = [];
  for (const directory of await fsp.readdir(input, { withFileTypes: true })) {
    if (!directory.isDirectory() || !/^\d+\.\d+\.\d+$/.test(directory.name)) continue;
    const dir = path.join(input, directory.name);
    const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'airdrop-update.json'), 'utf8'));
    if (manifest.version !== directory.name) throw new Error('APT release version mismatch');
    if (!manifest.deb?.x64 || !manifest.deb?.arm64) throw new Error('Both DEB architectures must pass release verification');
    releases.push({ dir, version: directory.name, manifest });
  }
  releases.sort((a, b) => a.version === b.version ? 0 : newer(a.version, b.version) ? -1 : 1);
  if (!releases.length) throw new Error('No complete DEB releases to publish');
  try {
    await fsp.mkdir(output, { recursive: true }); const entries = [];
    for (const release of releases.slice(0, 2)) {
      const packages = [...Object.values(release.manifest.deb), ...Object.values(release.manifest.bridge || {})];
      const seen = new Set();
      for (const pkg of packages) {
        if (seen.has(pkg.name)) continue; seen.add(pkg.name);
        if (!/^airdrop-(linux|system-bridge)_\d+\.\d+\.\d+_(amd64|arm64|all)\.deb$/.test(pkg.name)) throw new Error('Unsafe APT package filename');
        const file = path.join(release.dir, pkg.name), size = (await fsp.stat(file)).size;
        const hash = await sha(file);
        if (pkg.sha256 !== hash || pkg.size !== size) throw new Error('APT package checksum mismatch');
        const { content, fields } = control(file);
        if (fields.Version !== release.version || !['airdrop-linux', 'airdrop-system-bridge'].includes(fields.Package) || !['amd64', 'arm64', 'all'].includes(fields.Architecture)) throw new Error('Invalid DEB control metadata');
        const filename = 'pool/main/a/airdrop/' + pkg.name;
        await fsp.mkdir(path.dirname(path.join(output, filename)), { recursive: true }); await fsp.copyFile(file, path.join(output, filename));
        entries.push({ arch: fields.Architecture, content: content.trimEnd() + `\nFilename: ${filename}\nSize: ${size}\nSHA256: ${hash}\n\n` });
      }
    }
    const indices = [];
    for (const arch of ['amd64', 'arm64']) {
      const name = `main/binary-${arch}/Packages`, directory = path.join(output, 'dists/stable', path.dirname(name)); await fsp.mkdir(directory, { recursive: true });
      const content = Buffer.from(entries.filter(item => item.arch === arch || item.arch === 'all').map(item => item.content).join(''));
      for (const [suffix, bytes] of [['', content], ['.gz', gzipSync(content)]]) { await fsp.writeFile(path.join(output, 'dists/stable', name + suffix), bytes); indices.push({ name: name + suffix, bytes }); }
    }
    const now = new Date(), until = new Date(now.getTime() + 30 * 86400000);
    const release = `Origin: Airdrop\nLabel: Airdrop\nSuite: stable\nCodename: stable\nArchitectures: amd64 arm64\nComponents: main\nDate: ${now.toUTCString()}\nValid-Until: ${until.toUTCString()}\nDescription: Official Airdrop binary packages\nSHA256:\n` + indices.map(item => ` ${crypto.createHash('sha256').update(item.bytes).digest('hex')} ${item.bytes.length} ${item.name}\n`).join('');
    const releaseFile = path.join(output, 'dists/stable/Release'); await fsp.writeFile(releaseFile, release);
    const args = ['--batch', '--yes', '--digest-algo', 'SHA256', '--local-user', key];
    execFileSync('gpg', [...args, '--output', releaseFile.replace(/Release$/, 'InRelease'), '--clearsign', releaseFile], { stdio: 'pipe' });
    execFileSync('gpg', [...args, '--output', releaseFile + '.gpg', '--detach-sign', releaseFile], { stdio: 'pipe' });
    await fsp.writeFile(path.join(output, 'airdrop-archive-keyring.gpg'), execFileSync('gpg', ['--export', key]));
    await fsp.writeFile(path.join(output, 'airdrop.sources'), 'Types: deb\nURIs: https://fluffydisk.github.io/airdrop-linux/apt/\nSuites: stable\nComponents: main\nArchitectures: amd64 arm64\nSigned-By: /usr/share/keyrings/airdrop-archive-keyring.gpg\n');
    await fsp.writeFile(path.join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Airdrop APT repository</title><h1>Airdrop updates</h1><p>Signing key fingerprint: <code>${key.toUpperCase()}</code></p><p>Download the <a href="airdrop-archive-keyring.gpg">public key</a> and <a href="airdrop.sources">APT source definition</a>. Install the key at <code>/usr/share/keyrings/airdrop-archive-keyring.gpg</code> and source at <code>/etc/apt/sources.list.d/airdrop.sources</code>.</p><p>Existing Airdrop files and settings are preserved.</p>`);
    let total = 0;
    async function count(dir) { for (const entry of await fsp.readdir(dir, { withFileTypes: true })) { const name = path.join(dir, entry.name); if (entry.isDirectory()) await count(name); else total += (await fsp.stat(name)).size; } }
    await count(output); if (total > 950 * 1024 * 1024) throw new Error('APT staging exceeds the GitHub Pages size budget');
    return { releases: releases.slice(0, 2).map(item => item.version), bytes: total };
  } catch (error) { await fsp.rm(output, { recursive: true, force: true }); throw error; }
}
if (require.main === module) build(path.resolve(process.argv[2] || 'apt-input'), path.resolve(process.argv[3] || '.test-artifacts/apt'), process.env.AIRDROP_APT_SIGNING_KEY).then(console.log).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build, control };
