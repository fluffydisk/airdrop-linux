'use strict';
// Real process/D-Bus failure handling. No controller or Android success claimed.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { QuickShare } = require('../lib/sharing/quickshare');
test('native-feature helper keeps LAN available through absent BlueZ and repeated starts/stops', { timeout: 30000 }, async t => {
  const helper = process.env.AIRDROP_TEST_QUICKSHARE_HELPER; assert.ok(helper);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quickshare-ble-native-'));
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(helper)).digest('hex');
  const adapter = new QuickShare({ enabled: true, bleNative: true, helper, sha256, port: 0, directory, inbox: path.join(directory, 'inbox') });
  t.after(async () => { await adapter.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 3; i++) {
    const state = await adapter.start(); assert.equal(state.status, 'ready'); assert.equal(state.capabilities.gattBootstrap, true); assert.equal(state.capabilities.lanUpgrade, false); assert.ok(state.listenerPort > 0);
    const probe = await adapter.request('bluetooth-preflight'); assert.equal(probe.registrationTested, false);
    const snapshot = await adapter.request('snapshot'); assert.ok(snapshot.bluetooth); assert.deepEqual(snapshot.recipients, []);
    await adapter.request('visibility', { visible: false }); await adapter.request('visibility', { visible: true });
    const child = adapter.child; await adapter.stop(); assert.ok(child.exitCode !== null || child.signalCode !== null);
  }
  const gated = new QuickShare({ enabled: true, helper, sha256, directory, inbox: path.join(directory, 'inbox') });
  await assert.rejects(gated.start(), /capabilities/); await gated.stop();
});
