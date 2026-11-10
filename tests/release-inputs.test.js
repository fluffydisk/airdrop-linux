'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { copyReleaseInput } = require('../scripts/release-inputs');

test('runtime copies preserve existing network services and exclude experimental source and untracked build outputs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-release-inputs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'checkout'), target = path.join(root, 'runtime');
  for (const name of ['network/quickshare/vendor/core_lib/src/lib.rs', 'network/quickshare/target/debug/airdrop-quickshare', '.cache/quickshare/x64/airdrop-quickshare', 'network/relay/server.js', 'lib/sharing/quickshare.js']) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await fs.writeFile(path.join(source, name), name);
  }
  await copyReleaseInput(source, target);
  await assert.rejects(fs.stat(path.join(target, 'network/quickshare')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(target, '.cache/quickshare')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(target, 'network/relay/server.js'), 'utf8'), 'network/relay/server.js');
  assert.equal(await fs.readFile(path.join(target, 'lib/sharing/quickshare.js'), 'utf8'), 'lib/sharing/quickshare.js');
});

test('runtime copies reject a native helper accidentally placed in a desktop or runtime payload', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-release-binary-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'desktop');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'airdrop-quickshare'), 'experimental binary');
  await assert.rejects(copyReleaseInput(source, path.join(root, 'runtime')), /not approved for runtime distribution/);
});
