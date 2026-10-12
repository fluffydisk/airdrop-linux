'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { chromium } = require('playwright-core');
const JSZip = require('jszip');
const { createServer } = require('../push-server');

test('Chromium: separate uploads, client ZIP, Android worker staging and native ZIP download', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-browser-'));
  const share = path.join(root, 'share'); await fs.mkdir(share);
  const service = createServer({ watchDir: share, stateDir: root, watch: false });
  const app = express(); app.use('/push', service.app); app.use('/ui', express.static(path.resolve('ui')));
  app.get('/', async (req, res) => {
    const paths = [];
    for (const name of await fs.readdir(share)) {
      if (name.startsWith('.')) continue;
      const stat = await fs.stat(path.join(share, name)); paths.push({ name, path_type: 'File', size: stat.size, mtime: stat.mtimeMs });
    }
    res.json({ paths });
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const context = await browser.newContext({ acceptDownloads: true }); const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/ui/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.locator('#fileInput').setInputFiles([{ name: 'ü,a.txt', mimeType: 'text/plain', buffer: Buffer.from('first') }]);
  await page.locator('#sendConfirm').click(); await page.waitForFunction(() => document.getElementById('status').textContent === '1 uploaded');
  assert.equal(await fs.readFile(path.join(share, 'ü,a.txt'), 'utf8'), 'first');
  await page.locator('#fileInput').setInputFiles([{ name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from('one') }, { name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from('two') }]);
  await page.locator('#sendZip').check(); await page.locator('#sendConfirm').click();
  await page.waitForFunction(() => document.getElementById('sendPanel').hidden);
  const zipName = (await fs.readdir(share)).find(name => name.endsWith('.zip'));
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(share, zipName)));
  assert.equal(await zip.file('same.txt').async('string'), 'one'); assert.equal(await zip.file('same (1).txt').async('string'), 'two');
  // Use an actual navigation POST so the controlling worker receives Share Target input.
  await page.evaluate(() => {
    const form = document.createElement('form'); form.method = 'POST'; form.enctype = 'multipart/form-data'; form.action = '/ui/share-target.html';
    const input = document.createElement('input'); input.type = 'file'; input.name = 'files'; input.multiple = true;
    const transfer = new DataTransfer(); transfer.items.add(new File(['shared'], 'android,ü.txt')); input.files = transfer.files;
    form.append(input); document.body.append(form); form.submit();
  });
  await page.waitForURL(/pending=/); await page.waitForFunction(() => !document.getElementById('sendPanel').hidden);
  assert.equal((await fs.readdir(share)).includes('android,ü.txt'), false);
  await page.locator('#sendConfirm').click(); await page.waitForFunction(() => document.getElementById('sendPanel').hidden);
  assert.equal(await fs.readFile(path.join(share, 'android,ü.txt'), 'utf8'), 'shared');
  const stagedCount = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('airdrop-shares', 1); request.onsuccess = () => resolve(request.result); });
    const count = await new Promise(resolve => { const request = db.transaction('shares').objectStore('shares').count(); request.onsuccess = () => resolve(request.result); });
    db.close(); return count;
  });
  assert.equal(stagedCount, 0);
  await page.locator('#fileListCard input').first().check();
  const downloadPromise = new Promise(resolve => {
    page.once('download', resolve);
    context.on('page', popup => popup.once('download', resolve));
  });
  await page.locator('#downloadZip').click();
  let timeout;
  const download = await Promise.race([downloadPromise, new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('Native ZIP download timed out')), 10000); })]).finally(() => clearTimeout(timeout));
  const downloadedZip = await JSZip.loadAsync(await fs.readFile(await download.path()));
  assert.equal(Object.keys(downloadedZip.files).length, 1);
  await fs.mkdir('.test-artifacts', { recursive: true });
  await page.screenshot({ path: '.test-artifacts/pwa-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.test-artifacts/pwa-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
});
