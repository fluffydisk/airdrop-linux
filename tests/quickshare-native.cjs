'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { QuickShare } = require('../lib/sharing/quickshare');
test('compiled native helper starts LAN-only without BlueZ and exits after pipe closure', { timeout: 20000 }, async t => {
  const helper = process.env.AIRDROP_TEST_QUICKSHARE_HELPER;
  assert.ok(helper, 'Set AIRDROP_TEST_QUICKSHARE_HELPER to the exact compiled helper');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quickshare-native-'));
  const adapter = new QuickShare({ enabled: true, helper, sha256: crypto.createHash('sha256').update(await fs.readFile(helper)).digest('hex'), directory, inbox: path.join(directory, 'inbox') });
  t.after(async () => { await adapter.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  const state = await adapter.start();
  assert.equal(state.status, 'ready'); assert.equal(state.capabilities.ble, false); assert.equal(state.capabilities.direct, false);
  assert.ok(Array.isArray((await adapter.request('snapshot')).recipients));
  const child = adapter.child; await adapter.stop();
  assert.equal(adapter.child, null); assert.equal(child.exitCode, 0);
  assert.deepEqual(await fs.readdir(path.join(directory, 'inbox')), []);
});
