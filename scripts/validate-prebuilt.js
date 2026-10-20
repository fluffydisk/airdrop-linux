'use strict';
const fs = require('node:fs');
const path = require('node:path');
function validate(directory, arch = process.arch) {
  if (!path.isAbsolute(directory) || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Use a real absolute prebuilt directory');
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const version = require('../package.json').version;
  if (metadata.version !== version || metadata.arch !== arch) throw new Error('Prebuilt version or architecture does not match this installer');
  for (const relative of ['app/server/package.json', 'app/server/push-server.js', 'app/ui/index.html', 'app/desktop/Airdrop', 'app/desktop/resources/app/package.json']) {
    const stat = fs.lstatSync(path.join(directory, relative));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Incomplete prebuilt application');
  }
  for (const relative of ['app/server/package.json', 'app/desktop/resources/app/package.json']) if (JSON.parse(fs.readFileSync(path.join(directory, relative), 'utf8')).version !== version) throw new Error('Prebuilt component version mismatch');
  if (!(fs.statSync(path.join(directory, 'app/desktop/Airdrop')).mode & 0o111)) throw new Error('Desktop binary is not executable');
  return metadata;
}
if (require.main === module) { try { validate(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { validate };
