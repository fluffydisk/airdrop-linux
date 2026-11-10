'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
test('a failed browser launch closes its fixture services and exits without a CI hang', () => {
  const env = { ...process.env, CHROMIUM_PATH: '/nonexistent-airdrop-browser-fixture' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', 'tests/browser.cjs'], {
    env, encoding: 'utf8', timeout: 10000
  });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /executable.*doesn.t exist|doesn.t exist at|nonexistent-airdrop-browser-fixture/i);
});
