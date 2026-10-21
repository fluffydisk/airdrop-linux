'use strict';
const path = require('node:path');
const os = require('node:os');
function getPaths({ home = os.homedir(), dataHome = process.env.XDG_DATA_HOME, root = process.env.AIRDROP_HOME } = {}) {
  if (root && !path.isAbsolute(root)) throw new Error('AIRDROP_HOME must be an absolute path');
  const data = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, '.local', 'share');
  root = root || path.join(data, 'airdrop');
  root = path.resolve(root);
  const legacy = [path.join(home, 'AirdropShare'), path.join(home, 'airdrop-push'), path.join(data, 'airdrop-desktop'), path.join(home, '.config', 'airdrop-desktop')];
  for (const directory of legacy) {
    const relative = path.relative(root, directory), reverse = path.relative(directory, root);
    if (!relative || !reverse || (!relative.startsWith('..' + path.sep) && relative !== '..') || (!reverse.startsWith('..' + path.sep) && reverse !== '..')) throw new Error('AIRDROP_HOME must not contain, or be inside, a legacy Airdrop directory');
  }
  const code = process.env.AIRDROP_CODE_DIR || path.join(root, 'app');
  return { root, files: path.join(root, 'files'), app: code, ui: path.join(code, 'ui'),
    server: path.join(code, 'server'), desktop: path.join(code, 'desktop'),
    config: path.join(root, 'config'), env: path.join(root, 'config', 'server.env'),
    pushState: path.join(root, 'state', 'push'), desktopData: path.join(root, 'state', 'desktop'),
    backups: path.join(root, 'backups'), legacyShare: path.join(home, 'AirdropShare'),
    legacyServer: path.join(home, 'airdrop-push'), legacyDesktop: path.join(data, 'airdrop-desktop'),
    legacyDesktopData: path.join(home, '.config', 'airdrop-desktop') };
}
module.exports = { getPaths };
