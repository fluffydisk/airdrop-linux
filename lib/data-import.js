'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { rootDirectory } = require('./files');
async function checkTree(root) {
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('Imported data must not contain links or special files');
  if (stat.isDirectory()) for (const entry of await fs.readdir(root)) await checkTree(path.join(root, entry));
}
async function portsFree() {
  const net = require('node:net');
  for (const port of [5000, 6001]) await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', () => reject(new Error('Stop sharing in the other Airdrop installation before importing.')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
async function importData(source, paths, { ensureIdle = portsFree } = {}) {
  await ensureIdle();
  source = await rootDirectory(source);
  if (source === paths.root || source.startsWith(paths.root + '/') || paths.root.startsWith(source + '/')) throw new Error('Choose a separate Airdrop data folder');
  if ((await fs.readdir(paths.files)).length) throw new Error('Import requires an empty destination shared folder. Your existing data was kept.');
  try { if (JSON.parse(await fs.readFile(path.join(paths.pushState, 'subscriptions.json'))).length) throw new Error('Import requires a new workspace with no subscriptions'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = await fs.mkdtemp(path.join(paths.root, '.airdrop-import-')); const moved = [];
  const components = ['files', 'config/server.env', 'state/push', 'state/desktop/settings.json'];
  const backup = path.join(paths.backups, 'before-import-' + Date.now());
  try {
    for (const component of components) {
      const input = path.join(source, component);
      try { await checkTree(input); } catch (error) { if (error.code === 'ENOENT' && component.startsWith('state/')) continue; throw error; }
      await fs.mkdir(path.dirname(path.join(stage, component)), { recursive: true, mode: 0o700 });
      await fs.cp(input, path.join(stage, component), { recursive: true, dereference: false });
      await checkTree(path.join(stage, component));
    }
    const env = path.join(stage, 'config/server.env');
    const text = await fs.readFile(env, 'utf8');
    if (!/^VAPID_PUBLIC_KEY=.+/m.test(text) || !/^VAPID_PRIVATE_KEY=.+/m.test(text)) throw new Error('Selected folder has no valid Airdrop credentials');
    await fs.writeFile(env, text.split('\n').filter(line => !/^(?:AIRDROP_HOME|WATCH_DIR|AIRDROP_STATE_DIR|AIRDROP_UI_DIR|AIRDROP_APP_DIR|PORT)=/.test(line)).join('\n'), { mode: 0o600 }); await fs.chmod(env, 0o600);
    await fs.mkdir(backup, { recursive: true, mode: 0o700 });
    for (const component of components) {
      const input = path.join(stage, component), target = path.join(paths.root, component), saved = path.join(backup, component);
      try { await fs.access(input); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await fs.mkdir(path.dirname(saved), { recursive: true, mode: 0o700 });
      let existing = false;
      try { await fs.rename(target, saved); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      moved.push({ target, saved, existing }); await fs.rename(input, target);
    }
    return { backup };
  } catch (error) {
    for (const item of moved.reverse()) { await fs.rm(item.target, { recursive: true, force: true }); if (item.existing) await fs.rename(item.saved, item.target); }
    throw error;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
module.exports = { importData, checkTree };
