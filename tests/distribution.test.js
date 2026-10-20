'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { validate } = require('../scripts/validate-prebuilt');
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-distribution-')); t.after(() => fs.rm(temp, { recursive: true, force: true })); return temp;
}
test('single-file installer downloads a pinned release, verifies its checksum and executes setup without a build', async t => {
  const temp = await fixture(t); const source = path.join(temp, 'source/airdrop'); const bin = path.join(temp, 'bin'); await fs.mkdir(bin);
  await fs.mkdir(path.join(source, 'prebuilt/app/desktop'), { recursive: true });
  await fs.writeFile(path.join(source, 'install.sh'), '#!/bin/bash\nset -eu\ntest -d "$AIRDROP_PREBUILT_DIR/app/desktop"\nprintf installed > "$DISTRIBUTION_TEST_RESULT"\n');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64', name = `airdrop-bundle-linux-${arch}-1.4.0.tar.gz`;
  await run('tar', ['-czf', path.join(temp, name), '-C', path.join(temp, 'source'), 'airdrop']);
  const hash = crypto.createHash('sha256').update(await fs.readFile(path.join(temp, name))).digest('hex'); await fs.writeFile(path.join(temp, 'SHA256SUMS'), `${hash}  ${name}\n`);
  await fs.writeFile(path.join(bin, 'curl'), `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),url=args.find(v=>v.startsWith('https://')),index=args.indexOf('--output'),out=args[index+1];if(url.endsWith('/releases/latest'))process.stdout.write('https://github.com/fluffydisk/airdrop-linux/releases/tag/v1.4.0');else fs.copyFileSync(path.join(process.env.DISTRIBUTION_TEST_SOURCE,url.split('/').pop()),out);`, { mode: 0o755 });
  // Tests must work on root-owned CI containers without running real system setup.
  await fs.writeFile(path.join(bin, 'id'), '#!/bin/sh\necho 1000\n', { mode: 0o755 });
  const result = path.join(temp, 'result'); const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DISTRIBUTION_TEST_SOURCE: temp, DISTRIBUTION_TEST_RESULT: result };
  await run('bash', ['install-prebuilt.sh'], { env }); assert.equal(await fs.readFile(result, 'utf8'), 'installed');
  await fs.unlink(result);
  await fs.writeFile(path.join(temp, 'SHA256SUMS'), `${'0'.repeat(64)}  ${name}\n`);
  await assert.rejects(run('bash', ['install-prebuilt.sh', '--version', '1.4.0'], { env }), error => /checksum mismatch/.test(error.stderr));
  await assert.rejects(fs.access(result));
  await fs.writeFile(path.join(temp, 'SHA256SUMS'), `${hash}  ${name}\n${hash}  ${name}\n`);
  await assert.rejects(run('bash', ['install-prebuilt.sh', '--version', '1.4.0'], { env }), error => /ambiguous/.test(error.stderr));
});
test('download installer rejects linked entries before extraction or execution', async t => {
  const temp = await fixture(t), source = path.join(temp, 'source/airdrop'), bin = path.join(temp, 'bin'); await fs.mkdir(source, { recursive: true }); await fs.mkdir(bin);
  await fs.symlink('/etc/passwd', path.join(source, 'link'));
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64', name = `airdrop-bundle-linux-${arch}-1.4.0.tar.gz`;
  await run('tar', ['-czf', path.join(temp, name), '-C', path.dirname(source), 'airdrop']);
  const hash = crypto.createHash('sha256').update(await fs.readFile(path.join(temp, name))).digest('hex'); await fs.writeFile(path.join(temp, 'SHA256SUMS'), `${hash}  ${name}\n`);
  await fs.writeFile(path.join(bin, 'curl'), `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2);fs.copyFileSync(path.join(process.env.DISTRIBUTION_TEST_SOURCE,a.find(v=>v.startsWith('https://')).split('/').pop()),a[a.indexOf('--output')+1]);`, { mode: 0o755 });
  await fs.writeFile(path.join(bin, 'id'), '#!/bin/sh\necho 1000\n', { mode: 0o755 });
  await assert.rejects(run('bash', ['install-prebuilt.sh', '--version', '1.4.0'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DISTRIBUTION_TEST_SOURCE: temp } }), error => /Unsupported bundle entries/.test(error.stderr));
});
test('prebuilt metadata refuses a different architecture, missing components and version mismatches', async t => {
  const directory = await fixture(t); const version = require('../package.json').version;
  for (const name of ['app/server/package.json', 'app/server/push-server.js', 'app/ui/index.html', 'app/desktop/Airdrop', 'app/desktop/resources/app/package.json']) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), name.endsWith('package.json') ? JSON.stringify({ version }) : 'binary');
  }
  await fs.chmod(path.join(directory, 'app/desktop/Airdrop'), 0o755);
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version, arch: process.arch }));
  assert.equal(validate(directory).version, version); assert.throws(() => validate(directory, 'unknown'), /architecture/);
  await fs.writeFile(path.join(directory, 'app/server/package.json'), '{"version":"0.0.1"}'); assert.throws(() => validate(directory), /version mismatch/);
});
test('prebuilt server installation uses bundled dependencies and preserves existing files', async t => {
  const temp = await fixture(t), installer = await fs.readFile('install.sh', 'utf8');
  const copy = installer.slice(installer.indexOf('info "Installing Airdrop files..."'), installer.indexOf('# ---------- Prepare migration'));
  const prebuilt = path.join(temp, 'prebuilt'); await fs.mkdir(path.join(prebuilt, 'app'), { recursive: true });
  // Use fixture data, keeping all writes away from the actual installation.
  await fs.cp('ui', path.join(prebuilt, 'app/ui'), { recursive: true });
  await fs.mkdir(path.join(prebuilt, 'app/server'), { recursive: true });
  await fs.symlink(path.resolve('node_modules'), path.join(prebuilt, 'app/server/node_modules'));
  await fs.mkdir(path.join(temp, 'repo/scripts'), { recursive: true });
  await fs.writeFile(path.join(temp, 'repo/scripts/validate-prebuilt.js'), '// Fixture has already been validated.\n');
  const env = { ...process.env, AIRDROP_ROOT: temp, AIRDROP_PREBUILT_DIR: prebuilt, REPO_DIR: path.join(temp, 'repo'), SHARE_DIR: path.join(temp, 'files'), PUSH_DIR: path.join(temp, 'app/server'), UI_DIR: path.join(temp, 'app/ui'), LOCAL_BIN_DIR: path.join(temp, 'bin'), CONFIG_DIR: path.join(temp, 'config'), STATE_DIR: path.join(temp, 'state/push'), NODE_BIN: process.execPath, NPM_BIN: '/nonexistent/npm' };
  await fs.mkdir(env.SHARE_DIR); await fs.writeFile(path.join(env.SHARE_DIR, 'keep.txt'), 'user data');
  await run('bash', ['-c', 'set -Eeuo pipefail\ninfo(){ :; }; ok(){ :; }; fail(){ echo "$1" >&2; exit 1; }\n' + copy], { env });
  assert.equal(await fs.readFile(path.join(env.SHARE_DIR, 'keep.txt'), 'utf8'), 'user data');
  assert.equal(JSON.parse(await fs.readFile(path.join(temp, 'state/runtime.json'), 'utf8')).node, process.execPath);
});

test('release merge includes both AppImage architectures and checksum coverage for every public asset', async t => {
  const directory = await fixture(t); const version = require('../package.json').version;
  for (const arch of ['x64', 'arm64']) {
    const zipName = `airdrop-linux-${arch}-${version}.zip`, imageName = `Airdrop-${version}-${arch === 'x64' ? 'x86_64' : 'aarch64'}.AppImage`;
    const payload = Buffer.from(arch), digest = crypto.createHash('sha256').update(payload).digest('hex');
    await fs.writeFile(path.join(directory, zipName), payload); await fs.writeFile(path.join(directory, imageName), payload);
    await fs.writeFile(path.join(directory, `airdrop-bundle-linux-${arch}-${version}.tar.gz`), payload);
    await fs.writeFile(path.join(directory, `airdrop-update-${arch}.json`), JSON.stringify({ version, minimumNode: '18.0.0', packages: { [arch]: { name: zipName, size: payload.length, sha256: digest } } }));
    await fs.writeFile(path.join(directory, `airdrop-appimage-${arch}.json`), JSON.stringify({ version, appImages: { [arch]: { name: imageName, size: payload.length, sha256: digest } } }));
  }
  await fs.writeFile(path.join(directory, 'install-prebuilt.sh'), '#!/bin/bash\n');
  await run(process.execPath, ['scripts/merge-release.js', directory]);
  const combined = JSON.parse(await fs.readFile(path.join(directory, 'airdrop-update.json'), 'utf8'));
  assert.deepEqual(Object.keys(combined.appImages), ['x64', 'arm64']); assert.deepEqual(Object.keys(combined.packages), ['x64', 'arm64']);
  const sums = await fs.readFile(path.join(directory, 'SHA256SUMS'), 'utf8'); assert.equal(sums.trim().split('\n').length, 8);
  await run('sha256sum', ['--check', 'SHA256SUMS'], { cwd: directory });
});
