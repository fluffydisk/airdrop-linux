'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { JSDOM } = require('jsdom');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t) {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://local.test' });
  t.after(() => dom.window.close());
  const w = dom.window;
  return { w, get: id => w.document.getElementById(id) };
}
test('workspace sends distinct files by default and applies ZIP choice at send time', async t => {
  const { w, get } = await fixture(t);
  const sent = [];
  w.airdrop = {
    onStatus() {}, status: async () => ({ label: 'Ready', status: 'ready' }),
    settings: async () => ({}), explore: async () => [], onShowFiles() {},
    onUpdate() {}, update: async () => ({ status: 'current', current: '1.9.1' }),
    choose: async () => ['/tmp/a.txt', '/tmp/b.txt'],
    describe: async paths => paths.map(path => ({ path, name: path.split('/').pop(), size: 10 })),
    send: async (paths, zip) => { sent.push({ paths: Array.from(paths), zip }); return paths.map(name => ({ ok: true, name })); }
  };
  w.eval(await fs.readFile('ui/explorer.js', 'utf8'));
  w.eval(await fs.readFile('desktop/renderer.js', 'utf8'));
  get('choose').click(); await flush();
  assert.equal(get('zip').checked, false);
  get('send').click(); await flush();
  assert.deepEqual(sent[0], { paths: ['/tmp/a.txt', '/tmp/b.txt'], zip: false });
  get('choose').click(); await flush();
  get('zip').checked = true; get('zip').dispatchEvent(new w.Event('change'));
  get('send').click(); await flush();
  assert.equal(sent[1].zip, true, 'ZIP choice made after selection is respected');
  get('choose').click(); await flush();
  get('zip').checked = false; get('zip').dispatchEvent(new w.Event('change'));
  get('send').click(); await flush();
  assert.equal(sent[2].zip, false, 'unchecking ZIP after selection sends separate files');
  w.document.querySelector('[data-view="native-sharing"]').click();
  assert.equal(get('view-native-sharing').hidden, false);
  assert.equal(get('view-transfer').hidden, true);
});
test('native mode starts the helper, lists only available Quick Share recipients and sends selected files on device click', async t => {
  const { w, get } = await fixture(t);
  const calls = [];
  get('view-native-sharing').hidden = false;
  const quickShare = { enabled: true, status: 'stopped', name: 'Development laptop', bluetooth: { bleAdvertising: true },
    recipients: [{ id: 'quick-share:phone', name: 'Galaxy', availability: 'available' }, { id: 'quick-share:offline', name: 'Offline', availability: 'checking' }], transfers: [] };
  let progress, verification;
  w.airdrop = {
    sharing: async (action, payload) => {
      calls.push({ action, payload });
      if (action === 'state') return { quickShare };
      if (action === 'native-start') { quickShare.mode = payload.mode; quickShare.status = 'ready'; return quickShare; }
      if (action === 'send') return { transferId: 'transfer-id' };
      if (action === 'native-stop') { quickShare.status = 'stopped'; return quickShare; }
    },
    choose: async () => { calls.push({ action: 'choose' }); return ['/tmp/a.txt', '/tmp/b.txt']; },
    describe: async paths => paths.map(path => ({ path, name: path.split('/').pop(), size: 10 })),
    onPeerProgress: fn => { progress = fn; },
    onSharingVerification: fn => { verification = fn; }
  };
  w.eval(await fs.readFile('desktop/native-sharing-ui.js', 'utf8'));
  await flush();
  get('nativeReceive').click(); await flush();
  assert.equal(get('nativeReceivePanel').hidden, false);
  assert.equal(get('nativeSendPanel').hidden, true);
  assert.match(get('nativeReceiveStatus').textContent, /Bluetooth advertising is registered/);
  assert.match(get('nativeDeviceName').textContent, /Development laptop/);
  assert.equal(get('nativeRecipients').querySelectorAll('button').length, 0);
  get('nativeSend').click(); await flush();
  assert.equal(get('nativeReceivePanel').hidden, true);
  assert.equal(get('nativeSendPanel').hidden, false);
  const recipients = get('nativeRecipients').querySelectorAll('button');
  assert.equal(recipients.length, 2); assert.equal(recipients[1].disabled, true);
  assert.equal(get('nativeFiles').children.length, 2);
  const sendDiscovery = calls.findIndex(call => call.action === 'native-start' && call.payload.mode === 'send');
  assert.ok(calls.findIndex(call => call.action === 'choose') < sendDiscovery);
  assert.deepEqual(Array.from(calls[sendDiscovery].payload.sources), ['/tmp/a.txt', '/tmp/b.txt']);
  get('nativeRecipients').querySelector('button').click(); await flush();
  const send = calls.find(call => call.action === 'send');
  assert.equal(send.payload.recipientId, 'quick-share:phone');
  assert.deepEqual(Array.from(send.payload.sources), ['/tmp/a.txt', '/tmp/b.txt']);
  assert.equal(get('nativeChoose').disabled, true);
  verification({ id: 'transfer-id', code: '1234', name: 'Galaxy' });
  assert.match(get('nativeResult').textContent, /1234/);
  progress({ id: 'transfer-id', transport: 'quick-share', phase: 'complete' });
  await flush();
  assert.equal(get('nativeFiles').children.length, 0);
  assert.match(get('nativeResult').textContent, /complete/i);
  get('nativeReceive').click(); await flush();
  w.dispatchEvent(new w.Event('nearby-share-leave')); await flush();
  assert.equal(get('nativeReceivePanel').hidden, true);
  assert.doesNotMatch(get('nativeResult').textContent, /1234/);
  assert.equal(calls.filter(call => call.action === 'native-start').length, 3);
  assert.equal(calls.filter(call => call.action === 'native-stop').length, 1);
});

test('cancelling the picker or leaving while it is open never starts discovery', async t => {
  const { w, get } = await fixture(t);
  get('view-native-sharing').hidden = false;
  const calls = [];
  let finish;
  w.airdrop = {
    sharing: async action => { calls.push(action); return { quickShare: { enabled: true, status: 'stopped' } }; },
    choose: () => new Promise(resolve => { finish = resolve; }),
    describe: () => assert.fail('A stale selection must not reach the adapter')
  };
  w.eval(await fs.readFile('desktop/native-sharing-ui.js', 'utf8')); await flush();
  get('nativeSend').click(); finish([]); await flush();
  assert.equal(calls.includes('native-start'), false);
  get('nativeSend').click();
  w.dispatchEvent(new w.Event('nearby-share-leave'));
  finish(['/tmp/file.txt']); await flush();
  assert.equal(calls.includes('native-start'), false);
});

test('unsupported Quick Share offers no discovery controls', async t => {
  const { w, get } = await fixture(t);
  w.airdrop = { sharing: async () => ({ quickShare: { enabled: false, status: 'disabled' } }) };
  w.eval(await fs.readFile('desktop/native-sharing-ui.js', 'utf8')); await flush();
  assert.equal(get('nativeReceive').disabled, true);
  assert.equal(get('nativeSend').disabled, true);
  assert.match(get('view-native-sharing').textContent, /Apple AirDrop is unavailable/);
});
