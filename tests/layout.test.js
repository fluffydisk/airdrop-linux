'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Readable } = require('node:stream');
const { getPaths } = require('../lib/paths');
const { prepare, commit, envValues } = require('../scripts/migrate-layout');
const { createServer } = require('../push-server');
const { createGateway } = require('../lib/gateway');
const { publishStream } = require('../lib/files');
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-layout-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return getPaths({ home, dataHome: path.join(home, '.local/share'), root: path.join(home, 'airdrop') });
}
test('unified layout migrates files, collisions, clipboard, credentials and desktop preferences without losing originals', async t => {
  const p = await fixture(t);
  for (const directory of [p.legacyShare, p.legacyServer, p.legacyDesktop, p.legacyDesktopData, p.files]) await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(path.join(p.legacyShare, 'ui')); await fs.writeFile(path.join(p.legacyShare, 'ui/index.html'), 'old UI');
  await fs.writeFile(path.join(p.legacyShare, 'ü,a.txt'), 'original');
  await fs.writeFile(path.join(p.files, 'ü,a.txt'), 'existing');
  await fs.writeFile(path.join(p.legacyShare, '.clipboard.txt'), 'clipboard');
  await fs.writeFile(path.join(p.legacyServer, '.env'), 'VAPID_PUBLIC_KEY=public\nVAPID_PRIVATE_KEY=private\nWATCH_DIR=old\n');
  await fs.writeFile(path.join(p.legacyServer, 'subscriptions.json'), JSON.stringify([{ endpoint: 'https://push.example/a', keys: {} }]));
  await fs.writeFile(path.join(p.legacyDesktopData, 'settings.json'), '{"pwaUrl":"https://test.ts.net/ui/"}');
  await prepare(p); await prepare(p);
  assert.equal(await fs.readFile(path.join(p.files, 'ü,a (1).txt'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(p.files, 'ü,a.txt'), 'utf8'), 'existing');
  assert.equal(await fs.readFile(path.join(p.files, '.clipboard.txt'), 'utf8'), 'clipboard');
  assert.equal((await fs.readdir(p.files)).includes('ui'), false);
  assert.equal(await fs.readFile(path.join(p.legacyShare, 'ü,a.txt'), 'utf8'), 'original');
  const env = envValues(await fs.readFile(p.env, 'utf8'));
  assert.equal(env.VAPID_PRIVATE_KEY, 'private'); assert.equal(env.WATCH_DIR, p.files);
  assert.equal((await fs.stat(p.env)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(path.join(p.desktopData, 'settings.json'))).pwaUrl, 'https://test.ts.net/ui/');
  assert.equal(JSON.parse(await fs.readFile(path.join(p.pushState, 'subscriptions.json'))).length, 1);
  await commit(p); await commit(p); await prepare(p);
  await assert.rejects(fs.access(p.legacyShare), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(p.backups, 'legacy/shared-folder/ü,a.txt'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(p.backups, 'legacy/push-server/.env'), 'utf8'), 'VAPID_PUBLIC_KEY=public\nVAPID_PRIVATE_KEY=private\nWATCH_DIR=old\n');
});
test('migration refuses conflicting identities, links, live desktop and changed data without removing sources', async t => {
  const p = await fixture(t);
  await fs.mkdir(p.legacyServer, { recursive: true }); await fs.mkdir(p.config, { recursive: true });
  await fs.writeFile(path.join(p.legacyServer, '.env'), 'VAPID_PUBLIC_KEY=one\nVAPID_PRIVATE_KEY=one');
  await fs.writeFile(p.env, 'VAPID_PUBLIC_KEY=two\nVAPID_PRIVATE_KEY=two');
  await assert.rejects(prepare(p), /Conflicting VAPID/);
  await fs.rm(p.env); await fs.mkdir(p.legacyShare);
  await fs.symlink(p.env, path.join(p.legacyShare, 'link'));
  await assert.rejects(prepare(p), /symbolic links/);
  await fs.rm(path.join(p.legacyShare, 'link')); await fs.writeFile(path.join(p.legacyShare, 'a'), 'first');
  await prepare(p); await fs.writeFile(path.join(p.legacyShare, 'new'), 'added after preparation');
  await assert.rejects(commit(p), /data changed/); await fs.rm(path.join(p.legacyShare, 'new'));
  await fs.writeFile(path.join(p.legacyShare, 'a'), 'changed');
  await assert.rejects(commit(p), /data changed/); await fs.access(p.legacyShare);
  await fs.mkdir(p.legacyDesktopData, { recursive: true }); await fs.symlink(`host-${process.pid}`, path.join(p.legacyDesktopData, 'SingletonLock'));
  await assert.rejects(prepare(p), /Quit Airdrop/);
});
test('clearing shared files preserves UI/API/config/state; gateway never writes application files', async t => {
  const p = await fixture(t); await prepare(p);
  await fs.writeFile(p.env, 'secret'); await fs.writeFile(path.join(p.ui, 'index.html'), 'APPLICATION UI');
  const service = createServer({ watchDir: p.files, stateDir: p.pushState, watch: false });
  // A minimal backend stands in for dufs; the gateway must forward streaming PUT and DELETE.
  const backend = http.createServer(async (req, res) => {
    const name = decodeURIComponent(req.url.slice(1));
    if (req.method === 'PUT') { await publishStream(p.files, name, req); res.end('saved'); }
    else if (req.method === 'DELETE') { await fs.rm(path.join(p.files, name)); res.end('deleted'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await fs.readdir(p.files))); }
  });
  backend.listen(0, '127.0.0.1'); await new Promise(resolve => backend.once('listening', resolve));
  const gateway = createGateway({ api: service.app, uiDir: p.ui, fileServer: `http://127.0.0.1:${backend.address().port}` }).listen(0, '127.0.0.1');
  await new Promise(resolve => gateway.once('listening', resolve));
  t.after(async () => { service.close(); for (const server of [gateway, backend]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
  const url = `http://127.0.0.1:${gateway.address().port}`;
  assert.equal((await fetch(url + '/user.txt', { method: 'PUT', body: 'user data' })).status, 200);
  assert.equal((await fetch(url + '/user.txt', { method: 'DELETE' })).status, 200);
  assert.equal(await (await fetch(url + '/ui/')).text(), 'APPLICATION UI');
  for (const method of ['PUT', 'DELETE', 'POST']) assert.equal((await fetch(url + '/ui/index.html', { method, body: 'bad' })).status, 405);
  assert.equal((await fetch(url + '/push/health')).status, 200);
  await fs.access(p.env); assert.deepEqual(await fs.readdir(p.files), []);
  await fs.rm(p.files, { recursive: true });
  await publishStream(p.files, 'back.txt', Readable.from('recovered'));
  assert.equal(await fs.readFile(path.join(p.files, 'back.txt'), 'utf8'), 'recovered');
});
test('real dufs gateway isolates system files and preserves clipboard and empty-folder operation', async t => {
  const { spawn, execFileSync } = require('node:child_process');
  try { execFileSync('dufs', ['--version'], { stdio: 'ignore' }); } catch { t.skip('dufs is not installed'); return; }
  const p = await fixture(t); await prepare(p);
  await fs.writeFile(path.join(p.ui, 'index.html'), 'ISOLATED UI'); await fs.writeFile(p.env, 'PRIVATE CONFIG');
  const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await new Promise(resolve => reserve.once('listening', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const child = spawn('dufs', [p.files, '--bind', '127.0.0.1', '--port', String(port), '--allow-upload', '--allow-delete', '--allow-search', '--allow-archive', '--render-try-index', '--hidden', '.airdrop-*'], { stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed; } });
  const service = createServer({ watchDir: p.files, stateDir: p.pushState, watch: false });
  const server = createGateway({ api: service.app, uiDir: p.ui, fileServer: `http://127.0.0.1:${port}` }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (let attempt = 0; attempt < 50; attempt++) { try { if ((await fetch(base + '/?json')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal((await fetch(base + '/.clipboard.txt', { method: 'PUT', body: 'shared clipboard' })).status, 201);
  assert.equal(await (await fetch(base + '/.clipboard.txt')).text(), 'shared clipboard');
  assert.equal((await fetch(base + '/push/files/test.txt', { method: 'PUT', body: 'complete file' })).status, 201);
  for (const file of ['test.txt', '.clipboard.txt']) assert.equal((await fetch(base + '/' + file, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await (await fetch(base + '/?json')).json()).paths, []);
  assert.equal(await (await fetch(base + '/ui/')).text(), 'ISOLATED UI');
  assert.equal((await fetch(base + '/push/health')).status, 200);
  for (const route of ['/config/server.env', '/state/push/subscriptions.json', '/app/server/push-server.js', '/ui/.env']) assert.ok([403, 404].includes((await fetch(base + route)).status), route);
  assert.equal((await fetch(base + '/ui/index.html', { method: 'DELETE' })).status, 405);
  assert.equal(await fs.readFile(p.env, 'utf8'), 'PRIVATE CONFIG');
  child.kill(); await new Promise(resolve => child.once('exit', resolve));
  assert.equal((await fetch(base + '/?json')).status, 503);
  assert.equal(await (await fetch(base + '/ui/')).text(), 'ISOLATED UI');
  assert.equal((await fetch(base + '/push/health')).status, 200);
});

test('custom roots cannot recursively overlap a legacy source', () => {
  for (const root of ['/tmp/home', '/tmp/home/AirdropShare', '/tmp/home/AirdropShare/new']) assert.throws(() => getPaths({ home: '/tmp/home', dataHome: '/tmp/home/.local/share', root }), /legacy/);
  assert.equal(getPaths({ home: '/tmp/home', dataHome: '/tmp/home/.local/share', root: '/tmp/home/Airdrop' }).files, '/tmp/home/Airdrop/files');
});
