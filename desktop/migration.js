'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function check(paths) {
  const lock = path.join(paths.desktopData, 'SingletonLock');
  try {
    const target = await fs.readlink(lock), pid = Number(target.split('-').pop());
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid desktop profile lock');
    if (pid !== process.pid) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
      throw new Error('Quit the old Airdrop desktop before migrating.');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function apply(paths, home = os.homedir(), finalize = async () => {}) {
  const backup = path.join(paths.backups, 'package-migration-' + Date.now()); await fs.mkdir(backup, { recursive: true, mode: 0o700 });
  const contents = await fs.readFile(paths.env, 'utf8');
  await fs.writeFile(path.join(backup, 'server.env'), contents, { mode: 0o600 });
  const lines = contents.split('\n').filter(line => !/^(?:AIRDROP_UI_DIR|AIRDROP_APP_DIR)=/.test(line));
  lines.push('AIRDROP_APP_DIR=' + JSON.stringify(paths.app), 'AIRDROP_UI_DIR=' + JSON.stringify(paths.ui));
  const launchers = [path.join(home, '.local/share/applications/airdrop.desktop'), ...['airdrop-desktop', 'airdrop', 'copy-clipboard', 'paste-clipboard'].map(name => path.join(home, '.local/bin', name))];
  const moved = [];
  try {
    const temp = path.join(paths.config, '.migration-env'); await fs.writeFile(temp, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' }); await fs.rename(temp, paths.env);
    for (const file of launchers) {
      try {
        if ((await fs.lstat(file)).isSymbolicLink()) continue;
        const text = await fs.readFile(file, 'utf8');
        if (text.includes(path.join(paths.root, 'app')) || text.includes(path.join(home, '.local/bin/airdrop-desktop'))) {
          const saved = path.join(backup, path.basename(file)); await fs.rename(file, saved); moved.push({ file, saved });
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await finalize();
    return { backup };
  } catch (error) {
    await fs.writeFile(paths.env, contents, { mode: 0o600 });
    for (const item of moved.reverse()) await fs.rename(item.saved, item.file);
    throw error;
  }
}
module.exports = { check, apply };
