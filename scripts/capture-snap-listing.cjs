'use strict';
// Capture the real locally installed, immutable Snap; no mock UI or backend.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron: electron } = require('playwright-core');

(async () => {
  const output = path.resolve('snap-store-listing');
  const receipt = JSON.parse(await fs.readFile('packaging/snap/v1.5.0-revisions.json', 'utf8'));
  const files = (await fs.readdir('validated')).filter(name => name.endsWith('.snap'));
  assert.equal(files.length, 1);
  const snap = await fs.readFile(path.join('validated', files[0]));
  assert.equal(crypto.createHash('sha3-384').update(snap).digest('hex'), receipt.revisions.amd64.sha3_384);
  assert.equal(snap.length, receipt.revisions.amd64.size);
  const installed = JSON.parse(await fs.readFile('/snap/airdrop-linux/current/lib/airdrop-linux/server/package.json', 'utf8'));
  assert.equal(installed.version, receipt.version);
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile('/snap/airdrop-linux/current/lib/airdrop-linux/ui/icon-512.png', path.join(output, 'icon.png'));
  const listing = JSON.parse(await fs.readFile('packaging/snap/store-listing.json', 'utf8'));
  await fs.writeFile(path.join(output, 'listing.json'), JSON.stringify(listing, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'description.txt'), listing.description + '\n');
  let app;
  try {
    app = await electron.launch({ executablePath: '/snap/bin/airdrop-linux', chromiumSandbox: true,
      args: ['--ozone-platform=x11'], env: { ...process.env, AIRDROP_DISABLE_TRAY: '1', AIRDROP_DISABLE_UPDATE_CHECK: '1' }, timeout: 60000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.getElementById('health').dataset.status === 'ready', {}, { timeout: 30000 });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox), true);
    assert.equal(await app.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    if (await page.evaluate(() => document.documentElement.dataset.theme === 'dark')) await page.locator('#themeToggle').click();
    const common = await app.evaluate(() => process.env.SNAP_USER_COMMON);
    assert.ok(common && common.includes('/snap/airdrop-linux/'));
    const fixture = path.join(common, 'listing-fixtures');
    await fs.mkdir(fixture, { recursive: true });
    const examples = [path.join(fixture, 'Getting started.txt'), path.join(fixture, 'Example notes.md'), path.join(fixture, 'Airdrop icon.png')];
    await fs.writeFile(examples[0], 'Example file shared by Airdrop Linux. This screenshot contains demonstration data only.\n');
    await fs.writeFile(examples[1], '# Example notes\n\nFiles remain in your own shared workspace.\n');
    await fs.copyFile(path.join(output, 'icon.png'), examples[2]);
    // Automate only the native chooser result; the actual upload and file manager run unchanged.
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected }); }, examples);
    await page.locator('#choose').click();
    await page.waitForFunction(() => document.getElementById('result').textContent.startsWith('Sent:'), {}, { timeout: 30000 });
    await page.screenshot({ path: path.join(output, '01-transfer.png') });
    await page.locator('[data-view="files"]').click();
    await page.locator('#fileExplorer .explorer-item').first().waitFor();
    await page.screenshot({ path: path.join(output, '02-files.png') });
    await page.locator('[data-view="clipboard"]').click();
    await page.locator('#clipboardText').fill('Airdrop Linux sample text shared from the desktop.');
    await page.locator('#shareClipboard').click();
    await page.waitForFunction(() => /shared/i.test(document.getElementById('clipboardResult').textContent));
    await page.locator('#themeToggle').click();
    await page.screenshot({ path: path.join(output, '03-clipboard.png') });
    await fs.writeFile(path.join(output, 'capture-evidence.json'), JSON.stringify({ version: installed.version,
      producer_run: receipt.producer_run, architecture: 'amd64', sha3_384: receipt.revisions.amd64.sha3_384,
      chromium_sandbox: true, capture: 'real locally installed strict Snap with its actual local backend',
      fixture_data: true, chooser_automation: 'native dialog selection only', store_installation_test: false }, null, 2) + '\n');
  } finally { if (app) await app.close(); }
  for (const name of ['01-transfer.png', '02-files.png', '03-clipboard.png']) {
    const png = await fs.readFile(path.join(output, name));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1440); assert.equal(png.readUInt32BE(20), 900);
    assert.ok(png.length <= 2000000, name + ' exceeds Store image size limit');
  }
  console.log('Real immutable Snap screenshots captured; sandbox enabled and Store image limits verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
