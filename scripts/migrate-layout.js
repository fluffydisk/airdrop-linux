'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { getPaths } = require('../lib/paths');
const { numberedName } = require('../lib/files');
async function exists(file) { try { await fs.lstat(file); return true; } catch (e) { if (e.code !== 'ENOENT') throw e; return false; } }
async function hash(file) { const value = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) value.update(chunk); return value.digest('hex'); }
async function atomicJSON(file, data) { await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 }); await fs.rename(file + '.tmp', file); }
async function checkDesktopClosed(directory) {
  try {
    const lock = await fs.readlink(path.join(directory, 'SingletonLock'));
    const pid = Number(lock.match(/-(\d+)$/)?.[1]);
    if (!pid) return;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    throw new Error('Quit Airdrop from its tray menu before migrating or updating the desktop app.');
  } catch (error) { if (!['ENOENT', 'EINVAL'].includes(error.code)) throw error; }
}
function envValues(text) { return Object.fromEntries(text.split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, '')]; })); }
async function prepare(paths) {
  await checkDesktopClosed(paths.legacyDesktopData);
  await checkDesktopClosed(paths.desktopData);
  for (const directory of [paths.root, paths.files, paths.ui, paths.server, paths.config, paths.pushState, paths.backups]) {
    await fs.mkdir(directory, { recursive: true });
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Application directories must not be symbolic links');
  }
  for (const directory of [paths.root, paths.config, paths.pushState, paths.backups]) await fs.chmod(directory, 0o700);
  const journalFile = path.join(paths.root, 'migration.json');
  let journal = { version: 1, copies: {}, sources: [] };
  if (await exists(journalFile)) journal = JSON.parse(await fs.readFile(journalFile, 'utf8'));
  if (journal.phase === 'committed') return journal;
  // Check credential conflicts before touching either credential file.
  const oldEnv = path.join(paths.legacyServer, '.env');
  if (await exists(oldEnv)) {
    const oldText = await fs.readFile(oldEnv, 'utf8');
    const oldValues = envValues(oldText);
    if (!oldValues.VAPID_PUBLIC_KEY || !oldValues.VAPID_PRIVATE_KEY) throw new Error('Legacy VAPID credentials are incomplete; fix them before migration.');
    if (await exists(paths.env)) {
      const current = envValues(await fs.readFile(paths.env, 'utf8'));
      if (['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].some(key => current[key] !== oldValues[key])) throw new Error('Conflicting VAPID identities exist. Both installations are preserved; choose the identity before migration.');
    } else {
      await fs.copyFile(oldEnv, paths.env);
      await fs.chmod(paths.env, 0o600);
    }
  }
  async function rememberSource(source, name) {
    if (await exists(source)) {
      if (!(await fs.lstat(source)).isDirectory()) throw new Error(`Legacy ${name} must be a real directory`);
      if (!journal.sources.some(entry => entry.source === source)) journal.sources.push({ source, backup: path.join(paths.backups, 'legacy', name) });
    }
  }
  await rememberSource(paths.legacyShare, 'shared-folder');
  await rememberSource(paths.legacyServer, 'push-server');
  await rememberSource(paths.legacyDesktopData, 'desktop-settings');
  await rememberSource(paths.legacyDesktop, 'desktop-app');
  async function copyTree(source, destination, relative = '') {
    const sourcePath = path.join(source, relative);
    const stat = await fs.lstat(sourcePath);
    if (stat.isSymbolicLink()) throw new Error(`Move symbolic links out of the legacy shared folder before migrating: ${relative}`);
    if (stat.isDirectory()) {
      if (await exists(destination) && !(await fs.lstat(destination)).isDirectory()) throw new Error(`File/directory conflict at ${destination}`);
      await fs.mkdir(destination, { recursive: true });
      for (const name of await fs.readdir(sourcePath)) {
        if (!relative && name === 'ui') continue; // The old application UI remains in the legacy backup.
        if (name.startsWith('.airdrop-')) continue; // Incomplete uploads are not published as shared data.
        await copyTree(source, path.join(destination, name), path.join(relative, name));
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`Unsupported shared file: ${relative}`);
    const fingerprint = await hash(sourcePath);
    const key = sourcePath;
    const previous = journal.copies[key];
    if (previous && previous.hash === fingerprint && await exists(previous.destination) && await hash(previous.destination) === fingerprint) return;
    let target = destination;
    for (let count = 0; await exists(target); count++) {
      const targetStat = await fs.lstat(target);
      if (targetStat.isFile() && !targetStat.isSymbolicLink() && await hash(target) === fingerprint) break;
      target = path.join(path.dirname(destination), numberedName(path.basename(destination), count + 1));
    }
    if (!await exists(target)) {
      const tempDir = await fs.mkdtemp(path.join(path.dirname(target), '.airdrop-migrate-'));
      const temp = path.join(tempDir, 'copy');
      try {
        await fs.copyFile(sourcePath, temp);
        if (await hash(temp) !== fingerprint || await hash(sourcePath) !== fingerprint) throw new Error('A shared file changed during migration. Stop transfers and rerun install.sh.');
        await fs.link(temp, target);
        await fs.utimes(target, stat.atime, stat.mtime);
      } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
    }
    journal.copies[key] = { destination: target, hash: fingerprint };
    await atomicJSON(journalFile, journal);
  }
  if (await exists(paths.legacyShare)) await copyTree(paths.legacyShare, paths.files);
  const oldSubs = path.join(paths.legacyServer, 'subscriptions.json');
  if (await exists(oldSubs)) {
    const old = JSON.parse(await fs.readFile(oldSubs, 'utf8'));
    const target = path.join(paths.pushState, 'subscriptions.json');
    const current = await exists(target) ? JSON.parse(await fs.readFile(target, 'utf8')) : [];
    if (!Array.isArray(old) || !Array.isArray(current)) throw new Error('Invalid subscriptions file; existing files are preserved.');
    const merged = new Map(old.map(item => [item.endpoint, item]));
    for (const item of current) merged.set(item.endpoint, item);
    await atomicJSON(target, [...merged.values()]);
  }
  if (await exists(paths.legacyDesktopData)) {
    await fs.cp(paths.legacyDesktopData, paths.desktopData, { recursive: true, force: false, errorOnExist: false,
      filter: async source => !['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'].includes(path.basename(source)) && !(await fs.lstat(source)).isSocket() });
  }
  if (await exists(paths.env)) {
    let text = await fs.readFile(paths.env, 'utf8');
    const values = { AIRDROP_HOME: paths.root, WATCH_DIR: paths.files, AIRDROP_STATE_DIR: paths.pushState, AIRDROP_UI_DIR: paths.ui };
    for (const [key, value] of Object.entries(values)) {
      const line = `${key}=${JSON.stringify(value)}`;
      const expression = new RegExp(`^${key}=.*$`, 'm');
      text = expression.test(text) ? text.replace(expression, () => line) : text.trimEnd() + '\n' + line + '\n';
    }
    await fs.writeFile(paths.env + '.tmp', text, { mode: 0o600 });
    await fs.rename(paths.env + '.tmp', paths.env);
    await fs.chmod(paths.env, 0o600);
  }
  journal.phase = 'prepared'; await atomicJSON(journalFile, journal);
  return journal;
}
async function commit(paths) {
  const file = path.join(paths.root, 'migration.json');
  const journal = JSON.parse(await fs.readFile(file, 'utf8'));
  if (journal.phase === 'committed') return journal;
  if (journal.phase !== 'prepared') throw new Error('Prepare the migration before committing it');
  // Reject files added after preparation, even when all earlier copies still match.
  async function validateTree(directory, relative = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if ((!relative && entry.name === 'ui') || entry.name.startsWith('.airdrop-')) continue;
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) await validateTree(source, path.join(relative, entry.name));
      else if (!entry.isFile() || !journal.copies[source]) throw new Error('Migration data changed; rerun preparation before committing.');
    }
  }
  if (await exists(paths.legacyShare)) await validateTree(paths.legacyShare);
  // Validate the copied bytes before removing any old active path.
  for (const [source, copy] of Object.entries(journal.copies)) {
    if (await exists(source) && (await hash(source) !== copy.hash || !await exists(copy.destination) || await hash(copy.destination) !== copy.hash)) throw new Error('Migration data changed; rerun preparation before committing.');
  }
  await checkDesktopClosed(paths.legacyDesktopData);
  for (const entry of journal.sources) {
    if (!await exists(entry.source)) continue;
    await fs.mkdir(path.dirname(entry.backup), { recursive: true });
    if (await exists(entry.backup)) throw new Error(`Migration backup already exists: ${entry.backup}`);
    try { await fs.rename(entry.source, entry.backup); }
    catch (error) { if (error.code === 'EXDEV') throw new Error('Legacy directories are on another filesystem. Keep them intact and move them to backups manually after verification.'); throw error; }
  }
  journal.phase = 'committed'; await atomicJSON(file, journal);
  return journal;
}
if (require.main === module) {
  const command = process.argv[2] || 'prepare';
  if (!['prepare', 'commit'].includes(command)) throw new Error('Usage: migrate-layout.js [prepare|commit]');
  ({ prepare, commit }[command])(getPaths()).then(journal => console.log(`Airdrop layout ${journal.phase}; ${Object.keys(journal.copies).length} shared files preserved.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { prepare, commit, checkDesktopClosed, envValues };
