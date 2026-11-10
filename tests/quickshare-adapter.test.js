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
  const data = { id: 'transfer1', phase: 'awaiting-acceptance', direction: 'incoming', files: ['photo.txt'], name: 'Android', total: 5, bytes: 0, pinCode: '1234' };
  await adapter.request('fixture', data);
  await until(async () => (await adapter.request('decision')).accept === true);
  assert.deepEqual(await fs.readdir(adapter.inbox), []);
  const directory = path.join(adapter.staging, 'a'.repeat(32)); await fs.mkdir(directory);
  const source = path.join(directory, 'photo.txt'); await fs.writeFile(source, 'PHOTO');
  await adapter.request('fixture', { ...data, phase: 'complete', bytes: 5, stagedPaths: [source] });
  await until(() => adapter.transfers.get(data.id)?.phase === 'complete');
  assert.equal(await fs.readFile(path.join(adapter.inbox, 'photo.txt'), 'utf8'), 'PHOTO');
  await adapter.request('fixture', { ...data, phase: 'complete', bytes: 5, stagedPaths: [source] }); await adapter.events;
  assert.deepEqual(await fs.readdir(adapter.inbox), ['photo.txt']);
  const history = await fs.readFile(path.join(adapter.directory, 'history.json'), 'utf8');
  assert.equal(history.includes('1234'), false); assert.equal(history.includes(adapter.staging), false);
});
test('a forged completion without consent cannot publish a file or grant persistent trust', async t => {
  const adapter = await fixture(t);
  await adapter.request('fixture', { id: 'forged', phase: 'complete', direction: 'incoming', total: 0, stagedPaths: ['/etc/passwd'] });
  await until(() => adapter.status === 'error');
  assert.deepEqual(await fs.readdir(adapter.inbox), []);
  assert.equal(adapter.snapshot().capabilities.persistentTrust || false, false);
});
