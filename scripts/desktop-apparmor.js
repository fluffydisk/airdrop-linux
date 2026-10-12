'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');

function desktopProfile(executable) {
  // Reject policy syntax rather than accidentally granting access to a glob.
  if (!path.isAbsolute(executable) || /[\x00-\x1f\x7f"\\*?\[\]{}^]/.test(executable)) {
    throw new Error('Desktop executable path contains unsupported AppArmor policy characters.');
  }
  const name = 'airdrop-desktop-' + createHash('sha256').update(executable).digest('hex');
  return `# Allow Chromium's sandbox on Ubuntu with restricted user namespaces.
abi <abi/4.0>,
include <tunables/global>
profile ${name} "${executable}" flags=(unconfined) {
  userns,
}
`;
}

if (require.main === module) {
  try { process.stdout.write(desktopProfile(process.argv[2] || '')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { desktopProfile };
