'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { QuickShare } = require('../lib/sharing/quickshare');
async function fixture(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quickshare-ipc-'));
  const helper = path.resolve('tests/fixtures/quickshare-helper.cjs');
  const adapter = new QuickShare({ enabled: true, directory, inbox: path.join(directory, 'inbox'), helper,
    sha256: crypto.createHash('sha256').update(await fs.readFile(helper)).digest('hex'),
    spawnProcess: () => spawn(process.execPath, [helper], { stdio: ['pipe', 'pipe', 'pipe'] }), ...extra });
  t.after(async () => { await adapter.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  await adapter.start(); return adapter;
}
async function until(check) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail('Timed out waiting for helper'); }
test('disabled Quick Share never starts a helper and a mismatched binary is rejected', async () => {
  const disabled = new QuickShare({ spawnProcess: () => assert.fail('Disabled adapter spawned a helper') });
  assert.equal((await disabled.start()).status, 'disabled');
  const adapter = new QuickShare({ enabled: true, helper: __filename, sha256: '0'.repeat(64) });
  await assert.rejects(adapter.start(), /verification failed/);
});
test('bounded history evicts old terminal records while retaining active transfers', () => {
  const adapter = new QuickShare();
  for (let i = 0; i < 100; i++) adapter.transfers.set(String(i), { id: String(i), phase: 'transferring', created: i });
  assert.throws(() => adapter.makeRoom('next'), /active Quick Share/);
  adapter.transfers.get('0').phase = 'complete'; adapter.makeRoom('next');
  assert.equal(adapter.transfers.has('0'), false); assert.equal(adapter.transfers.size, 99);
  assert.equal(adapter.transfers.get('1').phase, 'transferring');
});
test('verified helper has bounded IPC and its crash invalidates pending operations', async t => {
  const adapter = await fixture(t);
  assert.equal(adapter.snapshot().status, 'ready');
  assert.equal(adapter.snapshot().capabilities.direct, false);
  await assert.rejects(adapter.request('too-large', { data: 'x'.repeat(65536) }), /too large/);
  await adapter.request('crash'); await until(() => adapter.status === 'error');
  assert.equal(adapter.child, null); assert.equal(adapter.recipients.size, 0);
});
test('a broken helper input pipe fails pending requests without an unhandled stream error', async t => {
  const adapter = await fixture(t);
  const result = adapter.request('pending');
  adapter.child.stdin.emit('error', Object.assign(Error('broken pipe'), { code: 'EPIPE' }));
  await assert.rejects(result, /disconnected/);
  assert.equal(adapter.status, 'error');
  assert.equal(adapter.requests.size, 0);
  await until(() => adapter.child === null);
});
test('only consented, complete, privately staged regular files are published; duplicate completion cannot overwrite', async t => {
  const adapter = await fixture(t, { approve: async request => { assert.equal(request.code, '1234'); return true; } });
  const directory = path.join(adapter.staging, 'a'.repeat(32)), source = path.join(directory, 'photo.txt');
  const data = { id: 'transfer1', phase: 'awaiting-acceptance', direction: 'incoming', files: ['photo.txt'], name: 'Android', total: 5, bytes: 0, pinCode: '1234', stagedPaths: [source] };
  await adapter.request('fixture', data);
  await until(async () => (await adapter.request('decision')).accept === true);
  assert.deepEqual(await fs.readdir(adapter.inbox), []);
  await fs.mkdir(directory); await fs.writeFile(source, 'PHOTO');
  await adapter.request('fixture', { ...data, phase: 'complete', bytes: 5, stagedPaths: [source] });
  await until(() => adapter.transfers.get(data.id)?.phase === 'complete');
  await adapter.events;
  assert.equal(await fs.readFile(path.join(adapter.inbox, 'photo.txt'), 'utf8'), 'PHOTO');
  await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  await adapter.request('fixture', { ...data, phase: 'complete', bytes: 5, stagedPaths: [source] }); await adapter.events;
  assert.deepEqual(await fs.readdir(adapter.inbox), ['photo.txt']);
  const history = await fs.readFile(path.join(adapter.directory, 'history.json'), 'utf8');
  assert.equal(history.includes('1234'), false); assert.equal(history.includes(adapter.staging), false);
});
test('cancellation cleans only the recorded private staging directory and a late accept cannot revive it', async t => {
  let decide;
  const adapter = await fixture(t, { approve: () => new Promise(resolve => { decide = resolve; }) });
  const directory = path.join(adapter.staging, 'b'.repeat(32)), source = path.join(directory, 'partial.txt');
  const data = { id: 'cancelled1', phase: 'awaiting-acceptance', direction: 'incoming', files: ['partial.txt'], total: 20, pinCode: '1234', stagedPaths: [source] };
  await adapter.request('fixture', data); await until(() => decide);
  await fs.mkdir(directory); await fs.writeFile(source, 'partial');
  await adapter.request('fixture', { ...data, phase: 'cancelled' });
  await until(() => adapter.transfers.get(data.id)?.phase === 'cancelled'); await adapter.events;
  decide(true); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(adapter.inbox), []);
  assert.equal((await adapter.request('decision')).accept, undefined);
  assert.equal(adapter.accepted.has(data.id), false);
});
test('helper crash removes abandoned staging without following symlinks or deleting unrelated files', async t => {
  const adapter = await fixture(t);
  const outside = path.join(adapter.directory, 'unrelated'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
  await fs.symlink(outside, path.join(adapter.staging, 'c'.repeat(32)));
  const abandoned = path.join(adapter.staging, 'd'.repeat(32)); await fs.mkdir(abandoned); await fs.writeFile(path.join(abandoned, 'partial.txt'), 'partial');
  await fs.writeFile(path.join(adapter.staging, 'unrelated.txt'), 'retain');
  await adapter.request('crash'); await until(() => adapter.child === null); await adapter.events;
  assert.deepEqual(await fs.readdir(adapter.staging), ['unrelated.txt']);
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});
test('a helper cannot change the consented receive paths or total before publication', async t => {
  const adapter = await fixture(t, { approve: async () => true });
  const source = path.join(adapter.staging, 'e'.repeat(32), 'photo.txt');
  const data = { id: 'changed1', phase: 'awaiting-acceptance', direction: 'incoming', files: ['photo.txt'], total: 5, pinCode: '1234', stagedPaths: [source] };
  await adapter.request('fixture', data); await until(async () => (await adapter.request('decision')).accept === true);
  await adapter.request('fixture', { ...data, phase: 'complete', total: 4 });
  await until(() => adapter.status === 'error');
  assert.deepEqual(await fs.readdir(adapter.inbox), []);
});
test('a forged completion without consent cannot publish a file or grant persistent trust', async t => {
  const adapter = await fixture(t);
  await adapter.request('fixture', { id: 'forged', phase: 'complete', direction: 'incoming', total: 0, stagedPaths: ['/etc/passwd'] });
  await until(() => adapter.status === 'error');
  assert.deepEqual(await fs.readdir(adapter.inbox), []);
  assert.equal(adapter.snapshot().capabilities.persistentTrust || false, false);
});
