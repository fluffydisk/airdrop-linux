'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { archive } = require('../scripts/build-deb');
const { build } = require('../scripts/build-apt');
test('APT stage verifies complete packages, retains two versions, signs indices and rejects corruption', async t => {
  try { execFileSync('gpg', ['--version'], { stdio: 'ignore' }); } catch { t.skip('GnuPG is required'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-apt-'));
  const previous = process.env.GNUPGHOME; process.env.GNUPGHOME = path.join(root, 'keyring'); await fs.mkdir(process.env.GNUPGHOME, { mode: 0o700 });
  t.after(async () => { try { execFileSync('gpgconf', ['--kill', 'gpg-agent'], { stdio: 'ignore' }); } catch {} if (previous) process.env.GNUPGHOME = previous; else delete process.env.GNUPGHOME; await fs.rm(root, { recursive: true, force: true }); });
  execFileSync('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', '', '--quick-generate-key', 'Airdrop test <test@example.invalid>', 'rsa2048', 'sign', '1d'], { stdio: 'ignore' });
  const key = execFileSync('gpg', ['--with-colons', '--list-secret-keys'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').find(line => line.startsWith('fpr:')).split(':')[9];
  const input = path.join(root, 'input'), payload = path.join(root, 'payload'); await fs.mkdir(input); await fs.mkdir(payload); await fs.writeFile(path.join(payload, 'hello'), 'test');
  for (const version of ['1.5.0', '1.5.1', '1.5.2']) {
    const dir = path.join(input, version); await fs.mkdir(dir); const deb = {};
    for (const [cpu, arch] of [['x64', 'amd64'], ['arm64', 'arm64']]) deb[cpu] = await archive(payload, `airdrop-linux_${version}_${arch}.deb`, `Package: airdrop-linux\nVersion: ${version}\nArchitecture: ${arch}\nDescription: test\n`, dir);
    await fs.writeFile(path.join(dir, 'airdrop-update.json'), JSON.stringify({ version, deb }));
  }
  const output = path.join(root, 'repo'); const result = await build(input, output, key);
  assert.deepEqual(result.releases, ['1.5.2', '1.5.1']);
  execFileSync('gpg', ['--verify', path.join(output, 'dists/stable/InRelease')], { stdio: 'ignore' });
  const packages = await fs.readFile(path.join(output, 'dists/stable/main/binary-amd64/Packages'), 'utf8');
  assert.match(packages, /Version: 1.5.2/); assert.doesNotMatch(packages, /Version: 1.5.0/); assert.doesNotMatch(packages, /Architecture: arm64/);
  assert.match(await fs.readFile(path.join(output, 'airdrop.sources'), 'utf8'), /Signed-By:/);
  await fs.appendFile(path.join(input, '1.5.2/airdrop-linux_1.5.2_amd64.deb'), 'corrupt');
  const rejected = path.join(root, 'corrupt-output'); await assert.rejects(build(input, rejected, key), /checksum mismatch/); await assert.rejects(fs.access(rejected));
});
