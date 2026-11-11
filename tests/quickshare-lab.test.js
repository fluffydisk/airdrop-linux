'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { Evidence, openLab, atomicJson } = require('../lib/sharing/lab-evidence');
const { prepareFixtures, hashDirectory, fixtureNames } = require('../scripts/quickshare-lab/fixtures.cjs');
const { createReport, observations, timeline } = require('../scripts/quickshare-lab/report.cjs');
const { parse } = require('../scripts/quickshare-android-lab.cjs');
test('preflight drains a helper reply delivered after process exit; missing/truncated replies fail closed', async () => {
  const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
  const { readHello } = require('../scripts/quickshare-lab/environment.cjs');
  for (const valid of [true, false]) {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => {};
    const reply = readHello(child, { hashMatches: true });
    child.emit('exit', 0);
    await new Promise(resolve => setImmediate(resolve));
    child.stdout.write(valid ? JSON.stringify({ v: 1, id: 'lab-preflight', result: { protocol: 1, version: '0.1.0', capabilities: {} } }) + '\n' : '{"v":');
    child.emit('close', 0);
    assert.equal((await reply).hello, valid);
  }
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 's24-lab-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  atomicJson(root, 'lab.json', { schema: 1, repository: await fs.realpath(process.cwd()), run: 'a'.repeat(32), commit: 'b'.repeat(40), helperSha256: 'c'.repeat(64), helperVersion: '0.1.0' });
  return root;
}
test('lab fixtures are deterministic, small, real images, and never overwrite changed files', async t => {
  const root = await fixture(t), dir = path.join(root, 'fixtures');
  const a = await prepareFixtures(dir), b = await prepareFixtures(dir); assert.deepEqual(a, b);
  assert.equal(Object.keys(a).length, fixtureNames.length);
  assert.ok(Object.values(a).reduce((n, v) => n + v.size, 0) < 3 * 1024 * 1024);
  assert.equal((await fs.readFile(path.join(dir, 'lab-image.png'))).subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([...(await fs.readFile(path.join(dir, 'lab-image.jpg'))).subarray(0, 2)], [255, 216]);
  assert.equal((await hashDirectory(dir, a)).checked.every(f => f.result === 'match'), true);
  await fs.writeFile(path.join(dir, 'lab-small.txt'), 'changed');
  await assert.rejects(prepareFixtures(dir), /Existing fixture differs/);
});
test('readback hashes only fixture names and refuses symlinks without reading targets', async t => {
  const root = await fixture(t), manifest = await prepareFixtures(path.join(root, 'fixtures'));
  const dir = path.join(root, 'readback'); await fs.mkdir(dir);
  await fs.writeFile(path.join(root, 'personal-secret'), 'DO NOT READ ME');
  await fs.symlink(path.join(root, 'personal-secret'), path.join(dir, 'lab-small.txt'));
  await fs.writeFile(path.join(dir, 'personal-name.jpg'), 'private');
  await fs.copyFile(path.join(root, 'fixtures/lab-empty.bin'), path.join(dir, 'lab-empty (1).bin'));
  const result = await hashDirectory(dir, manifest);
  assert.equal(result.checked.length, 1); assert.equal(result.checked[0].fixture, 'lab-empty.bin'); assert.equal(result.checked[0].result, 'match');
  assert.equal(JSON.stringify(result).includes('personal'), false);
});
test('lab observer bounds/coalesces evidence and never stores identity, PIN or filenames', () => {
  const e = new Evidence('a'.repeat(32));
  e.state({ status: 'error', error: '/private/home/10.0.0.2 PIN 1234', capabilities: { lan: true, secret: 'secret' }, recipients: [{ name: 'PRIVATE NAME' }] });
  for (let bytes = 0; bytes < 10000; bytes++) e.transfer({ id: 'secret-id-10.0.0.2', direction: 'incoming', phase: 'transferring', pinCode: '1234', files: ['personal.png'], bytes });
  assert.ok(e.value.events.length <= 3);
  e.protocol({ id: 'secret-id-10.0.0.2', direction: 'incoming', protocolStage: 'SentUkeyServerInit', pinCode: '1234', raw: '/private/path' });
  assert.equal(e.value.events.at(-1).stage, 'SentUkeyServerInit');
  const count = e.value.events.length;
  e.protocol({ id: 'private', direction: 'incoming', protocolStage: '1234' }); assert.equal(e.value.events.length, count);
  for (let i = 0; i < 3000; i++) e.verification(); assert.equal(e.value.events.length, 2000); assert.equal(e.value.truncated, true);
  const json = JSON.stringify(e.value); for (const v of ['1234', '10.0.0.2', 'PRIVATE', '/private', 'personal', 'secret-id']) assert.equal(json.includes(v), false);
});
test('discovery failure is separate from untested authentication and transfer; report strips tampered raw fields', async t => {
  const root = await fixture(t); await prepareFixtures(path.join(root, 'fixtures'));
  const env = { source: { commit: 'b'.repeat(40) }, helper: { capabilities: { lan: true, ble: false }, hashMatches: true }, versions: {}, system: {}, adapters: {}, services: {} };
  atomicJson(root, 'desktop-state.json', { run: 'a'.repeat(32), helper: { status: 'ready' }, events: [{ elapsedMs: 2, type: 'transfer', attempt: 'attempt-1', phase: 'connecting', direction: 'outgoing', raw: '10.0.0.2 PIN1234' }], pinCode: '1234', names: ['SECRET'] });
  const { report } = await createReport(root, env, { direction: 'samsung-to-linux', case: 'lab-small.txt', stages: { C: 'fail' }, notes: 'PRIVATE 10.0.0.2 1234' });
  assert.equal(report.stages.A.status, 'pass'); assert.equal(report.stages.C.status, 'fail'); assert.equal(report.stages.F.status, 'not-tested'); assert.equal(report.stages.H.status, 'not-tested');
  assert.equal(report.failure.category, 'DISCOVERY_UNAVAILABLE_BLE_NOT_IMPLEMENTED');
  assert.equal(report.productionAcceptanceEstablished, false);
  const json = JSON.stringify(report); for (const secret of ['10.0.0.2', '1234', 'SECRET', 'PRIVATE']) assert.equal(json.includes(secret), false);
});
test('integrity requires selected fixture readback, not a human yes or a completed phase', async t => {
  const root = await fixture(t); await prepareFixtures(path.join(root, 'fixtures'));
  const env = { source: { commit: 'b'.repeat(40) }, helper: { capabilities: {} }, versions: {}, system: {}, adapters: {}, services: {} };
  const input = { direction: 'linux-to-samsung', case: 'lab-small.txt', stages: { J: 'pass', I: 'pass' } };
  assert.equal(observations(input).stages.J, undefined);
  assert.equal((await createReport(root, env, input)).report.stages.J.status, 'not-tested');
  const dir = path.join(root, 'readback'); await fs.mkdir(dir); await fs.copyFile(path.join(root, 'fixtures/lab-small.txt'), path.join(dir, 'lab-small.txt'));
  assert.equal((await createReport(root, env, input, dir)).report.stages.J.status, 'pass');
});
test('lab launch rejects packaged apps and foreign/private directory violations', async t => {
  const root = await fixture(t);
  assert.throws(() => openLab({ directory: root, repository: process.cwd(), packaged: true, enabled: true }), /source desktop/);
  const lab = openLab({ directory: root, repository: process.cwd(), packaged: false, enabled: true }); assert.equal(lab.info().enabled, true);
  await fs.chmod(root, 0o755); assert.throws(() => openLab({ directory: root, repository: process.cwd(), packaged: false, enabled: true }), /private/);
});
test('lab CLI rejects ambiguous operations, invalid stages and invalid fixture selections', () => {
  assert.equal(parse(['--prepare', '--skip-install']).operation, 'prepare');
  assert.throws(() => parse(['--start', '--stop']), /one operation/);
  assert.throws(() => parse(['--collect', '--case', '../personal']), /generated fixture/);
});

test('report writes replace output links without following them; PIN-like version input is discarded', async t => {
  const root = await fixture(t); await prepareFixtures(path.join(root, 'fixtures'));
  await fs.mkdir(path.join(root, 'reports'), { mode: 0o700 });
  const privateFile = path.join(root, 'keep-private'); await fs.writeFile(privateFile, 'unchanged');
  await fs.symlink(privateFile, path.join(root, 'reports/quickshare-test-report.md'));
  const env = { source: { commit: 'b'.repeat(40) }, helper: { capabilities: {} }, versions: {}, system: {}, adapters: {}, services: {} };
  const { report } = await createReport(root, env, { phone: { androidVersion: '1234', quickShareVersion: '10.0.0.2' } });
  assert.equal(await fs.readFile(privateFile, 'utf8'), 'unchanged');
  assert.equal(report.observations.phone.androidVersion, 'unknown');
  assert.equal(report.observations.phone.quickShareVersion, 'unknown');
  assert.equal((await fs.lstat(path.join(root, 'reports/quickshare-test-report.md'))).isSymbolicLink(), false);
});

test('lab sends authorize generated fixture bytes only, never personal files or changed copies', async t => {
  const root = await fixture(t); await prepareFixtures(path.join(root, 'fixtures'));
  const lab = openLab({ directory: root, repository: process.cwd(), enabled: true, packaged: false });
  lab.authorizeSources([path.join(root, 'fixtures/lab-small.txt')]);
  const personal = path.join(root, 'personal.txt'); await fs.writeFile(personal, 'private contents');
  assert.throws(() => lab.authorizeSources([personal]), /generated files/);
  await fs.writeFile(path.join(root, 'fixtures/lab-small.txt'), 'changed');
  assert.throws(() => lab.authorizeSources([path.join(root, 'fixtures/lab-small.txt')]), /fixture changed|fixture hash changed/);
});


test('protocol diagnostics cannot trigger a consent prompt or forward extra helper data', () => {
  const { QuickShare } = require('../lib/sharing/quickshare');
  const adapter = new QuickShare({ protocolDiagnostics: true, approve: () => assert.fail('Diagnostic event requested consent') });
  let value; adapter.on('protocol', data => { value = data; });
  adapter.message({ v: 1, event: 'protocol', data: { id: 'diagnostic', direction: 'incoming', protocolStage: 'WaitingForUserConsent', pinCode: '1234', path: '/private/path' } }, adapter.generation);
  assert.equal(adapter.transfers.size, 0); assert.equal(adapter.confirming.size, 0);
  assert.deepEqual(value, { id: 'diagnostic', direction: 'incoming', protocolStage: 'WaitingForUserConsent' });
});

test('native BLE lab records registration and resolution separately and rejects identities in its report', () => {
  assert.equal(parse(['--prepare','--ble-native'])['ble-native'], true);
  const e = new Evidence('a'.repeat(32));
  e.state({ status: 'ready', capabilities: { ble: true, bleScanning: true, gattBootstrap: true, l2cap: true }, recipients: [], bluetooth: { stage: 'gatt-resolution-failed', gattBootstrap: true, bleAdvertising: true, mode: 'compact-gatt', observed: 5, decoded: 1, resolved: 0, address: 'PRIVATE MAC', pin: '1234', controller: { bluez: true, powered: true, extendedAdvertising: false, advertisingInstances: 1 } } });
  assert.equal(e.value.helper.bluetooth.mode, 'compact-gatt');
  assert.equal(e.value.helper.bluetooth.resolved, 0);
  const exported = timeline(e.value.events);
  assert.equal(exported.find(v => v.type === 'bluetooth').bluetooth.stage, 'gatt-resolution-failed');
  for (const secret of ['PRIVATE','1234']) assert.equal(JSON.stringify(exported).includes(secret), false);
});
