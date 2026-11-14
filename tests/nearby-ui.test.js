'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises');
const { JSDOM } = require('jsdom');
test('nearby UI selects a paired receiver, exposes scoped auto-accept and resumes/cancels transfers accessibly', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  const state = { name: 'Laptop', enabled: true, concurrency: 2, devices: [{ id: 'abc', name: '<Phone>', online: true, trusted: true, autoAccept: false }], incoming: [], outgoing: [{ id: 'tx', peer: 'abc', status: 'interrupted', created: 1, files: [{ name: '<file>' }], bytes: 10, total: 20, error: 'Connection lost' }] };
  w.airdrop = { nearby: async (action, payload) => { calls.push([action, payload]); return state; } };
  w.eval(await fs.readFile('desktop/nearby-ui.js', 'utf8')); await new Promise(r => setImmediate(r));
  assert.equal(w.document.getElementById('sendDestination').value, 'abc');
  assert.equal(w.document.getElementById('nearbyDevices').querySelector('phone'), null);
  const permission = w.document.querySelector('#nearbyDevices input'); assert.equal(permission.checked, false); permission.click(); await new Promise(r => setImmediate(r));
  assert.equal(calls.some(([a, p]) => a === 'configure' && p.autoAccept === true && p.id === 'abc'), true);
  const retry = [...w.document.querySelectorAll('#peerTransfers button')].find(b => b.textContent === 'Retry / resume'); retry.click(); await new Promise(r => setImmediate(r));
  assert.equal(calls.some(([a, p]) => a === 'send' && p.retryId === 'tx'), true);
  assert.match(w.document.getElementById('peerTransfers').textContent, /10 B \/ 20 B/);
  assert.equal(w.document.querySelector('progress').getAttribute('aria-label'), 'Verified transfer bytes');
});
test('a selected device going offline never redirects queued files into the workspace', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const w = dom.window; let tick;
  w.setInterval = callback => { tick = callback; };
  const state = { name: 'Laptop', enabled: true, concurrency: 2, devices: [{ id: 'abc', name: 'Receiver', online: true, trusted: true }], incoming: [], outgoing: [] };
  w.airdrop = { nearby: async () => state };
  w.eval(await fs.readFile('desktop/nearby-ui.js', 'utf8')); await new Promise(r => setImmediate(r));
  assert.equal(w.document.getElementById('sendDestination').value, 'abc');
  state.devices[0].online = false; await tick();
  assert.equal(w.document.getElementById('sendDestination').value, 'abc');
  assert.match(w.document.getElementById('sendDestination').selectedOptions[0].textContent, /Offline/);
});
test('empty discovery keeps an explicit QR/link choice and does not automatically select an internet invitation', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const w = dom.window;
  w.airdrop = { nearby: async () => ({ devices: [], outgoing: [], incoming: [], enabled: true }) };
  w.eval(await fs.readFile('desktop/nearby-ui.js', 'utf8')); await new Promise(r => setImmediate(r));
  assert.equal(w.document.getElementById('sendDestination').value, '');
  assert.match(w.document.getElementById('nearbyStatus').textContent, /may limit/);
  w.document.getElementById('nearbyLink').click();
  assert.equal(w.document.getElementById('sendDestination').value, 'guest');
});
test('experimental Quick Share recipients have Send but no persistent trust or resume controls', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const w = dom.window;
  w.airdrop = { nearby: async () => {}, sharing: async () => ({ nearby: { name: 'Linux', enabled: true, devices: [], incoming: [], outgoing: [] }, quickShare: {
    enabled: true, recipients: [{ id: 'quick-share:10.0.0.2:123', name: 'Galaxy', availability: 'available' }], transfers: [{ id: 'session', name: 'Galaxy', direction: 'outgoing', phase: 'interrupted', files: ['photo.jpg'], transport: 'quick-share' }]
  } }) };
  w.eval(await fs.readFile('desktop/nearby-ui.js', 'utf8')); await new Promise(r => setImmediate(r));
  const row = w.document.querySelector('.nearby-device');
  assert.match(row.textContent, /Confirm each transfer/);
  assert.equal(row.querySelector('input[type=checkbox]'), null);
  assert.equal(w.document.getElementById('peerTransfers').textContent.includes('Retry / resume'), false);
  row.querySelector('button').click(); await new Promise(r => setImmediate(r));
  assert.equal(w.document.getElementById('sendDestination').value, 'quick-share:10.0.0.2:123');
});

test('Quick Share helper errors remain visible when Linux Nearby is off', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window;
  w.airdrop = { nearby: async () => {}, sharing: async () => ({ nearby: { enabled: false, devices: [], incoming: [], outgoing: [] }, quickShare: {
    enabled: true, status: 'error', error: 'The helper stopped.', recipients: [], transfers: []
  } }) };
  w.eval(await fs.readFile('desktop/nearby-ui.js', 'utf8')); await new Promise(r => setImmediate(r));
  assert.match(w.document.getElementById('nearbyStatus').textContent, /Quick Share unavailable: The helper stopped/);
});

test('sent bytes without receiver confirmation never render as successful completion', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window;
  w.airdrop = { nearby: async () => {}, sharing: async () => ({ nearby: { enabled: true, devices: [], incoming: [], outgoing: [] }, quickShare: {
    enabled: true, recipients: [], transfers: [{ id: 'sent', name: 'Phone', direction: 'outgoing', phase: 'outcome-unknown', files: ['photo.jpg'] }]
  } }) };
  w.eval(await fs.readFile('desktop/nearby-ui.js', 'utf8')); await new Promise(r => setImmediate(r));
  assert.match(w.document.getElementById('peerTransfers').textContent, /recipient completion unconfirmed/);
  assert.equal(w.document.getElementById('peerTransfers').textContent.includes('Retry / resume'), false);
});

test('decoded BLE peers stay visible with disabled send controls until a transport is available', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const w = dom.window;
  w.airdrop = { nearby: async () => {}, sharing: async () => ({ nearby: { enabled: false, devices: [], incoming: [], outgoing: [] }, quickShare: { enabled: true, recipients: [{ id: 'quick-share:ble-' + 'a'.repeat(32), name: 'Galaxy', availability: 'checking', connectable: false }], transfers: [] } }) };
  w.eval(await fs.readFile('desktop/nearby-ui.js', 'utf8')); await new Promise(r => setImmediate(r));
  assert.match(w.document.querySelector('.nearby-device').textContent, /Checking connection/);
  assert.equal(w.document.querySelector('.nearby-device button').disabled, true);
  const option = [...w.document.getElementById('sendDestination').options].find(v => v.value.startsWith('quick-share:'));
  assert.ok(option); assert.equal(option.disabled, true);
});
