'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');
const { File } = require('node:buffer');
const crypto = require('node:crypto');
const sharesCode = fs.readFileSync('ui/pending-share.js', 'utf8');
const explorerCode = fs.readFileSync('ui/explorer.js', 'utf8');
const appCode = fs.readFileSync('ui/app.js', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function page(t, fetcher, url = 'https://airdrop.example/ui/') {
  const dom = new JSDOM(fs.readFileSync('ui/index.html', 'utf8'), { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = fetcher;
  w.AirdropShares = { cleanup: async () => {}, remove: async () => {}, get: async () => null };
  w.AirdropZip = require('../ui/zip');
  w.eval(explorerCode); w.eval(appCode);
  return w;
}
test('file names render as text, selection includes all files, comma preserved', async t => {
  const name = '<img src=x onerror=alert(1)>,ü.txt';
  const w = page(t, async () => ({ ok: true, json: async () => ({ entries: Array.from({ length: 9 }, (_, i) => ({ type: 'file', path: i ? `file${i}` : name, name: i ? `file${i}` : name, size: 10 })) }) }));
  await tick();
  assert.equal(w.document.querySelectorAll('#fileListCard .explorer-name').length, 9);
  assert.equal(w.document.querySelector('#fileListCard img'), null);
  assert.equal(w.document.querySelector('#fileListCard .explorer-name').textContent, name);
  const checkbox = w.document.querySelector('#fileListCard input'); checkbox.checked = true; checkbox.dispatchEvent(new w.Event('change'));
  assert.equal([...w.document.querySelectorAll('#fileListCard button')].find(button => button.textContent === 'Download').disabled, false);
});
test('service worker registers even without PushManager', async t => {
  const dom = new JSDOM(fs.readFileSync('ui/index.html', 'utf8'), { url: 'https://airdrop.example/ui/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  let registered = false;
  const w = dom.window;
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { register: async () => { registered = true; }, ready: Promise.resolve({}), addEventListener() {} } });
  w.fetch = async () => ({ ok: true, json: async () => ({ entries: [] }) });
  w.AirdropShares = { cleanup: async () => {} }; w.AirdropZip = require('../ui/zip');
  w.eval(explorerCode); w.eval(appCode); await tick(); assert.equal(registered, true);
});
test('staged Android files upload immediately and retry only failed files', async t => {
  let uploads = 0, removed = 0;
  const dom = new JSDOM(fs.readFileSync('ui/index.html', 'utf8'), { url: 'https://airdrop.example/ui/?pending=123', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window;
  w.AirdropZip = require('../ui/zip');
  w.AirdropShares = { cleanup: async () => {}, options: async () => null, replace: async (id, files) => { assert.equal(files.length, 1); assert.equal(files[0].name, 'bad.txt'); }, get: async () => [new w.File(['a'], 'ü,a.txt'), new w.File(['b'], 'bad.txt')], remove: async id => { assert.equal(id, '123'); removed++; } };
  w.fetch = async (url, opts) => {
    if (opts?.method === 'PUT') { uploads++; const ok = uploads > 2 || !url.includes('bad.txt'); return { ok, json: async () => ok ? { name: 'ü,a.txt', size: 1 } : { error: 'disk full' } }; }
    return { ok: true, json: async () => ({ entries: [] }) };
  };
  w.eval(explorerCode); w.eval(appCode); await tick(); assert.equal(uploads, 2);
  assert.equal(w.document.getElementById('sendPanel').hidden, false);
  assert.match(w.document.getElementById('status').textContent, /1 uploaded; failed: bad.txt/);
  w.document.getElementById('sendConfirm').click(); await tick();
  assert.equal(uploads, 3); assert.equal(removed, 1); assert.equal(w.document.getElementById('sendPanel').hidden, true);
});
test('oversize ZIP stays selected, never silently uploads separately, and can be discarded', async t => {
  let uploads = 0, removed = false;
  const dom = new JSDOM(fs.readFileSync('ui/index.html', 'utf8'), { url: 'https://airdrop.example/ui/?pending=123', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window;
  w.localStorage.setItem('airdrop-zip', 'true');
  w.fetch = async (url, options) => { if (options?.method === 'PUT') uploads++; return { ok: true, json: async () => ({ entries: [] }) }; }; w.AirdropZip = require('../ui/zip');
  w.AirdropShares = { cleanup: async () => {}, options: async () => null, get: async () => [{ name: 'large', size: 100 * 1024 * 1024 + 1 }], remove: async () => { removed = true; } };
  w.eval(explorerCode); w.eval(appCode); await tick();
  assert.equal(uploads, 0); assert.equal(w.document.getElementById('sendZip').checked, true);
  assert.match(w.document.getElementById('status').textContent, /100 MiB/);
  w.document.getElementById('sendCancel').click(); await tick(); assert.equal(removed, true); assert.equal(w.document.getElementById('sendPanel').hidden, true);
});
test('IndexedDB staging preserves files and deletes expired records', async () => {
  const context = vm.createContext({ indexedDB, File, crypto, Date }); vm.runInContext(sharesCode, context);
  const api = context.AirdropShares;
  const id = await api.stage([new File(['data'], 'ü,a.txt')]);
  const files = await api.get(id); assert.equal(files[0].name, 'ü,a.txt'); assert.equal(await files[0].text(), 'data');
  await api.remove(id); assert.equal(await api.get(id), null);
  const old = await api.stage([new File(['old'], 'old.txt')]);
  const original = Date.now;
  try { Date.now = () => original() + 25 * 60 * 60 * 1000; await api.cleanup(); }
  finally { Date.now = original; }
  assert.equal(await api.get(old), null);
});
test('worker Share Target stages files and redirects without uploading', async () => {
  let handler, staged = false;
  const context = vm.createContext({ URL, File, Response, importScripts() {}, self: { registration: { scope: 'https://airdrop.example/ui/' }, addEventListener(type, fn) { if (type === 'fetch') handler = fn; } }, AirdropShares: { cleanup: async () => {}, stage: async files => { assert.equal(files[0].name, 'ü,a.txt'); staged = true; return 'id'; } } });
  vm.runInContext(fs.readFileSync('ui/sw.js', 'utf8'), context);
  const request = { url: 'https://airdrop.example/ui/share-target.html', method: 'POST', formData: async () => ({ getAll: () => [new File(['a'], 'ü,a.txt')] }) };
  let response; handler({ request, respondWith(promise) { response = promise; } });
  const result = await response; assert.equal(staged, true); assert.equal(result.status, 303); assert.match(result.headers.get('location'), /pending=id/);
});

test('LAN HTTP clipboard fallback sends manually pasted text without a clipboard API', async t => {
  let sent;
  const w = page(t, async (url, options) => {
    if (url === '/.clipboard.txt' && options?.method === 'PUT') sent = options.body;
    return { ok: true, json: async () => ({ entries: [] }) };
  }, 'http://192.168.1.2:4567/ui/');
  w.document.getElementById('clipPaste').click(); await tick();
  assert.equal(w.document.getElementById('clipManual').hidden, false);
  w.document.getElementById('clipText').value = 'manual LAN clipboard';
  w.document.getElementById('clipSendText').click(); await tick();
  assert.equal(sent, 'manual LAN clipboard');
  assert.equal(w.document.getElementById('clipSub').textContent, 'Text sent');
});
test('LAN clipboard load preserves shared text for manual copy when the API is unavailable', async t => {
  const w = page(t, async url => ({ ok: true, json: async () => ({ entries: [] }), text: async () => 'shared <text>' }), 'http://192.168.1.2:4567/ui/');
  w.document.getElementById('clipCopy').click(); await tick();
  assert.equal(w.document.getElementById('clipManual').hidden, false);
  assert.equal(w.document.getElementById('clipText').value, 'shared <text>');
  assert.match(w.document.getElementById('clipSub').textContent, /Select and copy/);
});
