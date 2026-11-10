'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { interfaces, candidates } = require('../lib/sharing/addresses');
const local = [
  { name: 'wlan0', address: '192.168.7.2', netmask: '255.255.255.0' },
  { name: 'campus', address: '128.6.10.2', netmask: '255.255.255.0' },
  { name: 'wlan0', address: 'fd12::2', netmask: 'ffff:ffff:ffff:ffff::' },
  { name: 'wlan0', address: 'fe80::2', netmask: 'ffff:ffff:ffff:ffff::' },
  { name: 'eth0', address: 'fe80::3', netmask: 'ffff:ffff:ffff:ffff::' }
];
test('on-link candidates support campus public IPv4 and reject off-link and special targets', () => {
  assert.deepEqual(candidates('192.168.7.3', local), ['192.168.7.3']);
  assert.deepEqual(candidates('128.6.10.12', local), ['128.6.10.12']);
  for (const address of ['192.168.8.3', '10.0.0.1', '8.8.8.8', '127.0.0.1', '0.0.0.0', '169.254.169.254', '224.0.0.251', '::ffff:127.0.0.1']) assert.deepEqual(candidates(address, local), [], address);
});
test('IPv6 link-local candidates carry the correct scope and cannot inject a zone', () => {
  assert.deepEqual(candidates('fd12::7', local), ['fd12::7']);
  assert.deepEqual(candidates('fd13::7', local), []);
  assert.deepEqual(candidates('fe80::7', local), ['fe80::7%wlan0', 'fe80::7%eth0']);
  assert.deepEqual(candidates('fe80::7%eth0', local), ['fe80::7%eth0']);
  for (const address of ['::1', 'ff02::fb', 'fe80::7%nonexistent', 'fe80::7%eth0%wlan0', 'fe80::7%../../bad']) assert.deepEqual(candidates(address, local), []);
});
test('default interfaces exclude internal networks and container/VPN devices', () => {
  const entry = { address: '192.168.7.2', family: 'IPv4', netmask: '255.255.255.0' };
  assert.deepEqual(interfaces({ eth0: [entry], docker0: [entry], tailscale0: [entry], lo: [{ ...entry, internal: true }] }).map(e => e.name), ['eth0']);
});
