'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const REPOSITORY = 'fluffydisk/airdrop-linux';
const FEED = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
function version(value) { if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Invalid stable release version'); return value.split('.').map(Number); }
function newer(a, b) { const av = version(a), bv = version(b); for (let i = 0; i < 3; i++) { if (av[i] !== bv[i]) return av[i] > bv[i]; } return false; }
function assetUrl(value, tag, name) {
  const expected = `https://github.com/${REPOSITORY}/releases/download/${tag}/${name}`;
  if (value !== expected) throw new Error('Unexpected update asset URL');
  return value;
}
async function json(url, fetcher = fetch) {
  const response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}`);
  const text = await response.text(); if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Update metadata is too large');
  return JSON.parse(text);
}
async function check(current, { fetcher = fetch, arch = process.arch } = {}) {
  version(current);
  const response = await fetcher(FEED, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return { status: 'current', current, message: `Airdrop ${current}. No stable release has been published yet.` };
  if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status})`);
  const release = await response.json(); const target = String(release.tag_name || '').replace(/^v/, '');
  if (release.draft || release.prerelease || !newer(target, current)) return { status: 'current', current, message: `Airdrop ${current} is up to date.` };
  const manifestAsset = release.assets?.find(asset => asset.name === 'airdrop-update.json');
  if (!manifestAsset) throw new Error('This release has no application update packages yet.');
  const manifest = await json(assetUrl(manifestAsset.browser_download_url, release.tag_name, manifestAsset.name), fetcher);
  if (manifest.version !== target) throw new Error('Release version does not match its manifest');
  version(manifest.minimumNode);
  const pkg = manifest.packages?.[arch];
  if (!pkg || !['x64', 'arm64'].includes(arch)) throw new Error('No update package for this CPU architecture');
  if (pkg.name !== `airdrop-linux-${arch}-${target}.zip` || !/^[0-9a-f]{64}$/.test(pkg.sha256) || !Number.isSafeInteger(pkg.size) || pkg.size <= 0 || pkg.size > 1024 ** 3) throw new Error('Invalid update package metadata');
  const asset = release.assets.find(asset => asset.name === pkg.name);
  if (!asset || asset.size !== pkg.size) throw new Error('Release package is missing or incomplete');
  let appImage;
  const image = manifest.appImages?.[arch];
  if (image) {
    const suffix = arch === 'x64' ? 'x86_64' : 'aarch64';
    const imageAsset = release.assets.find(asset => asset.name === image.name);
    if (image.name !== `Airdrop-${target}-${suffix}.AppImage` || !/^[0-9a-f]{64}$/.test(image.sha256) || !Number.isSafeInteger(image.size) || image.size <= 0 || image.size > 1024 ** 3 || !imageAsset || imageAsset.size !== image.size) throw new Error('Invalid AppImage release metadata');
    appImage = { ...image, url: assetUrl(imageAsset.browser_download_url, release.tag_name, image.name) };
  }
  const extras = {};
  for (const group of ['deb', 'bridge', 'flatpak']) {
    const entry = manifest[group]?.[arch];
    if (!entry) continue;
    const names = { deb: `airdrop-linux_${target}_${arch === 'x64' ? 'amd64' : 'arm64'}.deb`, bridge: `airdrop-system-bridge_${target}_all.deb`, flatpak: `airdrop-linux-${arch}-${target}.flatpak` };
    const found = release.assets.find(asset => asset.name === entry.name);
    if (entry.name !== names[group] || !/^[0-9a-f]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !found || found.size !== entry.size) throw new Error('Invalid managed package metadata');
    extras[group] = { ...entry, url: assetUrl(found.browser_download_url, release.tag_name, found.name) };
  }
  return { ...extras, status: 'available', current, version: target, appImage, message: `Airdrop ${target} is available (installed: ${current}).`, package: { ...pkg, url: assetUrl(asset.browser_download_url, release.tag_name, pkg.name) }, minimumNode: manifest.minimumNode };
}
async function syncDirectory(directory) {
  const handle = await fsp.open(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicJSON(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + crypto.randomUUID();
  const handle = await fsp.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  await fsp.rename(temp, file); await syncDirectory(path.dirname(file));
}
function statePaths(root) { return { state: path.join(root, 'state/updates'), journal: path.join(root, 'state/updates/transaction.json'), marker: path.join(root, 'state/update-lock.json') }; }
async function safeRoot(root) { const stat = await fsp.lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink() || await fsp.realpath(root) !== root) throw new Error('Updates require a real application root'); }
async function prepare(root, release, { fetcher = fetch, progress = () => {} } = {}) {
  require('./installation').assertSelfUpdate(require('./paths').getPaths({ root }));
  await safeRoot(root);
  const { state } = statePaths(root); await fsp.mkdir(state, { recursive: true, mode: 0o700 });
  const runtime = JSON.parse(await fsp.readFile(path.join(root, 'state/runtime.json'), 'utf8'));
  if (!path.isAbsolute(runtime.node)) throw new Error('Re-run the installers once to enable application updates.');
  const { stdout } = await exec(runtime.node, ['-p', 'process.versions.node']);
  if (newer(release.minimumNode, stdout.trim())) throw new Error(`This update needs Node.js ${release.minimumNode} or later. Run the installer to upgrade the runtime.`);
  // Keep a stand-alone runner outside app/, so replacing the application cannot
  // remove either the running helper or the files needed after a crash.
  const runner = path.join(state, 'runner'); await fsp.mkdir(runner, { recursive: true, mode: 0o700 });
  for (const name of ['updater.js', 'maintenance.js', 'paths.js']) await fsp.copyFile(path.join(__dirname, name), path.join(runner, name));
  const stage = await fsp.mkdtemp(path.join(root, '.app-update-'));
  const archive = path.join(stage, 'package.zip'); let size = 0;
  try {
    const response = await fetcher(release.package.url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error('Could not download update');
    const hash = crypto.createHash('sha256');
    const meter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; if (size > release.package.size) return callback(new Error('Update package size mismatch')); hash.update(chunk); progress(size / release.package.size); callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
    if (size !== release.package.size || hash.digest('hex') !== release.package.sha256) throw new Error('Update package checksum mismatch');
    const zip = await require('jszip').loadAsync(await fsp.readFile(archive), { checkCRC32: false, createFolders: false });
    let unpacked = 0;
    for (const file of Object.values(zip.files)) {
      const name = file.unsafeOriginalName || file.name;
      const segments = name.replace(/\/$/, '').split('/');
      const type = (Number(file.unixPermissions) || 0) & 0o170000;
      if (segments[0] !== 'app' || segments.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part)) || (type && type !== 0o100000 && type !== 0o040000)) throw new Error('Unsafe entry in update package');
      const destination = path.join(stage, ...segments);
      if (file.dir) { await fsp.mkdir(destination, { recursive: true, mode: 0o755 }); continue; }
      await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      const limit = new Transform({ transform(chunk, encoding, callback) { unpacked += chunk.length; if (unpacked > 2 * 1024 ** 3) return callback(new Error('Unpacked update is too large')); callback(null, chunk); } });
      await pipeline(file.nodeStream(), limit, fs.createWriteStream(destination, { flags: 'wx', mode: (Number(file.unixPermissions) & 0o111) ? 0o755 : 0o644 }));
    }
    await fsp.unlink(archive);
    for (const name of ['server/push-server.js', 'server/package.json', 'ui/index.html', 'desktop/Airdrop']) await fsp.access(path.join(stage, 'app', name));
    const pkg = JSON.parse(await fsp.readFile(path.join(stage, 'app/server/package.json'), 'utf8'));
    if (pkg.version !== release.version) throw new Error('Installed server version does not match release');
    return { stage, version: release.version, node: runtime.node, runner: path.join(runner, 'updater.js') };
  } catch (error) { await fsp.rm(stage, { recursive: true, force: true }); throw error; }
}
async function service(action, { elevated = true } = {}) {
  if (!['stop', 'start'].includes(action)) throw new Error('Invalid service action');
  const args = [action, 'airdrop-push.service', 'airdropshare.service'];
  await exec(elevated ? '/usr/bin/pkexec' : '/usr/bin/systemctl', elevated ? ['/usr/bin/systemctl', ...args] : args, { timeout: 120000 });
}
async function healthy(root, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const [api, files] = await Promise.all([fetch('http://127.0.0.1:6001/push/version', { signal: AbortSignal.timeout(2000) }), fetch('http://127.0.0.1:5000/?json', { signal: AbortSignal.timeout(2000) })]);
      const pkg = JSON.parse(await fsp.readFile(path.join(root, 'app/server/package.json'), 'utf8'));
      if (api.ok && files.ok && (await api.json()).version === pkg.version) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Updated services did not pass their health check');
}
async function readJournal(root) { try { return JSON.parse(await fsp.readFile(statePaths(root).journal, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function validateJournal(root, journal) {
  if (journal.root !== root || !/^\.app-update-[A-Za-z0-9]+$/.test(path.basename(journal.stage)) || path.dirname(journal.stage) !== root || journal.backup !== path.join(root, 'backups', `app-${journal.id}`) || !/^[a-f0-9-]{36}$/.test(journal.id)) throw new Error('Invalid update recovery journal');
}
async function recover(root, { control = service } = {}) {
  await safeRoot(root);
  try {
    const marker = JSON.parse(await fsp.readFile(statePaths(root).marker, 'utf8'));
    if (marker.pid !== process.pid) {
      try { process.kill(marker.pid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; marker.pid = null; }
      if (marker.pid) throw new Error('An update is already running. Wait for it to finish.');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const journal = await readJournal(root);
  if (!journal || ['complete', 'rolled-back'].includes(journal.phase)) {
    // A recorded success/failure may have preceded cleanup during a power loss.
    if (journal) validateJournal(root, journal);
    await fsp.unlink(statePaths(root).marker).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return false;
  }
  validateJournal(root, journal);
  // Stop services before any directory replacement, even after interruption.
  await control('stop');
  const app = path.join(root, 'app');
  if (fs.existsSync(journal.backup)) {
    if (fs.existsSync(app)) await fsp.rename(app, path.join(journal.stage, 'failed-app-' + crypto.randomUUID()));
    await fsp.rename(journal.backup, app);
    await syncDirectory(root); await syncDirectory(path.dirname(journal.backup));
  }
  await control('start');
  journal.phase = 'rolled-back'; await atomicJSON(statePaths(root).journal, journal);
  await fsp.unlink(statePaths(root).marker).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}
async function activate(root, prepared, { control = service, health = healthy, drain = require('./maintenance').drain, relaunch = true, waitForPid, onDrained } = {}) {
  await safeRoot(root);
  const { journal: journalFile, marker } = statePaths(root);
  const previous = await readJournal(root);
  if (previous && !['complete', 'rolled-back'].includes(previous.phase)) throw new Error('Recover the previous update before installing another.');
  const id = crypto.randomUUID();
  const journal = { id, root, stage: prepared.stage, backup: path.join(root, 'backups', `app-${id}`), version: prepared.version, phase: 'prepared' };
  validateJournal(root, journal);
  await fsp.writeFile(marker, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  let stopped = false;
  try {
    await atomicJSON(journalFile, journal);
    await drain(root);
    await onDrained?.();
    if (waitForPid) {
      const until = Date.now() + 30000;
      while (true) {
        try { process.kill(waitForPid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; }
        if (Date.now() >= until) throw new Error('Desktop application did not close');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    await control('stop'); stopped = true;
    journal.phase = 'stopped'; await atomicJSON(journalFile, journal);
    await fsp.mkdir(path.dirname(journal.backup), { recursive: true, mode: 0o700 });
    await fsp.rename(path.join(root, 'app'), journal.backup);
    await syncDirectory(root); await syncDirectory(path.dirname(journal.backup));
    journal.phase = 'old-moved'; await atomicJSON(journalFile, journal);
    await fsp.rename(path.join(prepared.stage, 'app'), path.join(root, 'app'));
    await syncDirectory(root); await syncDirectory(prepared.stage);
    journal.phase = 'activated'; await atomicJSON(journalFile, journal);
    await control('start'); await health(root);
    journal.phase = 'complete'; await atomicJSON(journalFile, journal);
    await fsp.unlink(marker);
    await fsp.rm(prepared.stage, { recursive: true, force: true });
  } catch (error) {
    journal.error = error.message; await atomicJSON(journalFile, journal).catch(() => {});
    if (stopped || fs.existsSync(journal.backup)) await recover(root, { control });
    else { journal.phase = 'rolled-back'; await atomicJSON(journalFile, journal); await fsp.unlink(marker).catch(() => {}); }
    throw error;
  } finally {
    if (relaunch) spawn(path.join(root, 'app/desktop/Airdrop'), [], { detached: true, stdio: 'ignore', env: { ...process.env, AIRDROP_HOME: root } }).unref();
  }
}
function launch(root, prepared, pid) {
  const child = spawn(prepared.node, [prepared.runner, '--activate', root, JSON.stringify(prepared), String(pid)], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, AIRDROP_HOME: root } });
  return new Promise((resolve, reject) => {
    let ready = false;
    child.once('error', reject);
    child.once('exit', code => { if (!ready) reject(new Error(`Update helper stopped before transfers finished (${code})`)); });
    child.on('message', message => {
      if (message.ready) { ready = true; child.disconnect(); child.unref(); resolve(); }
      else if (message.error) reject(new Error(message.error));
    });
  });
}
if (require.main === module) {
  const [action, root, data, pid] = process.argv.slice(2);
  if (action === '--recover') recover(root).catch(error => { console.error(error.message); process.exitCode = 1; });
  else if (action === '--activate') activate(root, JSON.parse(data), { waitForPid: Number(pid), onDrained: () => { if (process.connected) process.send({ ready: true }); } }).catch(error => { if (process.connected) process.send({ error: error.message }); console.error(error.message); process.exitCode = 1; });
  else process.exitCode = 2;
}
module.exports = { check, prepare, activate, recover, readJournal, launch, newer, statePaths };
