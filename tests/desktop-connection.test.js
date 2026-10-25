'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { workspaceUrl, checkConnection } = require('../desktop/connection');

test('workspace address requires Tailscale HTTPS without credentials or nonstandard ports', () => {
  assert.equal(workspaceUrl('https://device.tail.ts.net/other?secret=x#fragment'), 'https://device.tail.ts.net/ui/');
  for (const input of ['', 'bad', 'http://device.tail.ts.net', 'https://example.com', 'https://ts.net',
    'https://user:password@device.tail.ts.net', 'https://device.tail.ts.net:8443', 'https://device.tail.ts.net.example.com']) {
    assert.throws(() => workspaceUrl(input), /Tailscale HTTPS/);
  }
});

test('unconfigured address does not make a network request', async () => {
  const result = await checkConnection('', () => { throw new Error('Must not request'); });
  assert.equal(result.status, 'not-configured');
  assert.match(result.message, /Local files and clipboard/);
});

test('controlled successful health response verifies reachability, not another device', async () => {
  const result = await checkConnection('https://device.tail.ts.net/ui/', async (url, options) => {
    assert.equal(url, 'https://device.tail.ts.net/push/health');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ push: true, share: true });
  });
  assert.equal(result.status, 'reachable');
  assert.match(result.message, /another device is not verified/);
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
});

for (const [name, response] of [
  ['HTTP error', () => new Response('', { status: 503 })],
  ['partial backend', () => Response.json({ push: true, share: false })],
  ['unrelated service', () => Response.json({ ok: true })],
  ['invalid JSON', () => new Response('<html>Login</html>')],
  ['DNS failure', () => { throw new Error('ENOTFOUND'); }],
  ['TLS failure', () => { throw new Error('CERT_HAS_EXPIRED'); }],
  ['timeout', () => { throw new DOMException('Timed out', 'TimeoutError'); }],
  ['redirect rejected', () => { throw new TypeError('fetch failed'); }]
]) {
  test(`controlled ${name} keeps the local workspace available`, async () => {
    const result = await checkConnection('https://device.tail.ts.net/ui/', response);
    assert.equal(result.status, 'unreachable');
    assert.match(result.message, /Local files and clipboard are still available/);
    assert.match(result.message, /Tailscale Serve/);
  });
}

test('invalid saved address is rejected before transport', async () => {
  const result = await checkConnection('https://example.com', () => { assert.fail('Invalid target requested'); });
  assert.equal(result.status, 'unreachable');
});
