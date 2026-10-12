'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Readable } = require('node:stream');
const JSZip = require('jszip');
const { createServer, validSubscription } = require('../push-server');
const { publishStream } = require('../lib/files');
const { sendFiles } = require('../lib/transfer');
const { createZip, MAX_ZIP_BYTES } = require('../ui/zip');
const sub = endpoint => ({ endpoint: `https://push.example/${endpoint}`, keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } });
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-test-'));
  const share = path.join(root, 'share'); await fs.mkdir(share);
  const service = createServer({ watchDir: share, stateDir: root, watch: false, logger: { warn() {}, error() {} }, ...options });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const request = (route, body) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { root, share, service, url, request };
}
test('raw upload publishes complete bytes and concurrent conflicts never overwrite', async t => {
  const { share, url } = await fixture(t);
  const names = await Promise.all(['first', 'second'].map(async value => {
    const response = await fetch(url + '/files/' + encodeURIComponent('ü,a.json'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: value });
    assert.equal(response.status, 201); return (await response.json()).name;
  }));
  assert.equal(new Set(names).size, 2);
  assert.deepEqual(new Set(await Promise.all(names.map(name => fs.readFile(path.join(share, name), 'utf8')))), new Set(['first', 'second']));
  assert.deepEqual((await fs.readdir(share)).sort(), names.sort());
});
test('unsafe paths, hidden files and archive symlinks are rejected', async t => {
  const { root, share, url, request } = await fixture(t);
  await fs.writeFile(path.join(root, 'secret'), 'private');
  await fs.symlink(path.join(root, 'secret'), path.join(share, 'link'));
  for (const name of ['../secret', '.clipboard.txt', 'ui', 'a/b', 'a\\b']) {
    const response = await fetch(url + '/files/' + encodeURIComponent(name), { method: 'PUT', body: 'bad' });
    assert.ok([400, 404].includes(response.status), name);
    assert.equal((await request('/archive', { files: [name] })).status, 400);
  }
  assert.equal((await request('/archive', { files: ['link'] })).status, 400);
  assert.equal(await fs.readFile(path.join(root, 'secret'), 'utf8'), 'private');
});
test('streamed ZIP, form download, preflight and missing file validation', async t => {
  const { share, request, url } = await fixture(t);
  const files = ['ü,a.txt', 'two.txt'];
  for (const name of files) await fs.writeFile(path.join(share, name), name);
  const response = await request('/archive', { files });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /airdrop-\d{8}-\d{6}\.zip/);
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  for (const name of files) assert.equal(await zip.file(name).async('string'), name);
  assert.deepEqual(await (await request('/archive', { files, validateOnly: true })).json(), { ok: true });
  const form = await fetch(url + '/archive', { method: 'POST', body: new URLSearchParams({ files: JSON.stringify(files) }) });
  assert.equal(form.status, 200); await form.arrayBuffer();
  for (const names of [[], ['two.txt', 'two.txt']]) assert.equal((await request('/archive', { files: names })).status, 400);
  const missing = await request('/archive', { files: ['two.txt', 'gone.txt'] });
  assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type'), /json/);
});
test('failed and aborted writes clean staging and never publish', async t => {
  const { share, url } = await fixture(t);
  async function* broken() { yield 'half'; throw new Error('connection lost'); }
  await assert.rejects(publishStream(share, 'broken.txt', Readable.from(broken())));
  assert.deepEqual(await fs.readdir(share), []);
  await new Promise(resolve => {
    const req = http.request(url + '/files/aborted.txt', { method: 'PUT', headers: { 'Content-Length': 100000 } });
    req.on('error', resolve); req.write('half'); setTimeout(() => req.destroy(), 30);
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(await fs.readdir(share), []);
});
test('health and cross-origin writes', async t => {
  const { url, share } = await fixture(t);
  assert.deepEqual(await (await fetch(url + '/health')).json(), { push: true, share: true });
  assert.equal((await fetch(url + '/files/test.txt', { method: 'PUT', headers: { Origin: 'https://other.example' }, body: 'x' })).status, 403);
  await fs.rm(share, { recursive: true });
  assert.equal((await fetch(url + '/health')).status, 503);
});
test('push validates subscriptions, preserves temporary failures, removes only expired', async t => {
  const { request, service } = await fixture(t, { sendNotification: async current => { throw { statusCode: current.endpoint.endsWith('gone') ? 410 : 503 }; } });
  assert.equal(validSubscription({ endpoint: 'http://bad' }), false);
  assert.equal((await request('/subscribe', { endpoint: 'bad' })).status, 400);
  for (const name of ['temporary', 'gone']) assert.equal((await request('/subscribe', sub(name))).status, 201);
  await service.notifyAll({ fileName: 'a' });
  assert.deepEqual(service.getSubscriptions().map(s => s.endpoint), [sub('temporary').endpoint]);
});
test('subscription added/refreshed during dispatch survives and dispatches serialize', async t => {
  let release; let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { service } = await fixture(t, { sendNotification: async () => { if (++calls === 1) { await gate; throw { statusCode: 404 }; } } });
  service.subscribe(sub('first'));
  const first = service.notifyAll({ fileName: 'a' });
  await new Promise(resolve => setImmediate(resolve));
  service.subscribe(sub('first')); service.subscribe(sub('new'));
  const second = service.notifyAll({ fileName: 'b' });
  release(); await Promise.all([first, second]);
  assert.equal(service.getSubscriptions().length, 2); assert.equal(calls, 3);
});
test('scan waits for stable signatures, detects modifications and delete/recreate', async t => {
  const delivered = [];
  const { share, service } = await fixture(t, { stableMs: 100, sendNotification: async (s, data) => delivered.push(JSON.parse(data)) });
  service.subscribe(sub('device'));
  const file = path.join(share, '__proto__');
  await fs.writeFile(file, 'a'); service.scan(0); service.scan(50); assert.equal(delivered.length, 0);
  await fs.writeFile(file, 'longer'); service.scan(60); service.scan(159); assert.equal(delivered.length, 0);
  service.scan(160); await service.idle(); assert.equal(delivered.length, 1); assert.equal(delivered[0].size, 6);
  await fs.rm(file); service.scan(170); await fs.writeFile(file, 'a'); service.scan(180); service.scan(280);
  await service.idle(); assert.equal(delivered.length, 2);
});
test('JSZip duplicate names, empty selection and 100 MiB boundary', async () => {
  const archive = await createZip([{ name: 'a.txt', size: 1, data: 'a' }, { name: 'a.txt', size: 1, data: 'b' }, { name: 'a (1).txt', size: 1, data: 'c' }], 'nodebuffer');
  const zip = await JSZip.loadAsync(archive.data);
  assert.deepEqual(Object.keys(zip.files), ['a.txt', 'a (1).txt', 'a (1) (1).txt']);
  assert.equal(await zip.file('a (1).txt').async('string'), 'b');
  await assert.rejects(createZip([]), /Select/);
  await assert.rejects(createZip([{ name: 'big', size: MAX_ZIP_BYTES + 1 }]), /100 MiB/);
  // Advertised size exactly at the threshold is accepted before ZIP generation.
  assert.ok((await createZip([{ name: 'boundary', size: MAX_ZIP_BYTES, data: 'x' }], 'nodebuffer')).data.length);
});
test('local multi-file transfer, ZIP and symlink rejection', async t => {
  const { root, share } = await fixture(t);
  const a = path.join(root, 'a.txt'); await fs.writeFile(a, 'payload');
  const results = await sendFiles(share, [a, a]);
  assert.deepEqual(results.map(r => r.name), ['a.txt', 'a (1).txt']);
  const zipped = await sendFiles(share, [a, a], true);
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(share, zipped[0].name)));
  assert.equal(await zip.file('a (1).txt').async('string'), 'payload');
  const link = path.join(root, 'link'); await fs.symlink(a, link);
  assert.equal((await sendFiles(share, [link]))[0].ok, false);
  const big = path.join(root, 'big'); const handle = await fs.open(big, 'w'); await handle.truncate(MAX_ZIP_BYTES + 1); await handle.close();
  await assert.rejects(sendFiles(share, [big], true), /100 MiB/);
});

test('cancelled archive stream releases sources and subsequent downloads work', async t => {
  const { share, request } = await fixture(t);
  const file = await fs.open(path.join(share, 'large.bin'), 'w'); await file.truncate(16 * 1024 * 1024); await file.close();
  const response = await request('/archive', { files: ['large.bin'] });
  assert.equal(response.status, 200);
  await response.body.cancel();
  await fs.writeFile(path.join(share, 'next.txt'), 'next');
  const next = await request('/archive', { files: ['next.txt'] });
  assert.equal(next.status, 200);
  const archive = await JSZip.loadAsync(Buffer.from(await next.arrayBuffer()));
  assert.equal(await archive.file('next.txt').async('string'), 'next');
});
