'use strict';
const fs = require('node:fs');
const path = require('node:path');
const updates = Object.freeze({
  apt: 'sudo apt update && sudo apt install --only-upgrade airdrop-linux',
  aur: 'Update airdrop-linux-bin with your AUR helper.',
  rpm: 'sudo dnf upgrade airdrop-linux (openSUSE: sudo zypper update airdrop-linux)',
  flatpak: 'flatpak update io.github.fluffydisk.Airdrop',
  snap: 'sudo snap refresh airdrop-linux'
});
function distribution(env = process.env) {
  const file = env.AIRDROP_INSTALL_MANIFEST || path.resolve(__dirname, '../../distribution.json');
  let source;
  try { source = JSON.parse(fs.readFileSync(file, 'utf8')).source; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (source && !Object.hasOwn(updates, source)) throw new Error('Unknown installation source');
  return { source: source || (env.APPIMAGE ? 'appimage' : 'script'), managed: Boolean(source), message: updates[source] };
}
function assertWritableInstallation(root) {
  if (distribution().managed) throw new Error('This installation is managed by a package manager. ' + distribution().message);
  // A caller cannot bypass the guard by omitting the launcher's environment.
  try {
    const source = JSON.parse(fs.readFileSync(path.join(root, 'state/installation.json'), 'utf8')).source;
    if (Object.hasOwn(updates, source)) throw new Error('Use the package manager to update this installation.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
module.exports = { distribution, assertWritableInstallation };
