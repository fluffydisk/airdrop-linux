'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { atomicJson } = require('../lib/sharing/lab-evidence');
const { prepareFixtures } = require('../scripts/quickshare-lab/fixtures.cjs');
const { source, helperMetadata } = require('../scripts/quickshare-lab/environment.cjs');
test('lab desktop identifies the build, preserves consent/sandbox and prevents non-native fallback sends', { timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 's24-lab-ui-')), run = 'd'.repeat(32);
  const helper = helperMetadata(); assert.equal(helper.hashMatches, true, 'Build the real helper first');
  atomicJson(root, 'lab.json', { schema: 1, repository: await fs.realpath(process.cwd()), run, ...source(), helperVersion: '0.1.0', helperSha256: helper.sha256 });
  await prepareFixtures(path.join(root, 'fixtures'));
  let app;
  t.after(async () => { await app?.close().catch(() => {}); await fs.rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, AIRDROP_HOME: path.join(root, 'sessions', run, 'home'), AIRDROP_SHARE_DIR: path.join(root, 'sessions', run, 'share'), AIRDROP_QUICKSHARE_LAB_DIR: root, AIRDROP_EXPERIMENTAL_QUICK_SHARE: '1', AIRDROP_DISABLE_TRAY: '1', AIRDROP_DISABLE_UPDATE_CHECK: '1', AIRDROP_QUICKSHARE_BLE_FASTINIT: '0', AIRDROP_QUICKSHARE_BLE_NATIVE: process.env.AIRDROP_TEST_QUICKSHARE_BLE_NATIVE === '1' ? '1' : '0' };
  app = await electron.launch({ executablePath: require('../desktop/node_modules/electron'), chromiumSandbox: true, args: [path.resolve('desktop'), '--ozone-platform=' + (process.env.AIRDROP_TEST_OZONE || 'x11')], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.locator('#quickshareLab').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('labRuntime').textContent.includes('Helper: ready'));
  assert.match(await page.title(), /DEVELOPMENT/);
  assert.equal(await page.locator('#nearbyLink').isVisible(), false);
  assert.equal(await page.locator('#nearbyPhone').isVisible(), false);
  await page.waitForFunction(() => document.getElementById('sendDestination').options[0].textContent.includes('native Quick Share'));
  await page.waitForFunction(async () => (await window.airdrop.sharing('diagnostics')).pipeline.renderer_publications > 0);
  const choices = await page.locator('#sendDestination').textContent(); assert.equal(choices.includes('Shared workspace'), false); assert.equal(choices.includes('Share link'), false);
  await fs.mkdir('.test-artifacts', { recursive: true });
  await page.locator('#quickshareLab').scrollIntoViewIfNeeded(); await page.screenshot({ path: '.test-artifacts/quickshare-s24-lab.png' });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(root, 'fixtures/lab-small.txt'));
  await page.locator('#choose').click(); assert.equal(await page.locator('#send').isDisabled(), true);
  const errors = await page.evaluate(async () => {
    const failures = [];
    for (const action of [() => window.airdrop.send([], false, ''), () => window.airdrop.sharing('send', { recipientId: 'guest', sources: [] })]) {
      try { await action(); failures.push(false); } catch { failures.push(true); }
    }
    return failures;
  });
  assert.deepEqual(errors, [true, true]);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox), true);
  await fs.mkdir('.test-artifacts', { recursive: true }); await page.screenshot({ path: '.test-artifacts/quickshare-s24-transfer.png', fullPage: false });
});
