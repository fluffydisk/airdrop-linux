'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable, PassThrough } = require('node:stream');
const JSZip = require('jszip');
const explorer = require('../lib/explorer');
const { createServer } = require('../push-server');
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-explorer-'));
  const root = path.join(temp, 'files'); await fs.mkdir(root);
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return { temp, root };
}
async function bytes(stream) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); }
test('nested folders, uploads, copy, recursive download and persistent trash restore without overwriting', async t => {
  const { root } = await fixture(t);
  await explorer.mkdir(root, '', 'Belgeler'); await explorer.mkdir(root, 'Belgeler', 'İç');
  await explorer.upload(root, 'Belgeler/İç', 'ü,a.txt', Readable.from('İstanbul 👋'));
  assert.equal((await explorer.list(root, 'Belgeler/İç'))[0].path, 'Belgeler/İç/ü,a.txt');
  await explorer.copy(root, '', ['Belgeler'], 'Kopya');
  assert.equal(await fs.readFile(path.join(root, 'Kopya/Belgeler/İç/ü,a.txt'), 'utf8'), 'İstanbul 👋');
  assert.equal(await fs.readFile(path.join(root, 'Belgeler/İç/ü,a.txt'), 'utf8'), 'İstanbul 👋');
  const result = await explorer.download(root, ['Kopya']);
  const archive = await JSZip.loadAsync(await bytes(result.stream));
  assert.equal(await archive.file('Kopya/Belgeler/İç/ü,a.txt').async('string'), 'İstanbul 👋');
  const removed = await explorer.trash(root, ['Belgeler', 'Belgeler/İç']); assert.equal(removed.length, 1); assert.equal(removed[0].ok, true);
  assert.deepEqual((await explorer.list(root)).map(file => file.name), ['Kopya']);
  assert.equal((await explorer.trashList(root))[0].path, 'Belgeler');
  await explorer.mkdir(root, '', 'Belgeler');
  const restored = await explorer.restore(root, removed[0].id); assert.equal(restored.name, 'Belgeler (1)');
  assert.equal(await fs.readFile(path.join(root, restored.name, 'İç/ü,a.txt'), 'utf8'), 'İstanbul 👋');
  assert.equal((await explorer.trashList(root)).length, 0);
});
test('every explorer operation rejects root escapes and intermediate links', async t => {
  const { root, temp } = await fixture(t); const outside = path.join(temp, 'private'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret'), 'PRIVATE');
  await fs.symlink(outside, path.join(root, 'link')); await fs.writeFile(path.join(root, 'safe.txt'), 'safe');
  for (const unsafe of ['../private', '/etc', 'a/../b', 'a//b', 'link', 'link/sub', 'a\\b', '.airdrop-trash']) {
    await assert.rejects(explorer.list(root, unsafe));
    await assert.rejects(explorer.mkdir(root, unsafe, 'bad'));
    await assert.rejects(explorer.upload(root, unsafe, 'bad.txt', Readable.from('bad')));
    await assert.rejects(explorer.copy(root, unsafe, ['safe.txt'], 'bad'));
  }
  for (const unsafe of ['../private/secret', '/etc/passwd', 'link/secret', 'link']) {
    await assert.rejects(explorer.download(root, [unsafe]));
    await assert.rejects(explorer.copy(root, '', [unsafe], 'bad'));
  }
  await assert.rejects(explorer.trash(root, ['']));
  await assert.rejects(explorer.restore(root, '../private'));
  assert.equal(await fs.readFile(path.join(outside, 'secret'), 'utf8'), 'PRIVATE');
  assert.deepEqual(await fs.readdir(outside), ['secret']);
});
test('opening a file passes only a regular shared file to the system opener', async t => {
  const { root, temp } = await fixture(t);
  await explorer.mkdir(root, '', 'Belgeler');
  const file = path.join(root, 'Belgeler', 'İstanbul.txt'); await fs.writeFile(file, 'hello');
  const outside = path.join(temp, 'private.txt'); await fs.writeFile(outside, 'private');
  await fs.symlink(outside, path.join(root, 'link.txt'));
  await fs.symlink(path.dirname(outside), path.join(root, 'linked-folder'));
  const opened = [];
  const open = target => { opened.push(target); return 'opened'; };
  assert.equal(await explorer.openFile(root, 'Belgeler/İstanbul.txt', open), 'opened');
  assert.deepEqual(opened, [file]);
  for (const unsafe of ['', '../private.txt', outside, 'link.txt', 'linked-folder/private.txt', 'Belgeler', '.airdrop-trash/item', 'missing.txt']) {
    await assert.rejects(explorer.openFile(root, unsafe, open));
  }
  assert.deepEqual(opened, [file]);
  await assert.rejects(explorer.openFile(root, 'Belgeler/İstanbul.txt', () => { throw new Error('No application available'); }), /No application available/);
});
test('in-flight upload stays on its opened directory when its name becomes an outside symlink', async t => {
  const { root, temp } = await fixture(t); await explorer.mkdir(root, '', 'target');
  const outside = path.join(temp, 'outside'); await fs.mkdir(outside);
  const input = new PassThrough(); const pending = explorer.upload(root, 'target', 'race.txt', input);
  input.write('first');
  for (let i = 0; i < 100; i++) { if ((await fs.readdir(path.join(root, 'target'))).some(name => name.startsWith('.airdrop-'))) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  await fs.rename(path.join(root, 'target'), path.join(root, 'original'));
  await fs.symlink(outside, path.join(root, 'target')); input.end('last');
  await pending;
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal(await fs.readFile(path.join(root, 'original/race.txt'), 'utf8'), 'firstlast');
});
test('explorer HTTP routes preserve legacy routes and return direct files or recursive ZIPs', async t => {
  const { root, temp } = await fixture(t);
  const service = createServer({ watchDir: root, stateDir: path.join(temp, 'state'), watch: false });
  const server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(base + '/explorer' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/directories', { name: 'folder' })).status, 201);
  assert.equal((await fetch(base + '/explorer/file?directory=folder&name=test.txt', { method: 'PUT', body: 'hello' })).status, 201);
  assert.equal((await (await fetch(base + '/explorer?directory=folder')).json()).entries[0].name, 'test.txt');
  const direct = await fetch(base + '/explorer/download?path=folder%2Ftest.txt'); assert.equal(await direct.text(), 'hello');
  const zip = await post('/download', { paths: ['folder'] }); assert.ok((await JSZip.loadAsync(await zip.arrayBuffer())).file('folder/test.txt'));
  assert.equal((await fetch(base + '/files/legacy.txt', { method: 'PUT', body: 'legacy' })).status, 201);
  assert.equal((await fetch(base + '/explorer?directory=..%2Fprivate')).status, 400);
  assert.equal((await fetch(base + '/explorer?directory=missing')).status, 404);
});
test('nested arrivals notify their relative paths and trash is silent', async t => {
  const { root, temp } = await fixture(t); const notices = [];
  const service = createServer({ watchDir: root, stateDir: path.join(temp, 'state'), watch: false, stableMs: 10, sendNotification: async (sub, data) => notices.push(JSON.parse(data)) });
  t.after(service.close); service.subscribe({ endpoint: 'https://push.example', keys: {} });
  await explorer.mkdir(root, '', 'folder'); await explorer.upload(root, 'folder', 'new.txt', Readable.from('new'));
  service.scan(100); service.scan(111); await service.idle();
  assert.equal(notices[0].fileName, 'folder/new.txt');
  await explorer.trash(root, ['folder']); service.scan(120); service.scan(140); await service.idle(); assert.equal(notices.length, 1);
});
