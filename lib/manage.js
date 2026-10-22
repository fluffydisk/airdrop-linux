'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { getPaths } = require('./paths');
const { distribution } = require('./installation');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function atomicJSON(file,value) {
  const temp=file+'.'+crypto.randomUUID();
  try { await fs.writeFile(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'}); await fs.rename(temp,file); }
  finally { await fs.rm(temp,{force:true}); }
}
async function read(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function safeRoot(root, home = os.homedir()) {
  root = path.resolve(root);
  const forbidden = ['/', '/usr', '/opt', '/etc', '/var', '/tmp', '/workspace', home, path.join(home, '.local'), path.join(home, '.local/share')];
  if (forbidden.some(dir => root === dir || dir.startsWith(root + path.sep))) throw new Error('Refusing unsafe application root');
  if(await fs.access(path.join(root,'.git')).then(()=>true,()=>false))throw new Error('Refusing to remove or manage a Git checkout as an application data root');
  const real = await fs.realpath(root);
  if (real !== root || (await fs.lstat(root)).isSymbolicLink()) throw new Error('Application root must not contain symbolic links');
  return root;
}
async function record(paths = getPaths(), files = [], source = 'script') {
  await safeRoot(paths.root);
  const previous = await read(path.join(paths.root, 'state/installation.json'));
  if (previous && (previous.root !== paths.root || previous.source !== source)) throw new Error('Installation source changed; use airdrop setup --migrate');
  const owned = new Map((previous?.files || []).map(file => [file.path, file]));
  for (const file of files) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ownership can only be recorded for regular files');
    owned.set(file, { path: file, sha256: digest(await fs.readFile(file)) });
  }
  await fs.mkdir(path.join(paths.root, 'state'), { recursive: true, mode: 0o700 });
  const marker = { schema: 1, root: paths.root, source, files: [...owned.values()] };
  await atomicJSON(path.join(paths.root, 'state/installation.json'),marker);
  return marker;
}
async function available(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the existing installation first.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function runtimeConfig(home = os.homedir()) {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home,'.config'), 'airdrop-linux/runtime.json');
}
async function saveRuntimeConfig(paths, source) {
  if (['flatpak','snap'].includes(source)) return [];
  const file = runtimeConfig();
  await fs.mkdir(path.dirname(file), {recursive:true,mode:0o700});
  if (await fs.realpath(path.dirname(file)) !== path.dirname(file)) throw new Error('Runtime configuration must not contain symbolic links');
  const existing = await read(file);
  if (existing && existing.root !== paths.root) throw new Error('Another data root is configured. Preserve it before switching installations.');
  await atomicJSON(file,{root:paths.root,source});return [file];
}
async function initialize(paths = getPaths()) {
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 }); await safeRoot(paths.root);
  for (const dir of [paths.files, paths.config, paths.pushState]) {
    await fs.mkdir(dir, {recursive:true, mode:0o700});
    if (await fs.realpath(dir) !== dir) throw new Error('Application data must not contain symbolic links');
  }
  try {
    const keys = require('web-push').generateVAPIDKeys();
    await fs.writeFile(paths.env, `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_CONTACT_EMAIL=mailto:example@example.com\n`, {flag:'wx',mode:0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await fs.lstat(paths.env)).isFile() || await fs.realpath(paths.env)!==paths.env) throw new Error('Identity configuration must be a regular file');
  }
}
function allowedOwnedFile(file, home = os.homedir()) {
  const exact = ['airdrop', 'airdrop-desktop', 'copy-clipboard', 'paste-clipboard'].map(name => path.join(home, '.local/bin', name));
  exact.push(runtimeConfig(home), path.join(home, '.local/share/applications/airdrop.desktop'), `/etc/apparmor.d/airdrop-desktop-${process.getuid()}`,
    '/etc/systemd/system/airdropshare.service', '/etc/systemd/system/airdrop-push.service');
  return exact.includes(file);
}
async function matchingFiles(marker, home) {
  const files = [];
  for (const file of marker.files) {
    if (!allowedOwnedFile(file.path, home)) throw new Error('Invalid owned-file path');
    try {
      const stat = await fs.lstat(file.path);
      if (stat.isFile() && !stat.isSymbolicLink() && await fs.realpath(file.path) === file.path && digest(await fs.readFile(file.path)) === file.sha256) files.push(file.path);
      else throw new Error(`File changed since installation; preserve and inspect: ${file.path}`);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return files;
}
async function stopOwned(marker, execute = run, home = os.homedir()) {
  const files = await matchingFiles(marker, home);
  for (const file of files.filter(name => name.startsWith('/etc/systemd/system/'))) {
    await execute('sudo', ['systemctl', 'disable', '--now', path.basename(file)]);
  }
  return files;
}
async function setup({ migrate = false, paths = getPaths(), execute = run } = {}) {
  const dist = distribution();
  if (!dist.managed) throw new Error('Use install.sh for a script installation');
  const marker = await read(path.join(paths.root, 'state/installation.json'));
  if (!marker && await fs.access(path.join(paths.root,'app/server')).then(()=>true,()=>false)) throw new Error('Legacy installation has no ownership record. Rerun its updated installer before migration.');
  if (marker?.source === 'script' || await read(path.join(paths.root, 'state/runtime.json'))) {
    if (marker?.source !== dist.source) {
      if (!migrate) throw new Error('Existing script installation found. Quit its desktop, then run airdrop setup --migrate. Existing data will be retained.');
      if (!marker || marker.root !== paths.root) throw new Error('Legacy installation has no ownership record. Rerun its updated installer before migration.');
      await require('../scripts/migrate-layout').checkDesktopClosed(paths.desktopData);
      await safeRoot(paths.root);
      const owned = await matchingFiles(marker);
      const units = owned.filter(file=>file.startsWith('/etc/systemd/'));
      const backup = path.join(paths.backups, `script-${Date.now()}`);
      const moved = [];
      await fs.mkdir(backup, {recursive:true,mode:0o700});
      try {
        await stopOwned(marker, execute);
        await available(5000); await available(6001);
        // Keep verified copies of every external file before removing old registrations.
        for (const file of owned) await fs.copyFile(file,path.join(backup,path.basename(file)));
        for (const [from,to] of [[path.join(paths.root,'app'),path.join(backup,'app')],
          [path.join(paths.root,'state/installation.json'),path.join(backup,'installation.json')],
          [path.join(paths.root,'state/runtime.json'),path.join(backup,'runtime.json')]]) {
          try { await fs.rename(from,to); moved.push([from,to]); }
          catch(error){if(error.code!=='ENOENT')throw error;}
        }
        for(const file of owned) {
          if(file.startsWith('/etc/')) await execute('sudo',['rm','--',file]);
          else await fs.unlink(file);
        }
        if(units.length) await execute('sudo',['systemctl','daemon-reload']);
      } catch(error) {
        for(const [from,to] of moved.reverse()) await fs.rename(to,from);
        for(const file of owned) {
          const saved=path.join(backup,path.basename(file));
          if(await fs.access(saved).then(()=>true,()=>false)) {
            if(file.startsWith('/etc/')) await execute('sudo',['cp','-p','--',saved,file]);
            else await fs.copyFile(saved,file);
          }
        }
        if(units.length) {
          await execute('sudo',['systemctl','daemon-reload']);
          for(const file of units) await execute('sudo',['systemctl','enable','--now',path.basename(file)]);
        }
        throw error;
      }
    }
  }
  await available(5000); await available(6001);
  await initialize(paths); await record(paths, await saveRuntimeConfig(paths,dist.source), dist.source);
  if (!['flatpak','snap'].includes(dist.source)) {
    await execute('systemctl', ['--user', 'daemon-reload']);
    await execute('systemctl', ['--user', 'enable', '--now', 'airdrop-linux.target']);
  }
  return 'User configuration prepared. Tailscale is configured separately; see docs/package-managers.md.';
}
const removeCommands = {
  apt: ['sudo',['apt','remove','--yes','airdrop-linux']], aur: ['sudo',['pacman','-R','--noconfirm','airdrop-linux-bin']],
  rpm: ['sudo',['dnf','remove','--assumeyes','airdrop-linux']], flatpak: ['flatpak',['uninstall','io.github.fluffydisk.airdrop-linux']],
  snap: ['sudo',['snap','remove','airdrop-linux']]
};
async function removalCommand(source) {
  if (!removeCommands[source]) throw new Error('Unsupported installation source');
  let [command,args] = removeCommands[source];
  if(source==='rpm' && await fs.access('/usr/bin/zypper').then(()=>true,()=>false))args=['zypper','--non-interactive','remove','airdrop-linux'];
  return [command,args];
}
async function uninstall({ deleteData = false, paths = getPaths(), execute = run, home = os.homedir(), source = distribution().source } = {}) {
  // A newly installed package can be removed before its first per-user setup.
  // No ownership record is needed when there is no data tree to touch.
  if (['flatpak','snap'].includes(source)) {
    const [command,args]=await removalCommand(source);
    const deletionFlag = deleteData ? (source === 'flatpak' ? ' --delete-data' : ' --purge') : '';
    const snapshots = deleteData && source === 'snap' ? ' Check snap saved for earlier airdrop-linux snapshots; remove only this app from each matching set with sudo snap forget <set-id> airdrop-linux.' : '';
    throw new Error('Run this command on the host: '+[command,...args].join(' ')+deletionFlag+'. Sandbox data removal is controlled by the host package manager.'+snapshots);
  }
  if (['apt','aur','rpm'].includes(source) && !await fs.lstat(paths.root).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})) {
    const [command,args]=await removalCommand(source);await execute(command,args);
    return 'Application removed. No user data directory was present. Tailscale and shared dependencies were preserved.';
  }
  await safeRoot(paths.root, home);
  const marker = await read(path.join(paths.root, 'state/installation.json'));
  if (!marker || marker.schema !== 1 || marker.root !== paths.root || marker.source !== source) throw new Error('No matching ownership record. Refusing to remove an unknown installation.');
  await require('../scripts/migrate-layout').checkDesktopClosed(paths.desktopData);
  if (source === 'script') {
    // Only an installed CLI, never a checkout, may remove the application tree.
    if (path.resolve(__dirname, '..') !== path.join(paths.root,'app/server')) throw new Error('Run uninstall from the installed airdrop command');
    const files = await stopOwned(marker, execute, home);
    await available(5000); await available(6001);
    for (const file of files) {
      if (file.startsWith('/etc/apparmor.d/')) await execute('sudo',['apparmor_parser','-R',file]);
      if (file.startsWith('/etc/')) await execute('sudo', ['rm', '--', file]);
      else await fs.unlink(file);
    }
    if (files.some(file=>file.startsWith('/etc/systemd/'))) await execute('sudo',['systemctl','daemon-reload']);
    await fs.rm(path.join(paths.root,'app'),{recursive:true,force:true});
    await fs.rm(path.join(paths.root,'state/installation.json'),{force:true});
  } else {
    const files = await matchingFiles(marker,home);
    if (!removeCommands[source]) throw new Error('Unsupported installation source');
    if (!['flatpak','snap'].includes(source)) {
      await execute('systemctl',['--user','disable','--now','airdrop-linux.target']);
    }
    const [command,args] = await removalCommand(source);
    await execute(command,args);
    for (const file of files.filter(file=>file===runtimeConfig(home))) await fs.rm(file,{force:true});
  }
  if (deleteData) await fs.rm(paths.root,{recursive:true,force:true});
  return 'Application removed. ' + (deleteData ? 'Application data deleted.' : `Data retained at ${paths.root}.`) + ' Tailscale and shared dependencies were preserved; review your Tailscale Serve mounts separately.';
}
module.exports = { runtimeConfig, saveRuntimeConfig, read, safeRoot, record, initialize, setup, uninstall, available, matchingFiles, stopOwned };
