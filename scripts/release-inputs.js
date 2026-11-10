'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

// The native protocol helper is a source-only experiment. A future helper
// distribution needs its own licensing, provenance and hardware release gates.
// Keep that tree (including untracked Cargo targets) out of runtime packages.
function allowReleaseInput(source) {
  const parts = path.resolve(source).split(path.sep);
  if (parts.some((part, index) => (part === 'network' || part === '.cache') && parts[index + 1] === 'quickshare')) return false;
  if (/^airdrop-quickshare(?:\.exe)?$/.test(path.basename(source))) {
    throw new Error('Experimental Quick Share binaries are not approved for runtime distribution.');
  }
  return true;
}

async function copyReleaseInput(source, destination) {
  await fs.cp(source, destination, { recursive: true, filter: allowReleaseInput });
}

module.exports = { allowReleaseInput, copyReleaseInput };
