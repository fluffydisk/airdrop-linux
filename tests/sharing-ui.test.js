'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises');
const { JSDOM } = require('jsdom');
const flush = () => new Promise(resolve => setImmediate(resolve));
test('Transfer queues files until Send and browser fallback never copies them to a workspace or native peer', async t => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only', url: 'https://local.test' });
  t.after(() => dom.window.close()); const w = dom.window, calls = [];
  w.airdrop = {
    onStatus() {}, status: async () => ({ status: 'ready' }), settings: async () => ({}),
    onShowFiles() {}, onUpdate() {}, update: async () => ({}), explore: async () => [],
    choose: async () => ['/selected.txt'], describe: async () => [{ path: '/selected.txt', name: 'selected.txt', size: 4 }],
    send: async (...args) => { calls.push(['workspace', args]); return []; },
    sharing: async (action, payload) => { calls.push([action, payload]); return { status: 'connection-required', message: 'Choose a connection.' }; }
  };
  w.eval(await fs.readFile('ui/explorer.js', 'utf8'));
  w.eval(await fs.readFile('desktop/renderer.js', 'utf8'));
  w.eval(await fs.readFile('desktop/sharing-ui.js', 'utf8'));
  w.document.getElementById('choose').click(); await flush();
  assert.equal(w.document.querySelectorAll('#files li').length, 1); assert.deepEqual(calls, []);
  w.document.getElementById('sendDestination').value = 'guest';
  w.document.getElementById('sendDestination').dispatchEvent(new w.Event('change'));
  w.document.getElementById('send').click(); await flush();
  assert.equal(calls[0][0], 'invitation-start'); assert.equal(calls[0][1].direction, 'send');
  assert.deepEqual(Array.from(calls[0][1].sources), ['/selected.txt']);
  assert.equal(calls.some(([action]) => action === 'workspace' || action === 'send'), false);
  assert.equal(w.document.getElementById('invitationReady').hidden, true);
  assert.equal(w.document.getElementById('invitationConnections').hidden, false);
  w.document.getElementById('invitationInternet').click(); await flush();
  assert.equal(calls.at(-1)[1].provider, 'internet');
  w.document.getElementById('clearFiles').click();
  const count = calls.length; w.document.getElementById('invitationInternet').click(); await flush();
  assert.equal(calls.length, count, 'clearing the queue cannot accidentally reshare old paths');
});
