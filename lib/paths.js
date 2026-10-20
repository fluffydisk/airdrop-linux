'use strict';
const path = require('node:path');
const os = require('node:os');
function getPaths({ home = os.homedir(), dataHome = process.env.XDG_DATA_HOME, root = process.env.AIRDROP_HOME, appRoot = process.env.AIRDROP_APP_DIR } = {}) {
  if (root && !path.isAbsolute(root)) throw new Error('AIRDROP_HOME must be an absolute path');
  const data = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, '.local', 'share');
  root = root || path.join(data, 'airdrop');
  root = path.resolve(root);
  if (appRoot && !path.isAbsolute(appRoot)) throw new Error('AIRDROP_APP_DIR must be an absolute path');
  const app = appRoot ? path.resolve(appRoot) : path.join(root, 'app');
  const legacy = [path.join(home, 'AirdropShare'), path.join(home, 'airdrop-push'), path.join(data, 'airdrop-desktop'), path.join(home, '.config', 'airdrop-desktop')];
  for (const directory of legacy) {
    const relative = path.relative(root, directory), reverse = path.relative(directory, root);
    if (!relative || !reverse || (!relative.startsWith('..' + path.sep) && relative !== '..') || (!reverse.startsWith('..' + path.sep) && reverse !== '..')) throw new Error('AIRDROP_HOME must not contain, or be inside, a legacy Airdrop directory');
  }
  return { root, files: path.join(root, 'files'), app, ui: path.join(app, 'ui'),
    server: path.join(app, 'server'), desktop: path.join(app, 'desktop'),
    config: path.join(root, 'config'), env: path.join(root, 'config', 'server.env'),
    pushState: path.join(root, 'state', 'push'), desktopData: path.join(root, 'state', 'desktop'),
    backups: path.join(root, 'backups'), legacyShare: path.join(home, 'AirdropShare'),
    legacyServer: path.join(home, 'airdrop-push'), legacyDesktop: path.join(data, 'airdrop-desktop'),
    legacyDesktopData: path.join(home, '.config', 'airdrop-desktop') };
}
module.exports = { getPaths };
