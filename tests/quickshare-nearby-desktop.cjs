'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');

test('sandboxed Nearby Share starts scoped native sessions and stops its helper on navigation', { timeout: 45000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-nearby-share-'));
  const source = path.join(root, 'fixture.txt');
  await fs.writeFile(source, 'desktop fixture');
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  const packaged = process.env.AIRDROP_TEST_PACKAGED_DESKTOP;
  const env = { ...process.env, AIRDROP_HOME: path.join(root, 'airdrop'), AIRDROP_DISABLE_TRAY: '1',
    AIRDROP_DISABLE_UPDATE_CHECK: '1' };
  if (packaged) {
    delete env.AIRDROP_EXPERIMENTAL_QUICK_SHARE;
    delete env.AIRDROP_QUICKSHARE_BLE_NATIVE;
  } else {
    env.AIRDROP_EXPERIMENTAL_QUICK_SHARE = '1';
    env.AIRDROP_QUICKSHARE_BLE_NATIVE = '0';
  }
  app = await electron.launch({
    executablePath: packaged || require('../desktop/node_modules/electron'),
    chromiumSandbox: true,
    args: [...(packaged ? [] : [path.resolve('desktop')]), '--ozone-platform=x11'],
    env,
    timeout: 20000
  });
  const page = await app.firstWindow();
  const state = () => page.evaluate(async () => (await window.airdrop.sharing('state')).quickShare);
  async function waitForMode(mode) {
    const deadline = Date.now() + 10000;
    do {
      const quickShare = await state();
      if (quickShare.mode === mode && quickShare.status === (mode ? 'ready' : 'stopped')) return quickShare;
      await delay(100);
    } while (Date.now() < deadline);
    assert.fail('Nearby Share did not enter ' + (mode || 'the stopped state'));
  }
  await waitForMode(null);
  await page.locator('[data-view="native-sharing"]').click();
  await page.locator('#nativeReceive').click();
  const { listenerPort, capabilities } = await waitForMode('receive');
  if (packaged) {
    assert.equal(capabilities.classicReceive, true, 'Packaged builds must expose the native Classic receive capability');
  }
  assert.ok(listenerPort > 0);

  await app.evaluate(({ dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
  }, source);
  await page.locator('#nativeSend').click();
  await waitForMode('send');
  assert.equal(await page.locator('#nativeFiles li').textContent(), 'fixture.txt');
  await page.locator('[data-view="transfer"]').click();
  await waitForMode(null);
  assert.deepEqual((await state()).recipients, []);
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = net.createConnection(listenerPort, '127.0.0.1');
    socket.once('error', reject);
    socket.once('connect', () => { socket.destroy(); resolve(); });
  }), { code: 'ECONNREFUSED' });
});
