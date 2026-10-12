'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { readSharedClipboard, writeSharedClipboard } = require('../desktop/clipboard');
test('shared clipboard preserves Unicode, replaces text, bounds input and refuses linked reads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clipboard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal(await readSharedClipboard(root), null);
  await writeSharedClipboard(root, 'Merhaba 👋\nİkinci satır');
  assert.equal(await readSharedClipboard(root), 'Merhaba 👋\nİkinci satır');
  await writeSharedClipboard(root, 'replacement');
  assert.equal(await readSharedClipboard(root), 'replacement');
  await assert.rejects(writeSharedClipboard(root, 'ü'.repeat(1024 * 1024)), /1 MiB/);
  assert.equal(await readSharedClipboard(root), 'replacement');
  const target = path.join(root, 'target'); await fs.writeFile(target, 'untouched');
  await fs.unlink(path.join(root, '.clipboard.txt'));
  await fs.symlink(target, path.join(root, '.clipboard.txt'));
  await assert.rejects(readSharedClipboard(root));
  await writeSharedClipboard(root, 'safe replacement');
  assert.equal(await fs.readFile(target, 'utf8'), 'untouched');
  assert.equal(await readSharedClipboard(root), 'safe replacement');
});
test('desktop clipboard buttons paste, share, load and copy; failed loads preserve draft', async () => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only', url: 'https://local.test' });
  const { window } = dom; let shared = null, copied;
  window.airdrop = { onStatus() {}, status: async () => ({ label: 'Ready', status: 'ready' }), settings: async () => ({}),
    readClipboard: async () => 'local text', shareClipboard: async text => { shared = text; },
    loadClipboard: async () => shared, copyClipboard: async text => { copied = text; } };
  window.eval(await fs.readFile('desktop/renderer.js', 'utf8'));
  const get = id => window.document.getElementById(id);
  try {
    window.document.querySelector('[data-view="clipboard"]').click();
    assert.equal(get('view-clipboard').hidden, false);
    assert.equal(get('shareClipboard').disabled, true);
    await get('pasteClipboard').onclick();
    assert.equal(get('clipboardText').value, 'local text');
    await get('loadClipboard').onclick();
    assert.equal(get('clipboardText').value, 'local text');
    assert.match(get('clipboardResult').textContent, /No shared text/);
    await get('shareClipboard').onclick(); assert.equal(shared, 'local text');
    shared = 'other device\nİstanbul';
    await get('loadClipboard').onclick();
    await get('copyClipboard').onclick(); assert.equal(copied, shared);
    assert.equal(get('pasteClipboard').disabled, false);
  } finally { window.close(); }
});
