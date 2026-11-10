'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { SharingBroker } = require('../lib/sharing/broker');
const { ShareGateway } = require('../lib/device-share');
const { Devices } = require('../lib/devices');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sharing-broker-'));
  const devices = new Devices({ directory: root, guestRoot: root });
  devices.preferences = {};
  const connections = [];
  // Controlled provider fixture: public verification is separately tested by
  // Devices. The real HTTP gateway and guest capability are exercised here.
  devices.action = async mode => {
    await devices.stop();
    devices.gateway = new ShareGateway({ guestRoot: root });
    await devices.gateway.listen();
    devices.state = { mode, status: 'checking' }; connections.push(mode);
  };
  const nearby = { snapshot: async () => ({ devices: [], incoming: [], outgoing: [] }), send: async (...args) => args };
  const broker = new SharingBroker({ nearby, devices, pollInterval: 5, invitationTimeout: 100 });
  t.after(async () => { await broker.stopInvitation(); await devices.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const source = path.join(root, 'selected.txt'); await fs.writeFile(source, 'selected');
  return { broker, devices, source, connections };
}
test('empty discovery exposes an invitation without starting an unsolicited connection', async t => {
  const { broker, source, connections } = await fixture(t);
  assert.deepEqual((await broker.snapshot()).recipients, []);
  assert.equal((await broker.startInvitation({ sources: [source] })).status, 'connection-required');
  assert.equal(connections.length, 0);
});
test('explicit fallback waits for verification and grants downloads without workspace or upload access', async t => {
  const { broker, devices, source } = await fixture(t);
  await broker.startInvitation({ sources: [source], provider: 'internet' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(broker.invitationSnapshot().status, 'preparing');
  assert.throws(() => broker.invitationLink(), /fresh verified/);
  devices.state.status = 'ready'; await broker.task;
  const invitation = broker.invitationSnapshot();
  assert.equal(invitation.status, 'ready');
  assert.equal('session' in invitation, false); assert.equal('gateway' in invitation, false);
  const url = new URL(broker.invitationLink()), headers = { Authorization: 'Bearer ' + url.hash.slice(1), Origin: url.origin };
  const info = await (await fetch(url.origin + '/guest/session', { method: 'POST', headers })).json();
  assert.equal(info.allowUploads, false);
  assert.equal(await (await fetch(url.origin + '/guest/download/' + info.files[0].id, { headers })).text(), 'selected');
  assert.equal((await fetch(url.origin + '/guest/upload?name=unexpected', { method: 'PUT', headers, body: 'bad' })).status, 403);
  assert.equal((await fetch(url.origin + '/push/health', { headers })).status, 401);
  await broker.stopInvitation();
  assert.equal((await fetch(url.origin + '/guest/session', { method: 'POST', headers })).status, 403);
});
test('provider changes, replaced sessions and expiry retire invitation capabilities', async t => {
  const { broker, devices, source } = await fixture(t);
  await devices.action('lan'); devices.state.status = 'ready';
  await broker.startInvitation({ sources: [source] }); await broker.task;
  const first = broker.invitationLink();
  await devices.startGuest([]);
  assert.equal(broker.invitationSnapshot().status, 'expired');
  assert.throws(() => broker.invitationLink(), /fresh/);
  await broker.startInvitation({ sources: [source] }); await broker.task;
  assert.notEqual(broker.invitationLink(), first);
  devices.gateway.guest.session.expires = 0;
  broker.now = () => Number.MAX_SAFE_INTEGER;
  assert.equal(broker.invitationSnapshot().status, 'expired');
});
test('cancelling during verification leaves no guest session and another provider stops preparation', async t => {
  const { broker, devices, source } = await fixture(t);
  await broker.startInvitation({ sources: [source], provider: 'internet' });
  await broker.stopInvitation();
  assert.equal(broker.invitationSnapshot().status, 'idle');
  assert.equal(devices.gateway?.guest.session || null, null);
  await broker.startInvitation({ sources: [source], provider: 'internet' });
  await new Promise(resolve => setTimeout(resolve, 10));
  devices.generation++; await broker.task;
  assert.equal(broker.invitationSnapshot().status, 'error');
});
