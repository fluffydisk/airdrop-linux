'use strict';
// Validate the production dependency graph from the packaged application, not
// the development checkout. Broad packaging exclusions can truncate packages.
const path = require('node:path');
const { createRequire } = require('node:module');
async function verify(directory) {
  const load = createRequire(path.resolve(directory, 'package.json'));
  const metadata = load('./package.json');
  for (const name of Object.keys(metadata.dependencies || {})) load(name);
  if (metadata.dependencies?.selfsigned) {
    const identity = await load('selfsigned').generate([{ name: 'commonName', value: 'packaging validation' }], { algorithm: 'sha256', keySize: 2048 });
    new (require('node:crypto').X509Certificate)(identity.cert);
  }
  return Object.keys(metadata.dependencies || {}).length;
}
if (require.main === module) verify(process.argv[2] || path.resolve(__dirname, `../desktop/out/Airdrop-linux-${process.arch}/resources/app`))
  .then(count => console.log(`Verified ${count} packaged production dependencies and native identity generation`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify };
