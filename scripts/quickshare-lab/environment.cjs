'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { readJson, capabilities } = require('../../lib/sharing/lab-evidence');
const { sha } = require('./fixtures.cjs');
const ROOT = path.resolve(__dirname, '../..');
function probe(command, args = [], cwd = ROOT) {
  try { return { ok: true, output: execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 4000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', RUSTUP_AUTO_INSTALL: '0' } }).trim() }; }
  catch { return { ok: false, output: '' }; }
}
const version = value => (value || '').match(/\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?/)?.[0] || null;
function source() {
  const commit = probe('git', ['rev-parse', 'HEAD']).output;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Run the lab from a Git checkout');
  return { commit, branch: probe('git', ['branch', '--show-current']).output || '(detached)', dirty: !!probe('git', ['status', '--porcelain']).output };
}
function fingerprint() {
  const tracked = probe('git', ['ls-files', '-z', 'lib', 'desktop', 'scripts', 'network/quickshare', 'package-lock.json', 'package.json', 'packaging/runtime-sources.json']);
  if (!tracked.ok) throw Error('Could not fingerprint tracked development sources');
  const files = tracked.output.split('\0').filter(Boolean).sort();
  const crypto = require('node:crypto'), hash = crypto.createHash('sha256');
  for (const name of files) {
    const file = path.join(ROOT, name); const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('Tracked build sources must be regular files');
    const bytes = fs.readFileSync(file); hash.update(name + '\0' + bytes.length + '\0'); hash.update(bytes);
  }
  return hash.digest('hex');
}
function helperFiles() { const directory = path.join(ROOT, '.cache/quickshare', process.arch); return { directory, binary: path.join(directory, 'airdrop-quickshare'), manifest: path.join(directory, 'helper.json') }; }
function helperMetadata() {
  const files = helperFiles();
  try {
    const value = readJson(files.manifest), info = fs.lstatSync(files.binary);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('Not a regular helper');
    const actual = sha(fs.readFileSync(files.binary));
    const valid = /^[a-f0-9]{64}$/.test(value.sha256) && actual === value.sha256 && value.arch === process.arch;
    return { available: true, hashMatches: valid, sha256: actual, sourceCommit: /^[a-f0-9]{40}$/.test(value.applicationCommit) ? value.applicationCommit : null, dirty: value.dirty === true, capabilities: capabilities(value.capabilities), sourceTreeSha256: /^[a-f0-9]{64}$/.test(value.sourceTreeSha256 || '') ? value.sourceTreeSha256 : null, lockSha256: /^[a-f0-9]{64}$/.test(value.lockSha256 || '') ? value.lockSha256 : null, compilerVersion: version(value.compiler), features: Array.isArray(value.features) ? value.features.filter(v => ['ble-fastinit', 'ble-native'].includes(v)) : [], ipc: value.ipc || 1, profile: value.profile === 'debug' ? 'debug' : 'unknown' };
  } catch { return { available: false, hashMatches: false, capabilities: capabilities() }; }
}
async function hello(method = 'hello') {
  const result = helperMetadata(); if (!result.hashMatches) return { ...result, hello: false };
  return new Promise(resolve => {
    const child = spawn(helperFiles().binary, [], { stdio: ['pipe', 'pipe', 'ignore'] }); let bytes = '', settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); child.stdin.end(); child.kill('SIGTERM'); resolve(value); };
    const timer = setTimeout(() => finish({ ...result, hello: false }), method === 'hello' ? 4000 : 7000);
    child.on('error', () => finish({ ...result, hello: false }));
    child.on('exit', () => { if (!settled) finish({ ...result, hello: false }); });
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      bytes += chunk.toString('utf8'); if (bytes.length > 65536) { finish({ ...result, hello: false }); return; }
      if (!bytes.includes('\n')) return;
      try {
        const value = JSON.parse(bytes.slice(0, bytes.indexOf('\n')));
        if (value.id !== 'lab-preflight' || value.v !== 1 || (method === 'hello' && value.result?.protocol !== 1)) throw Error();
        if (method === 'bluetooth-preflight') { finish({ ...result, bluetooth: require('../../lib/sharing/quickshare').sanitizeBluetooth({ controller: value.result }).controller || { bluez: false, registrationTested: false } }); return; }
        finish({ ...result, hello: true, version: /^\d+\.\d+\.\d+$/.test(value.result.version || '') ? value.result.version : 'unknown', capabilities: capabilities(value.result.capabilities) });
      } catch { finish({ ...result, hello: false }); }
    });
    child.stdin.end(JSON.stringify({ v: 1, id: 'lab-preflight', method, params: {} }) + '\n');
  });
}
function read(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } }
function adapters() {
  const wifi = [], bluetooth = [];
  for (const name of (fs.existsSync('/sys/class/net') ? fs.readdirSync('/sys/class/net') : [])) {
    if (!fs.existsSync(`/sys/class/net/${name}/wireless`)) continue;
    let driver = 'unknown'; try { driver = path.basename(fs.realpathSync(`/sys/class/net/${name}/device/driver`)); } catch {}
    wifi.push({ driver: /^[A-Za-z0-9_-]{1,50}$/.test(driver) ? driver : 'unknown', vendor: read(`/sys/class/net/${name}/device/vendor`).match(/^0x[a-f0-9]{4}$/i)?.[0] || null, device: read(`/sys/class/net/${name}/device/device`).match(/^0x[a-f0-9]{4}$/i)?.[0] || null });
  }
  for (const name of (fs.existsSync('/sys/class/bluetooth') ? fs.readdirSync('/sys/class/bluetooth') : [])) if (/^hci\d+$/.test(name)) {
    let driver = 'unknown'; try { driver = path.basename(fs.realpathSync(`/sys/class/bluetooth/${name}/device/driver`)); } catch {}
    const usb = read(`/sys/class/bluetooth/${name}/device/modalias`).match(/usb:v([0-9a-f]{4})p([0-9a-f]{4})/i);
    bluetooth.push({ present: true, driver: /^[A-Za-z0-9_-]{1,50}$/.test(driver) ? driver : 'unknown', usbVendor: usb?.[1] || null, usbProduct: usb?.[2] || null });
  }
  return { wifi, bluetooth };
}
function applications() {
  let sourceDesktop = 0, installedDesktop = 0;
  for (const id of (fs.existsSync('/proc') ? fs.readdirSync('/proc') : []).filter(x => /^\d+$/.test(x))) {
    const cmd = read(`/proc/${id}/cmdline`);
    if (cmd.includes(path.join(ROOT, 'desktop')) && !cmd.includes('--type=')) sourceDesktop++;
    else if (/\/usr\/lib\/airdrop-linux\/desktop\/(Airdrop|electron)/.test(cmd) && !cmd.includes('--type=')) installedDesktop++;
  }
  return { sourceDesktop, installedDesktop };
}
async function preflight() {
  const release = Object.fromEntries(read('/etc/os-release').split('\n').filter(x => /^(ID|VERSION_ID|ID_LIKE)=/.test(x)).map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1).replace(/^"|"$/g, '')]; }));
  const id = /^[a-z0-9_-]{1,40}$/.test(release.ID || '') ? release.ID : 'unknown';
  const desktop = /kde|plasma/i.test(process.env.XDG_CURRENT_DESKTOP || '') ? 'KDE' : /gnome/i.test(process.env.XDG_CURRENT_DESKTOP || '') ? 'GNOME' : /xfce/i.test(process.env.XDG_CURRENT_DESKTOP || '') ? 'XFCE' : 'other/unknown';
  const deps = Object.fromEntries(['cargo', 'rustc', 'npm', 'protoc', 'cc', 'pkg-config', 'git'].map(cmd => [cmd, probe(cmd, [cmd === 'protoc' ? '--version' : '--version'], ['cargo', 'rustc'].includes(cmd) ? path.join(ROOT, 'network/quickshare') : ROOT).ok]));
  const dbus = probe('pkg-config', ['--exists', 'dbus-1']).ok;
  const helper = await hello();
  if (helper.capabilities.ble) helper.bluetooth = (await hello('bluetooth-preflight')).bluetooth;
  return { source: { ...source(), fingerprint: fingerprint() }, system: { distro: id, distroVersion: /^[0-9.]{1,24}$/.test(release.VERSION_ID || '') ? release.VERSION_ID : null, arch: process.arch, kernel: os.release().replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 100), desktop, displayAvailable: !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) }, versions: { node: process.versions.node, electron: version(read(path.join(ROOT, 'desktop/node_modules/electron/dist/version'))), npm: version(probe('npm', ['--version']).output), cargo: version(probe('cargo', ['--version'], path.join(ROOT, 'network/quickshare')).output), rustc: version(probe('rustc', ['--version'], path.join(ROOT, 'network/quickshare')).output), networkManager: version(probe('nmcli', ['--version']).output), bluez: version(probe('bluetoothctl', ['--version']).output) }, dependencies: { ...deps, dbusDevelopment: dbus, electronBinary: fs.existsSync(path.join(ROOT, 'desktop/node_modules/electron/dist/electron')) }, services: { networkManager: probe('systemctl', ['is-active', '--quiet', 'NetworkManager']).ok, bluez: probe('systemctl', ['is-active', '--quiet', 'bluetooth']).ok }, adapters: adapters(), applications: applications(), helper };
}
function instructions(distro) {
  if (['ubuntu', 'debian', 'linuxmint', 'pop'].includes(distro)) return 'Build packages (review and run yourself): sudo apt install build-essential pkg-config protobuf-compiler libdbus-1-dev libnss3 libgbm1. For Ubuntu 24.04+/Debian 13+/Mint 22+, also install libgtk-3-0t64 libasound2t64; older releases use libgtk-3-0 libasound2. Install pinned Rust via rustup.rs and Node 26 from nodejs.org or your version manager.';
  if (['fedora', 'rhel', 'centos', 'rocky'].includes(distro)) return 'Build packages (review and run yourself): sudo dnf install gcc gcc-c++ make pkgconf-pkg-config protobuf-compiler dbus-devel gtk3 nss mesa-libgbm alsa-lib. Install pinned Rust and Node 26 separately.';
  if (['arch', 'manjaro', 'endeavouros'].includes(distro)) return 'Build packages (review and run yourself): sudo pacman -S --needed base-devel pkgconf protobuf dbus gtk3 nss alsa-lib. Install pinned Rust and Node 26 separately.';
  return 'Install a C toolchain, pkg-config, protoc, D-Bus development headers, Electron runtime libraries, Rust from network/quickshare/rust-toolchain.toml and Node 26. No packages or privileges are changed by preflight.';
}
module.exports = { ROOT, probe, source, fingerprint, helperFiles, helperMetadata, hello, preflight, instructions };
