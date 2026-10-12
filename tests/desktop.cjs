'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');
const JSZip = require('jszip');
const executable = process.env.ELECTRON_PATH || require('../desktop/node_modules/electron');
async function mockServer() {
  let ready = true;
  const server = http.createServer((req, res) => { res.writeHead(ready ? 200 : 503); res.end('{}'); });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return { port: server.address().port, set: value => { ready = value; }, close: () => new Promise(resolve => server.close(resolve)) };
}
test('Electron: sandboxed window, drag/drop, ZIP, status recovery, restart and no-tray close', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-desktop-test-'));
  const share = path.join(root, 'files'); await fs.mkdir(share);
  const userData = path.join(root, 'state/desktop');
  const fileServer = await mockServer(), apiServer = await mockServer();
  const source = path.join(root, 'ü,a.txt'); await fs.writeFile(source, 'desktop payload');
  const launch = () => electron.launch({ executablePath: executable, args: [...(process.env.ELECTRON_PATH ? [] : [path.resolve('desktop')]), '--ozone-platform=' + (process.env.AIRDROP_TEST_OZONE || 'x11')], env: { ...process.env, AIRDROP_DISABLE_TRAY: '1', AIRDROP_HOME: root, AIRDROP_FILE_PORT: String(fileServer.port), AIRDROP_API_PORT: String(apiServer.port) }, timeout: 20000 });
  let app;
  t.after(async () => { if (app) await app.close().catch(() => {}); await fileServer.close(); await apiServer.close(); await fs.rm(root, { recursive: true, force: true }); });
  app = await launch(); const page = await app.firstWindow();
  page.on('console', message => { if (message.type() === 'error') console.log('Renderer error:', message.text()); });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.getElementById('health').dataset.status === 'ready');
  assert.equal(await page.evaluate(() => typeof require), 'undefined');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox), true);
  await page.setViewportSize({ width: 1080, height: 840 });
  await fs.mkdir('.test-artifacts', { recursive: true });
  await page.screenshot({ path: '.test-artifacts/desktop-home.png' });
  // Use a File backed by a path and dispatch a real DOM drop through the preload path conversion.
  await page.evaluate(async source => {
    const file = new File(['desktop payload'], 'ü,a.txt');
    // A synthetic File has no OS path: verify it is rejected before using the main IPC path below.
    const transfer = new DataTransfer(); transfer.items.add(file);
    document.getElementById('dropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, source);
  await page.waitForFunction(() => document.getElementById('result').textContent.length > 0);
  assert.match(await page.locator('#result').textContent(), /Invalid dropped files/);
  await page.evaluate(() => {
    const input = document.createElement('input'); input.type = 'file'; input.id = 'osFile'; document.body.append(input);
  });
  const cdp = await page.context().newCDPSession(page);
  const document = await cdp.send('DOM.getDocument');
  const node = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#osFile' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [source] });
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(document.getElementById('osFile').files[0]);
    document.getElementById('dropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    document.getElementById('osFile').remove();
  });
  await page.waitForFunction(() => !document.getElementById('send').disabled);
  assert.equal(await page.locator('.file-name').first().textContent(), 'ü,a.txt');
  assert.match(await page.locator('#queueSummary').textContent(), /1 file/);
  await fs.mkdir('.test-artifacts', { recursive: true });
  await page.setViewportSize({ width: 1080, height: 840 });
  await page.locator('#themeToggle').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('dropZone')).backgroundColor === 'rgb(28, 28, 30)');
  await page.screenshot({ path: '.test-artifacts/desktop-dark.png' });
  await page.locator('#themeToggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('dropZone')).backgroundColor === 'rgb(255, 255, 255)');
  await page.screenshot({ path: '.test-artifacts/desktop-light.png' });
  await page.locator('#themeToggle').click();
  await page.setViewportSize({ width: 620, height: 740 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.test-artifacts/desktop-compact.png' });
  await page.setViewportSize({ width: 1080, height: 840 });
  const largePath = path.join(root, 'large.bin');
  const largeHandle = await fs.open(largePath, 'w'); await largeHandle.truncate(100 * 1024 * 1024 + 1); await largeHandle.close();
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'largeFile'; document.body.append(input); });
  const largeDocument = await cdp.send('DOM.getDocument');
  const largeNode = await cdp.send('DOM.querySelector', { nodeId: largeDocument.root.nodeId, selector: '#largeFile' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: largeNode.nodeId, files: [largePath] });
  await page.evaluate(() => { const transfer = new DataTransfer(); transfer.items.add(document.getElementById('largeFile').files[0]); document.getElementById('dropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); document.getElementById('largeFile').remove(); });
  await page.waitForFunction(() => document.getElementById('fileCount').textContent === '2');
  assert.equal(await page.locator('#zip').isDisabled(), true);
  await page.getByRole('button', { name: 'Remove large.bin', exact: true }).click();
  assert.equal(await page.locator('#fileCount').textContent(), '1');
  assert.equal(await page.locator('#zip').isDisabled(), false);
  await page.locator('#zip').check(); await page.locator('#send').click();
  await page.waitForFunction(() => document.getElementById('result').textContent.startsWith('Sent:'));
  const name = (await fs.readdir(share)).find(name => name.endsWith('.zip'));
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(share, name)));
  assert.equal(await zip.file('ü,a.txt').async('string'), 'desktop payload');
  apiServer.set(false); await page.waitForFunction(() => document.getElementById('health').dataset.status === 'partial', null, { timeout: 10000 });
  fileServer.set(false); await page.waitForFunction(() => document.getElementById('health').dataset.status === 'offline', null, { timeout: 10000 });
  apiServer.set(true); fileServer.set(true); await page.waitForFunction(() => document.getElementById('health').dataset.status === 'ready', null, { timeout: 10000 });
  await page.locator('[data-view="activity"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#recentFiles .file-row').length === 1);
  assert.match(await page.locator('#recentFiles .file-name').textContent(), /airdrop-.*\.zip/);
  await page.locator('[data-view="settings"]').click();
  await page.locator('#url').fill('https://desktop.example.ts.net/ui/'); await page.locator('#saveUrl').click();
  await page.waitForFunction(() => document.getElementById('settingsResult').textContent.startsWith('Saved:'));
  await page.screenshot({ path: '.test-artifacts/desktop-settings.png' });
  await page.locator('[data-view="transfer"]').click();
  await page.screenshot({ path: '.test-artifacts/desktop.png' });
  assert.deepEqual(errors, []);
  await page.locator('#themeToggle').click();
  const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; app = null;
  app = await launch(); const reopened = await app.firstWindow();
  await reopened.locator('[data-view="settings"]').click();
  assert.equal(await reopened.locator('html').getAttribute('data-theme'), 'light');
  await reopened.waitForFunction(() => document.getElementById('url').value === 'https://desktop.example.ts.net/ui/');
  assert.equal(JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8')).pwaUrl, 'https://desktop.example.ts.net/ui/');
});

test('Electron: real StatusNotifier tray keeps window accessible after close', async t => {
  const { promisify } = require('node:util');
  const { execFile } = require('node:child_process');
  let host;
  try {
    host = (await promisify(execFile)('dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', 'string:org.kde.StatusNotifierWatcher'])).stdout.includes('boolean true');
  } catch {}
  if (!host) { t.skip('No StatusNotifier watcher in this desktop session'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-tray-test-'));
  const app = await electron.launch({ executablePath: executable, args: [...(process.env.ELECTRON_PATH ? [] : [path.resolve('desktop')]), '--ozone-platform=' + (process.env.AIRDROP_TEST_OZONE || 'x11')],
    env: { ...process.env, AIRDROP_DISABLE_TRAY: '', AIRDROP_DESKTOP_USER_DATA: root }, timeout: 20000 });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.getElementById('health').textContent !== 'Checking services…');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
});
