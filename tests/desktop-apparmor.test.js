'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { desktopProfile } = require('../scripts/desktop-apparmor');

test('desktop policy grants user namespaces to one quoted executable path', () => {
  const executable = "/home/user's files/Downloads/app (1)/Airdrop";
  const profile = desktopProfile(executable);
  assert.ok(profile.includes(`"${executable}" flags=(unconfined)`));
  assert.match(profile, /abi <abi\/4\.0>,/);
  assert.match(profile, /\n  userns,\n/);
  assert.equal(profile, desktopProfile(executable));
  assert.notEqual(profile, desktopProfile('/home/another/Airdrop'));
});

test('desktop policy rejects relative paths, globs and policy injection', () => {
  for (const executable of ['relative/Airdrop', '/home/*/Airdrop', '/home/?/Airdrop', '/home/[ab]/Airdrop', '/home/{a,b}/Airdrop', '/home/"/Airdrop', '/home/\\/Airdrop', '/home/\n/Airdrop', '/home/\0/Airdrop']) {
    assert.throws(() => desktopProfile(executable), /unsupported AppArmor/);
  }
});
