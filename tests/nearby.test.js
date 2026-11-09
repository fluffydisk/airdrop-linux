'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { Nearby, code } = require('../lib/nearby');
const { CHUNK, hash } = require('../lib/peer-store');
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-nearby-'));
  const make = (name, extra) => new Nearby({ directory: path.join(root, name), inbox: path.join(root, name, 'inbox'), name, discovery: false, host: '127.0.0.1', approve: async () => true, ...extra });
  const a = await make('Alice').initialize(), b = await make('Bob', options).initialize();
  t.after(async () => { await a.stop(); await b.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const connect = () => { a.peers.set(b.id, { id: b.id, name: b.name, address: '127.0.0.1', addresses: ['127.0.0.1'], port: b.port, online: true }); b.peers.set(a.id, { id: a.id, name: a.name, address: '127.0.0.1', addresses: ['127.0.0.1'], port: a.port, online: true }); };
  connect(); return { a, b, root, connect };
}
test('two independent TLS instances pair, transfer Unicode/empty/duplicate files and persist trust', async t => {
  const { a, b, root, connect } = await fixture(t);
  assert.equal(code(a.id, b.id), code(b.id, a.id));
  await a.pair(b.id);
  const source = path.join(root, 'hello ü.txt'); await fs.writeFile(source, crypto.randomBytes(CHUNK + 17));
  const empty = path.join(root, 'empty'); await fs.writeFile(empty, '');
  const result = await a.send(b.id, [source, empty, source]);
  assert.equal(result.status, 'complete', result.error);
  const inbox = await fs.readdir(b.store.inbox); assert.equal(inbox.length, 3); assert.ok(inbox.includes('hello ü (1).txt'));
  assert.deepEqual(await fs.readFile(path.join(b.store.inbox, 'hello ü.txt')), await fs.readFile(source));
  const id = b.id; await b.stop(); await b.initialize(); connect();
  assert.equal(b.id, id); assert.ok(b.settings.trusted[a.id]); assert.equal(b.settings.trusted[a.id].autoAccept, false);
  assert.equal((await a.snapshot()).outgoing[0].sources, undefined);
  assert.equal((await b.store.history())[0].status, 'complete');
  await a.configure({ id: b.id, forget: true }); await assert.rejects(a.send(b.id, [source]), /Pair/);
});
test('decline and unpaired devices cannot create transfers; certificate mismatch is rejected', async t => {
  const { a, b, root } = await fixture(t, { approve: async () => false });
  await assert.rejects(a.pair(b.id), /declined/);
  await assert.rejects(a.request(a.peers.get(b.id), '/transfers/' + 'a'.repeat(32), { files: [] }), /Pair/);
  await assert.rejects(a.request({ ...a.peers.get(b.id), id: 'a'.repeat(64) }, '/hello'), /identity changed/);
  assert.deepEqual(await fs.readdir(path.join(root, 'Bob', 'incoming')), []);
});
test('interruption resumes verified chunks after receiver restart and repairs stored corruption', async t => {
  const { a, b, root, connect } = await fixture(t); await a.pair(b.id);
  const source = path.join(root, 'large'); await fs.writeFile(source, crypto.randomBytes(CHUNK * 3 + 5));
  let interrupted = false;
  a.on('progress', s => { if (!interrupted && s.bytes >= CHUNK) { interrupted = true; a.cancel(s.id); } });
  const first = await a.send(b.id, [source]); assert.equal(first.status, 'cancelled');
  const chunkFile = path.join(b.store.location(first.id), '0-0'); await fs.writeFile(chunkFile, 'corrupt');
  await b.stop(); await b.initialize(); connect();
  let uploads = 0; const chunk = b.store.chunk.bind(b.store); b.store.chunk = (...args) => { uploads++; return chunk(...args); };
  const retry = await a.send(b.id, [], first.id); assert.equal(retry.status, 'complete', retry.error); assert.equal(uploads, 4);
  assert.equal(hash(await fs.readFile(path.join(b.store.inbox, 'large'))), hash(await fs.readFile(source)));
  uploads = 0; const again = await a.send(b.id, [], first.id); assert.equal(again.status, 'complete'); assert.equal(uploads, 0);
});
test('chunk tampering, wrong peer, invalid metadata, disk full, concurrent writes and decline are explicit', async t => {
  const { a, b } = await fixture(t); await a.pair(b.id);
  const id = '1'.repeat(32), files = [{ name: 'x', size: 3, hash: hash(Buffer.from('abc')) }];
  await b.store.create(id, a.id, files, async () => true);
  await assert.rejects(b.store.chunk(id, a.id, 0, 0, Buffer.from('bad'), files[0].hash), /integrity/);
  await assert.rejects(b.store.read(id, 'other'), /another device/);
  await assert.rejects(b.store.finish(id, a.id, 0), /Missing chunk/);
  await assert.rejects(b.store.create('2'.repeat(32), a.id, [{ ...files[0], name: '../bad' }], async () => true), /metadata/);
  await assert.rejects(b.store.create('3'.repeat(32), a.id, files, async () => false), /declined/);
  const statfs = fs.statfs; fs.statfs = async () => ({ bavail: 0, bsize: 1 });
  try { await assert.rejects(b.store.create('4'.repeat(32), a.id, files, async () => true), /disk space/); } finally { fs.statfs = statfs; }
  const writes = await Promise.allSettled([b.store.chunk(id, a.id, 0, 0, Buffer.from('abc'), files[0].hash), b.store.chunk(id, a.id, 0, 0, Buffer.from('abc'), files[0].hash)]);
  assert.equal(writes.filter(s => s.status === 'fulfilled').length, 1);
  await b.store.cancel(id, a.id); await assert.rejects(b.store.read(id, a.id), /cancelled/);
});
test('discovery deduplicates identity, filters unsafe addresses and recovers address changes', async t => {
  const { a, b } = await fixture(t);
  a.peers.clear(); a.refresh = async () => {};
  const s = { txt: { id: b.id, name: 'Same name', v: '1' }, addresses: ['8.8.8.8', '127.0.0.1', '192.168.1.2'], port: 1234 };
  a.discovered(s); a.discovered({ ...s, addresses: ['10.0.0.8'], port: 4567 });
  assert.equal(a.peers.size, 1); assert.deepEqual(a.peers.get(b.id).addresses, ['10.0.0.8']);
  a.discovered({ ...s, txt: { ...s.txt, id: a.id } }); assert.equal(a.peers.size, 1);
});
test('real DNS-SD multicast discovers two running services and transfers without entered addresses', { timeout: 20000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-mdns-'));
  const a = new Nearby({ directory: path.join(root, 'a'), inbox: path.join(root, 'a-inbox'), name: 'Same friendly name', approve: async () => true });
  const b = new Nearby({ directory: path.join(root, 'b'), inbox: path.join(root, 'b-inbox'), name: 'Same friendly name', approve: async () => true });
  t.after(async () => { await a.stop(); await b.stop(); await fs.rm(root, { recursive: true, force: true }); });
  await a.initialize(); await b.initialize();
  const deadline = Date.now() + 15000;
  while ((!a.peers.get(b.id)?.online || !b.peers.get(a.id)?.online) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(a.peers.get(b.id)?.online, true, a.discoveryError || 'DNS-SD did not discover receiver');
  await a.pair(b.id);
  const source = path.join(root, 'multicast.txt'); await fs.writeFile(source, 'real discovery and TLS');
  const result = await a.send(b.id, [source]); assert.equal(result.status, 'complete', result.error);
  await b.stop(); await a.refresh(); assert.equal(a.peers.get(b.id).online, false);
  await b.start();
  const restored = Date.now() + 10000;
  while (!a.peers.get(b.id)?.online && Date.now() < restored) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(a.peers.get(b.id)?.online, true, 'peer did not recover its changed listening port');
});
test('valid completed files and chunks survive sender/receiver restart without retransmission', async t => {
  const { a, b, root, connect } = await fixture(t); await a.pair(b.id);
  const first = path.join(root, 'first.txt'), large = path.join(root, 'large.bin');
  await fs.writeFile(first, 'already complete'); await fs.writeFile(large, crypto.randomBytes(CHUNK * 3));
  let stopped = false;
  const interrupt = s => { if (!stopped && s.currentFile === 'large.bin' && s.fileBytes >= CHUNK) { stopped = true; a.cancel(s.id); } };
  a.on('progress', interrupt);
  const sent = await a.send(b.id, [first, large]); assert.equal(sent.status, 'cancelled');
  a.removeListener('progress', interrupt); await a.stop(); await b.stop(); await a.initialize(); await b.initialize(); connect();
  let uploaded = 0; const chunk = b.store.chunk.bind(b.store); b.store.chunk = (...args) => { uploaded += args[4].length; return chunk(...args); };
  const resumed = await a.send(b.id, [], sent.id); assert.equal(resumed.status, 'complete', resumed.error);
  assert.equal(uploaded, 2 * CHUNK); assert.equal((await fs.readdir(b.store.inbox)).length, 2);
});
test('two concurrent transfers are bounded, receive permission is opt-in and forgetting revokes access', async t => {
  const { a, b, root } = await fixture(t); await a.pair(b.id);
  let approvals = 0; b.approve = async () => { approvals++; return true; };
  const source = path.join(root, 'file'); await fs.writeFile(source, crypto.randomBytes(CHUNK));
  const results = await Promise.all([a.send(b.id, [source]), a.send(b.id, [source])]);
  assert.ok(results.every(r => r.status === 'complete')); assert.equal(approvals, 2);
  await b.configure({ id: a.id, autoAccept: true }); await a.send(b.id, [source]); assert.equal(approvals, 2);
  await b.configure({ id: a.id, forget: true }); const rejected = await a.send(b.id, [source]); assert.equal(rejected.status, 'interrupted'); assert.match(rejected.error, /Pair/);
  await a.configure({ concurrency: 1 }); assert.equal((await a.snapshot()).concurrency, 1);
  await assert.rejects(a.configure({ concurrency: 5 }), /1–4/);
  await a.configure({ enabled: false }); assert.equal(a.server, null); assert.equal((await a.snapshot()).enabled, false);
});
test('large files above the workspace ZIP limit transfer as bounded chunks with verified stored bytes', { timeout: 60000 }, async t => {
  const { a, b, root } = await fixture(t); await a.pair(b.id);
  const source = path.join(root, 'large.dat'), file = await fs.open(source, 'w'); await file.truncate(101 * CHUNK + 9); await file.close();
  const started = Date.now(); const sent = await a.send(b.id, [source]);
  assert.equal(sent.status, 'complete', sent.error); assert.equal(sent.bytes, 101 * CHUNK + 9);
  assert.equal((await fs.stat(path.join(b.store.inbox, 'large.dat'))).size, sent.bytes);
  console.log(`Large-file integration: ${sent.bytes} bytes, ${Date.now() - started} ms (same-host test, not a physical-network benchmark)`);
});
