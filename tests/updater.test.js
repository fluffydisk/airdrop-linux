'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const updater = require('../lib/updater');
const maintenance = require('../lib/maintenance');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['app/server', 'files', 'config', 'state']) await fs.mkdir(path.join(root, dir), { recursive: true });
  await fs.writeFile(path.join(root, 'app/server/package.json'), '{"version":"1.4.0"}');
  await fs.writeFile(path.join(root, 'files/user.txt'), 'USER DATA'); await fs.writeFile(path.join(root, 'config/server.env'), 'SECRET');
  await fs.writeFile(path.join(root, 'state/runtime.json'), JSON.stringify({ node: process.execPath }));
  return root;
}
async function packageFixture(t, { corrupt = false, unsafe = false } = {}) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries({ 'app/server/package.json': '{"version":"1.5.0"}', 'app/server/push-server.js': '// server', 'app/ui/index.html': 'new UI', 'app/desktop/Airdrop': 'binary' })) zip.file(name, data, { unixPermissions: name.endsWith('Airdrop') ? 0o100755 : 0o100644 });
  if (unsafe) zip.file('app/../../outside', 'ESCAPE');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
  const name = 'airdrop-linux-x64-1.5.0.zip';
  const base = 'https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/';
  const manifest = { version: '1.5.0', minimumNode: '18.0.0', packages: { x64: { name, size: bytes.length, sha256: corrupt ? '0'.repeat(64) : crypto.createHash('sha256').update(bytes).digest('hex') } } };
  const release = { tag_name: 'v1.5.0', assets: [{ name: 'airdrop-update.json', browser_download_url: base + 'airdrop-update.json' }, { name, size: bytes.length, browser_download_url: base + name }] };
  const server = http.createServer((req, res) => {
    if (req.url.includes('/releases/latest')) res.end(JSON.stringify(release));
    else if (req.url.endsWith('airdrop-update.json')) res.end(JSON.stringify(manifest));
    else if (req.url.endsWith('.zip')) res.end(bytes);
    else { res.statusCode = 404; res.end(); }
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const fetcher = (url, options) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
  return { release, manifest, fetcher };
}
test('stable checks use numeric versions, handle no releases and reject mismatched architectures', async t => {
  const { fetcher, release } = await packageFixture(t);
  assert.equal(updater.newer('1.10.0', '1.9.9'), true);
  assert.equal((await updater.check('1.4.0', { fetcher, arch: 'x64' })).status, 'available');
  assert.equal((await updater.check('1.5.0', { fetcher })).status, 'current');
  assert.equal((await updater.check('1.4.0', { fetcher: async () => new Response('', { status: 404 }) })).status, 'current');
  await assert.rejects(updater.check('1.4.0', { fetcher, arch: 'arm64' }), /CPU/);
  release.prerelease = true; assert.equal((await updater.check('1.4.0', { fetcher })).status, 'current');
});
test('portable updates expose the matching AppImage download without changing full-application update metadata', async t => {
  const { fetcher, manifest, release } = await packageFixture(t);
  const name = 'Airdrop-1.5.0-x86_64.AppImage';
  manifest.appImages = { x64: { name, size: 123, sha256: 'a'.repeat(64) } };
  release.assets.push({ name, size: 123, browser_download_url: 'https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/' + name });
  const update = await updater.check('1.4.0', { fetcher, arch: 'x64' });
  assert.equal(update.appImage.name, name); assert.match(update.package.name, /\.zip$/);
  manifest.appImages.x64.name = 'wrong.AppImage';
  await assert.rejects(updater.check('1.4.0', { fetcher, arch: 'x64' }), /AppImage/);
});
test('verified update replaces the complete app and preserves data and an old-version backup', async t => {
  const root = await fixture(t), { fetcher } = await packageFixture(t);
  const release = await updater.check('1.4.0', { fetcher, arch: 'x64' });
  const prepared = await updater.prepare(root, release, { fetcher }); const calls = [];
  await updater.activate(root, prepared, { relaunch: false, control: async action => calls.push(action), health: async () => {} });
  assert.deepEqual(calls, ['stop', 'start']);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'app/server/package.json'))).version, '1.5.0');
  assert.equal(await fs.readFile(path.join(root, 'files/user.txt'), 'utf8'), 'USER DATA');
  assert.equal(await fs.readFile(path.join(root, 'config/server.env'), 'utf8'), 'SECRET');
  const journal = await updater.readJournal(root); assert.equal(journal.phase, 'complete');
  assert.equal(JSON.parse(await fs.readFile(path.join(journal.backup, 'server/package.json'))).version, '1.4.0');
  assert.equal((await fs.stat(path.join(root, 'app/desktop/Airdrop'))).mode & 0o777, 0o755);
  await assert.rejects(fs.access(updater.statePaths(root).marker));
});
test('corrupt downloads and unsafe ZIP entries never replace the app', async t => {
  for (const options of [{ corrupt: true }, { unsafe: true }]) {
    const root = await fixture(t), { fetcher } = await packageFixture(t, options);
    const release = await updater.check('1.4.0', { fetcher, arch: 'x64' });
    await assert.rejects(updater.prepare(root, release, { fetcher }), /checksum|Unsafe/);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'app/server/package.json'))).version, '1.4.0');
    assert.equal((await fs.readdir(root)).some(name => name.startsWith('.app-update-')), false);
  }
});
test('health failure rolls back and denied authorization preserves the original app', async t => {
  for (const denied of [false, true]) {
    const root = await fixture(t), { fetcher } = await packageFixture(t);
    const prepared = await updater.prepare(root, await updater.check('1.4.0', { fetcher, arch: 'x64' }), { fetcher });
    await assert.rejects(updater.activate(root, prepared, { relaunch: false, control: async () => { if (denied) throw new Error('Authorization canceled'); }, health: async () => { throw new Error('health failed'); } }), /Authorization|health/);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'app/server/package.json'))).version, '1.4.0');
    assert.equal((await updater.readJournal(root)).phase, 'rolled-back');
    await assert.rejects(fs.access(updater.statePaths(root).marker));
  }
});
test('recovery restores a backup after interruption between directory replacements', async t => {
  const root = await fixture(t); const id = crypto.randomUUID(); const stage = await fs.mkdtemp(path.join(root, '.app-update-'));
  const backup = path.join(root, 'backups', `app-${id}`); await fs.mkdir(path.dirname(backup)); await fs.rename(path.join(root, 'app'), backup);
  await fs.mkdir(path.join(root, 'state/updates'), { recursive: true });
  await fs.writeFile(updater.statePaths(root).journal, JSON.stringify({ id, root, stage, backup, phase: 'stopped' }));
  await fs.writeFile(updater.statePaths(root).marker, JSON.stringify({ pid: 2147483647 }));
  const calls = []; assert.equal(await updater.recover(root, { control: async action => calls.push(action) }), true);
  assert.deepEqual(calls, ['stop', 'start']); assert.equal((await updater.readJournal(root)).phase, 'rolled-back');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'app/server/package.json'))).version, '1.4.0');
});
test('maintenance denies new mutations and drains existing leases before activation', async t => {
  const root = await fixture(t); const release = await maintenance.acquire(root);
  await fs.writeFile(updater.statePaths(root).marker, '{}');
  await assert.rejects(maintenance.acquire(root), /updating/);
  await assert.rejects(maintenance.drain(root, 5), /Transfers/);
  await release(); await maintenance.drain(root, 5);
  await fs.unlink(updater.statePaths(root).marker);
  const next = await maintenance.acquire(root); await next();
});
