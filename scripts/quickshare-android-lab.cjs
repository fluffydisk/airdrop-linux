#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const readline = require('node:readline/promises');
const { ROOT, preflight, instructions, helperFiles, hello, source, fingerprint } = require('./quickshare-lab/environment.cjs');
const { prepareFixtures, hashDirectory, fixtureNames } = require('./quickshare-lab/fixtures.cjs');
const { createReport, observations, LABELS, OUTCOMES } = require('./quickshare-lab/report.cjs');
const { ownedDirectory, readJson, atomicJson } = require('../lib/sharing/lab-evidence');
const HELP = `Samsung Galaxy S24+ native Quick Share development lab
  --preflight                  Read-only environment/build/capability checks
  --prepare                    npm ci, build real Rust helper, prepare Electron/fixtures
  --start                      Start isolated actual source desktop (development flag)
  --status                     Show live sanitized listener/discovery state
  --collect                    Ask for observations on a terminal; write private reports
  --stop                       Stop only this harness's owned desktop; keep evidence/files
Options:
  --workspace PATH             Private lab directory (default .cache/quickshare-lab)
  --ble-native                 Prepare native FEF3/GATT/LE CoC experiment
  --ble-fastinit               Prepare with optional 120-second FE2C sender nudge
  --skip-install               Prepare using already installed locked Node dependencies
  --direction samsung-to-linux|linux-to-samsung
  --diagnose [--adb] --direction linux-to-samsung|samsung-to-linux
                               Bounded deep diagnostic (isolated .cache/quickshare-deep-lab)
  --duration 10..600            Observation seconds (default 180)
  --authorize-adb              Explicit read-only USB diagnostic consent; RSA authorization still required
  --network ordinary|hotspot|school|other  Owner-selected environment
  --apple-sharing on|off|not-available     Separate comparison session
  --case lab-small.txt|batch|all  Select the fixture(s) whose hashes should be checked
  --scenario ordinary|decline|cancel|interrupt
  --record C=pass,E=unknown     Noninteractive owner observations, stages C through I
  --readback PATH              Explicit fixture-only USB readback for Linux -> Samsung
  --archive                    Archive approved reports (collect: two; diagnose: three)
  --non-interactive            Never ask questions; leave unobserved stages untested
ADB is used only with --diagnose --adb and explicit owner consent.
No sudo, persistent radio/firewall changes or automatic uploads are performed.
See docs/quickshare-s24-test.md. BLE requires --ble-native at prepare; see the scoped physical LAN fixture evidence in docs/quickshare-s24-physical-evidence.md.`;
function parse(argv) {
  const result = {}; const operations = ['preflight', 'prepare', 'start', 'status', 'collect', 'stop', 'supervise', 'diagnose', 'help'];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--')) throw Error('Expected a --flag');
    if (operations.includes(key)) { if (result.operation) throw Error('Choose one operation'); result.operation = key; }
    else if (['workspace', 'direction', 'case', 'record', 'readback', 'scenario', 'duration', 'network', 'apple-sharing'].includes(key)) { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Missing option value'); result[key] = argv[++i]; }
    else if (['skip-install', 'archive', 'non-interactive', 'ble-fastinit', 'ble-native', 'adb', 'authorize-adb'].includes(key)) result[key] = true;
    else throw Error('Unknown lab option: ' + argv[i]);
  }
  if (result.direction && !['samsung-to-linux', 'linux-to-samsung'].includes(result.direction)) throw Error('Invalid direction');
  if (result.case && !['batch', 'all', ...fixtureNames].includes(result.case)) throw Error('Choose an exact generated fixture name, batch or all');
  if (result.scenario && !['ordinary', 'decline', 'cancel', 'interrupt'].includes(result.scenario)) throw Error('Invalid scenario');
  if (result.duration && (!/^\d{1,3}$/.test(result.duration)||Number(result.duration)<10||Number(result.duration)>600)) throw Error('Duration must be 10–600 seconds');
  if(result.network && !['ordinary','hotspot','school','other'].includes(result.network))throw Error('Invalid network scenario');
  if(result['apple-sharing'] && !['on','off','not-available'].includes(result['apple-sharing']))throw Error('Invalid Apple sharing comparison');
  return result;
}
function rootFor(options) { return path.resolve(options.workspace || path.join(ROOT, '.cache/quickshare-lab')); }
async function directory(root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 }); ownedDirectory(root);
}
function markerFor(root) {
  ownedDirectory(root); const marker = readJson(path.join(root, 'lab.json'));
  if (marker.schema !== 1 || marker.repository !== sync.realpathSync(ROOT) || !/^[a-f0-9]{32}$/.test(marker.run || '')) throw Error('This is not a lab workspace for this checkout');
  return marker;
}
function control(root, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(root, 'control.sock')); let text = '', done = false;
    const finish = (error, value) => { if (done) return; done = true; socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(3000, () => finish(Error('Lab control timed out')));
    socket.on('error', error => finish(error));
    socket.on('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.on('data', bytes => { text += bytes.toString('utf8'); if (text.length > 65536) finish(Error('Lab control limit')); else if (text.includes('\n')) { try { finish(null, JSON.parse(text.slice(0, text.indexOf('\n')))); } catch { finish(Error('Invalid lab control')); } } });
  });
}
async function active(root) { try { await control(root, 'status'); return true; } catch { return false; } }
function printPreflight(value) {
  console.log(JSON.stringify(value, null, 2)); console.log('\n' + instructions(value.system.distro));
  console.log('Rust pin: ' + sync.readFileSync(path.join(ROOT, 'network/quickshare/rust-toolchain.toml'), 'utf8').match(/channel\s*=\s*"([^"]+)"/)?.[1]);
  console.log('Recommended Node: ' + require('../packaging/runtime-sources.json').nodeVersion);
  console.log(value.helper.capabilities.ble ? 'BLE discovery/GATT/LE CoC compiled; actual radio registration and stock-device acceptance require runtime evidence.' : 'BLE receiver bootstrap: not implemented. Samsung visibility is unverified; LAN discovery can still be tested. Absence is not a protocol incompatibility conclusion.');
}
async function run(command, args, cwd = ROOT) {
  console.log('Running ' + command + ' ' + args.join(' '));
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', () => reject(Error('Could not run ' + command)));
    child.on('exit', code => code === 0 ? resolve() : reject(Error(command + ' failed; review local output. Raw build output is never included in reports.')));
  });
}
async function prepare(options) {
  const root = rootFor(options);
  if (await active(root)) throw Error('Stop the active lab before preparing');
  await directory(root);
  if (sync.existsSync(path.join(root, 'run.lock'))) throw Error('Use --stop before preparing this workspace again');
  try { markerFor(root); } catch (error) { if ((await fs.readdir(root)).length) throw error; }
  atomicJson(root, 'lab.json', { schema: 1, repository: sync.realpathSync(ROOT), ...source(), run: crypto.randomBytes(16).toString('hex'), prepared: false });
  await prepareFixtures(path.join(root, 'fixtures'));
  const env = await preflight(); printPreflight(env);
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw Error('The native helper currently supports Linux x64/ARM64');
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Install Node 26 (minimum host Node 24) before preparing');
  if (!env.dependencies.cargo || !env.dependencies.rustc || !env.dependencies.protoc || !env.dependencies.cc || !env.dependencies['pkg-config'] || !env.dependencies.npm) throw Error('Missing build dependencies or the pinned Rust toolchain. Follow the preflight instructions, then retry');
  if (!options['skip-install']) {
    await run('npm', ['ci', '--ignore-scripts']); await run('npm', ['ci', '--prefix', 'desktop', '--ignore-scripts']);
  }
  // Electron's own installer uses trusted project lockfile/package metadata.
  await run(process.execPath, [path.join(ROOT, 'desktop/node_modules/electron/install.js')]);
  const electronPackage = readJson(path.join(ROOT, 'desktop/node_modules/electron/package.json'));
  const installedVersion = (await fs.readFile(path.join(ROOT, 'desktop/node_modules/electron/dist/version'), 'utf8')).trim();
  if (installedVersion !== electronPackage.version) throw Error('Electron binary does not match its installed package; do not skip its binary installer');
  await run(process.execPath, [path.join(ROOT, 'scripts/build-quickshare.js'), ...(options['ble-fastinit'] ? ['--ble-fastinit'] : []), ...(options['ble-native'] ? ['--ble-native'] : [])]);
  await run(process.execPath, [path.join(ROOT, 'scripts/prepare-desktop.js')]);
  const helper = await hello(); if (!helper.hashMatches || !helper.hello || helper.sourceCommit !== source().commit) throw Error('The built helper does not match the checkout/manifest');
  await prepareFixtures(path.join(root, 'fixtures'));
  atomicJson(root, 'lab.json', { schema: 1, prepared: true, repository: sync.realpathSync(ROOT), ...source(), run: crypto.randomBytes(16).toString('hex'), preparedAt: new Date().toISOString(), fingerprint: fingerprint(), helperSha256: helper.sha256, helperVersion: helper.version, build: { compilerVersion: helper.compilerVersion, lockSha256: helper.lockSha256, sourceTreeSha256: helper.sourceTreeSha256, profile: helper.profile, ipc: helper.ipc, features: helper.features }, fastInitRequested: options['ble-fastinit'] === true, bleNativeRequested: options['ble-native'] === true });
  console.log('\nPrepared isolated S24+ lab. No radio, firewall or system services were changed.');
  console.log('Fixtures: ' + path.join(root, 'fixtures') + '\nNext: bash scripts/quickshare-android-lab.sh --start' + (options.workspace ? ' --workspace ' + JSON.stringify(root) : ''));
}
async function start(options) {
  const root = rootFor(options), marker = markerFor(root);
  if (marker.prepared !== true) throw Error('Preparation is incomplete; run --prepare again');
  if (Buffer.byteLength(path.join(root, 'control.sock')) > 100) throw Error('Workspace path is too long for a Unix socket; use --workspace /tmp/s24-lab on every operation');
  if (await active(root)) throw Error('This lab is already running; use --status or --stop');
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw Error('No desktop display. Run --start in a terminal in your Linux graphical session');
  const helper = await hello();
  if (!helper.hello || !helper.hashMatches || helper.sha256 !== marker.helperSha256 || helper.sourceCommit !== source().commit || marker.commit !== source().commit || marker.fingerprint !== fingerprint()) throw Error('Build is stale or unverified. Run --prepare from this checkout again');
  const expected = readJson(path.join(root, 'fixtures/fixture-manifest.json'));
  const fixtures = await hashDirectory(path.join(root, 'fixtures'), expected);
  if (fixtures.checked.length !== fixtureNames.length || fixtures.checked.some(file => file.result !== 'match')) throw Error('Fixtures changed; prepare a new workspace');
  const lock = path.join(root, 'run.lock');
  try { await fs.writeFile(lock, JSON.stringify({ createdAt: Date.now() }), { flag: 'wx', mode: 0o600 }); }
  catch { throw Error('Lab lock exists. Use --stop to check/recover this workspace; no process will be killed by PID'); }
  marker.run = crypto.randomBytes(16).toString('hex'); atomicJson(root, 'lab.json', marker);
  const session = path.join(root, 'sessions', marker.run); await directory(session); await directory(path.join(session, 'share')); await directory(path.join(session, 'share/Received')); await directory(path.join(session, 'home')); await directory(path.join(session, 'readback'));
  try { await fs.unlink(path.join(root, 'desktop-state.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  atomicJson(root, 'runtime.json', { schema: 1, run: marker.run, status: 'starting', listenerReachable: false, advertisements: { ownObserved: false, maxVisible: 0 } });
  const child = spawn(process.execPath, [__filename, '--supervise', '--workspace', root], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
  let runtime;
  for (let i = 0; i < 80; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { runtime = await control(root, 'status'); } catch { continue; }
    if (runtime.status !== 'starting' && runtime.helperStatus !== 'starting') break;
  }
  if (!runtime || runtime.status === 'failed' || runtime.status === 'starting') throw Error('Desktop did not become ready. Use --collect --non-interactive for a sanitized failure report; check your Electron sandbox/display setup. No sandbox restrictions were disabled');
  console.log('DEVELOPMENT BUILD ' + marker.commit + (marker.dirty ? ' (modified sources)' : ''));
  console.log('Helper ' + helper.version + ' SHA-256 ' + helper.sha256);
  console.log('Compiled discovery capabilities: ' + JSON.stringify(helper.capabilities));
  console.log('Native receiver name: Airdrop S24 Lab\nReceived files: ' + path.join(session, 'share/Received') + '\nUSB readback folder: ' + path.join(session, 'readback'));
  console.log(JSON.stringify(runtime, null, 2));
  console.log(marker.bleNativeRequested ? 'Experimental BLE/GATT requested. Registration is not proof of radio emission, Samsung discovery or authenticated transfer.' : 'LAN-only helper. Prepare with --ble-native for experimental BLE/GATT; startup does not prove Samsung compatibility.');
  console.log('Use --status while testing, --collect for evidence, and --stop to close only this lab.');
}
function listener(port) {
  return new Promise(resolve => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) { resolve(false); return; }
    const sock = net.createConnection({ host: '127.0.0.1', port }); let done = false;
    const finish = value => { if (done) return; done = true; sock.destroy(); resolve(value); };
    sock.setTimeout(800, () => finish(false)); sock.on('error', () => finish(false)); sock.on('connect', () => finish(true));
  });
}
async function supervise(options) {
  const root = rootFor(options), marker = markerFor(root), session = path.join(root, 'sessions', marker.run);
  let server, child, bonjour, browser, timer, stopping = false, pollBusy = false;
  const runtime = { schema: 1, run: marker.run, status: 'starting', helperStatus: 'starting', listenerReachable: false, advertisements: { ownObserved: false, maxVisible: 0 }, startedAt: new Date().toISOString() };
  const save = () => atomicJson(root, 'runtime.json', runtime);
  const shutdown = async failed => {
    if (stopping) return; stopping = true; clearInterval(timer);
    runtime.listenerReachableAtShutdown=runtime.listenerReachable;
    runtime.status = failed ? 'failed' : 'stopped'; runtime.listenerReachable = false;
    try { save(); } catch {}
    if (child && Number.isInteger(child.pid) && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
      let killTimer; await Promise.race([stopped, new Promise(resolve => { killTimer = setTimeout(resolve, marker.bleNativeRequested ? 20000 : 6000); })]); clearTimeout(killTimer);
      // In-memory ChildProcess only: never kill stored/reused PIDs or services.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await stopped;
    }
    browser?.stop(); bonjour?.destroy();
    server?.close();
    try { await fs.unlink(path.join(root, 'control.sock')); } catch {}
    try { await fs.unlink(path.join(root, 'run.lock')); } catch {}
  };
  try {
    try { const info = await fs.lstat(path.join(root, 'control.sock')); if (!info.isSocket() || await active(root)) throw Error('Unexpected lab control path'); await fs.unlink(path.join(root, 'control.sock')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    server = net.createServer(socket => {
      let data = ''; socket.setTimeout(3000, () => socket.destroy());
      socket.on('error', () => {});
      socket.on('data', bytes => {
        data += bytes.toString('utf8'); if (data.length > 1024) { socket.destroy(); return; }
        if (!data.includes('\n')) return;
        try { const command = JSON.parse(data.slice(0, data.indexOf('\n'))).command;
          if (command === 'status') socket.end(JSON.stringify(runtime) + '\n');
          else if (command === 'stop') { socket.end('{"stopping":true}\n'); void shutdown(false); }
          else socket.destroy();
        } catch { socket.destroy(); }
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path.join(root, 'control.sock'), resolve); }); await fs.chmod(path.join(root, 'control.sock'), 0o600);
    const { Bonjour } = require('bonjour-service'); bonjour = new Bonjour();
    browser = bonjour.find({ type: 'FC9F5ED42C8A', protocol: 'tcp' });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AIRDROP_') && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_PATH', 'ELECTRON_OVERRIDE_DIST_PATH', 'APPIMAGE', 'FLATPAK_ID', 'SNAP', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)));
    Object.assign(env, { AIRDROP_HOME: path.join(session, 'home'), AIRDROP_SHARE_DIR: path.join(session, 'share'), AIRDROP_CODE_DIR: ROOT, AIRDROP_QUICKSHARE_LAB_DIR: root, AIRDROP_EXPERIMENTAL_QUICK_SHARE: '1', AIRDROP_DISABLE_UPDATE_CHECK: '1', AIRDROP_DISABLE_TRAY: '1', AIRDROP_API_PORT: '0', AIRDROP_FILE_PORT: '0', AIRDROP_QUICKSHARE_BLE_FASTINIT: marker.fastInitRequested ? '1' : '0', AIRDROP_QUICKSHARE_BLE_NATIVE: marker.bleNativeRequested ? '1' : '0' });
    const electronRoot = path.join(ROOT, 'desktop/node_modules/electron');
    if ((await fs.readFile(path.join(electronRoot, 'path.txt'), 'utf8')).trim() !== 'electron') throw Error('Unexpected development Electron executable');
    const executable = path.join(electronRoot, 'dist/electron');
    if ((await fs.lstat(executable)).isSymbolicLink() || (await fs.realpath(executable)) !== executable) throw Error('Electron must be the prepared source dependency');
    const args = [path.join(ROOT, 'desktop')];
    // A development test runner may choose a real X11/headless backend. No --no-sandbox.
    if (process.env.AIRDROP_LAB_OZONE) { if (!['x11', 'wayland', 'headless'].includes(process.env.AIRDROP_LAB_OZONE)) throw Error('Invalid Ozone backend'); args.push('--ozone-platform=' + process.env.AIRDROP_LAB_OZONE); }
    child = spawn(executable, args, { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', bytes => {
      const text = bytes.toString('utf8');
      if (/Missing X server|cannot open display|Failed to connect to Wayland/i.test(text)) runtime.failureCategory = 'DISPLAY_UNAVAILABLE';
      else if (/No usable sandbox|Failed to move to new namespace|zygote_host_impl.*sandbox/i.test(text)) runtime.failureCategory = 'SANDBOX_DENIED';
      else if (/error while loading shared libraries/i.test(text)) runtime.failureCategory = 'RUNTIME_LIBRARY_MISSING';
      // Drain all other diagnostics. Never persist raw stderr or stdout.
    });
    child.on('error', () => { void shutdown(true); }); child.on('exit', code => { if (!stopping) void shutdown(code !== 0); });
    const poll = async () => {
      if (pollBusy || stopping) return; pollBusy = true;
      try {
        const state = readJson(path.join(root, 'desktop-state.json'), 32 * 1024 * 1024);
        if (state.run !== marker.run) return;
        runtime.bleFastInitState = ['registered-for-120s', 'expired', 'bluez-unavailable', 'bluez-timeout', 'permission-denied', 'not-supported', 'bluetooth-off', 'no-adapter', 'adapter-busy', 'bluez-operation-failed', 'unavailable-or-denied'].includes(state.helper?.bleFastInitState) ? state.helper.bleFastInitState : 'not-requested';
        runtime.bluetooth = require('../lib/sharing/quickshare').sanitizeBluetooth(state.helper?.bluetooth);
        runtime.capabilities = require('../lib/sharing/lab-evidence').capabilities(state.helper?.capabilities);
        runtime.helperStatus = ['starting', 'ready', 'error', 'stopped', 'disabled'].includes(state.helper?.status) ? state.helper.status : 'error';
        const reachable = runtime.helperStatus === 'ready' && await listener(state.helper.listenerPort);
        if(stopping)return; // A pending probe must not overwrite the stopped snapshot.
        runtime.listenerReachable = reachable;
        const visible = browser.services.slice(0, 100);
        const localAddresses = new Set(Object.values(require('node:os').networkInterfaces()).flat().filter(Boolean).map(v => v.address));
        if (visible.some(service => {
          if (service.port !== state.helper.listenerPort || !(service.addresses || []).some(address => localAddresses.has(address))) return false;
          try { const endpoint = Buffer.from(String(service.txt?.n || ''), 'base64url'); return endpoint.length >= 18 && endpoint.subarray(18, 18 + endpoint[17]).toString('utf8') === 'Airdrop S24 Lab'; } catch { return false; }
        })) runtime.advertisements.ownObserved = true;
        runtime.advertisements.maxVisible = Math.max(runtime.advertisements.maxVisible, visible.length);
        runtime.status = runtime.helperStatus === 'error' ? 'failed' : runtime.helperStatus === 'ready' ? 'running' : 'starting';
        runtime.listenerReachableEver=runtime.listenerReachableEver===true||runtime.listenerReachable;
        if(runtime.helperStatus==='ready')runtime.lastActive={listenerReachable:runtime.listenerReachable,checkedAt:new Date().toISOString()};
        save();
      } catch { /* App startup has not yet written sanitized state. */ }
      finally { pollBusy = false; }
    };
    timer = setInterval(poll, 1000); await poll();
    process.once('uncaughtException', () => { void shutdown(true); }); process.once('unhandledRejection', () => { void shutdown(true); });
    process.once('SIGTERM', () => { void shutdown(false); }); process.once('SIGINT', () => { void shutdown(false); });
  } catch { await shutdown(true); }
}
async function stop(options) {
  const root = rootFor(options), marker = markerFor(root);
  try { await control(root, 'stop'); }
  catch {
    const info = await fs.stat(path.join(root, 'run.lock')).catch(() => null);
    if (info && Date.now() - info.mtimeMs < 30000) throw Error('The lab may still be starting; retry --stop in 30 seconds');
    // Recover only stale private IPC files, never signal a persisted process ID.
    for (const name of ['control.sock', 'run.lock']) {
      const file = path.join(root, name); const value = await fs.lstat(file).catch(() => null);
      if (value && (name === 'control.sock' ? value.isSocket() : value.isFile() && !value.isSymbolicLink())) await fs.unlink(file);
    }
    console.log('No responsive lab supervisor. Stale private control files cleaned; no process was signalled.'); return;
  }
  for (let i = 0; i < (marker.bleNativeRequested ? 100 : 40); i++) {
    if (!await active(root) && !sync.existsSync(path.join(root, 'run.lock')) && !sync.existsSync(path.join(root, 'control.sock'))) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (await active(root) || sync.existsSync(path.join(root, 'run.lock'))) throw Error('Lab is still shutting down; do not terminate unrelated services');
  console.log('Lab stopped. Disposable fixtures, received files and sanitized evidence are retained for --collect.');
}
async function collect(options) {
  const root = rootFor(options), marker = markerFor(root);
  let input = {}; try { input = readJson(path.join(root, 'observations.json')); } catch {}
  if (input.run !== marker.run) input = {};
  if ((options.direction && input.direction !== options.direction) || (options.case && input.case !== options.case)) input.stages = {};
  for (const key of ['direction', 'case', 'scenario']) if (options[key]) input[key] = options[key];
  input.stages ||= {}; input.phone ||= {};
  if (options.record) for (const pair of options.record.split(',')) {
    const [key, value] = pair.split('='); if (!/^[C-I]$/.test(key) || !OUTCOMES.has(value)) throw Error('--record uses stages C-I and pass/fail/not-tested/unknown; J requires file readback'); input.stages[key] = value;
  }
  if (process.stdin.isTTY && !options['non-interactive']) {
    const io = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log('Record one native Samsung trial. Never enter a comparison code, address or personal information.');
      const direction = (await io.question('Direction [1 Samsung→Linux / 2 Linux→Samsung, or exact direction name]: ')).trim();
      input.direction = direction === '1' ? 'samsung-to-linux' : direction === '2' ? 'linux-to-samsung' : direction || input.direction;
      if (!['samsung-to-linux', 'linux-to-samsung'].includes(input.direction)) throw Error('Choose direction 1 or 2, or use --direction');
      input.case = (await io.question('Fixture filename, batch or all [lab-small.txt]: ')).trim() || input.case || 'lab-small.txt';
      for (const [key, label] of [['androidVersion', 'Android version'], ['oneUiVersion', 'One UI version'], ['quickShareVersion', 'Quick Share version (unknown if not exposed)']]) input.phone[key] = (await io.question(label + ': ')).trim() || 'unknown';
      input.phone.settings ||= {};
      for (const [key, label] of [['wifiOn', 'Phone Wi-Fi on'], ['bluetoothOn', 'Phone Bluetooth on'], ['sameLan', 'Both devices on the same ordinary LAN']]) {
        const answer = (await io.question(label + ' [yes/no/unknown]: ')).trim(); input.phone.settings[key] = answer === 'yes' ? true : answer === 'no' ? false : null;
      }
      input.phone.settings.visibility = (await io.question('Phone receive visibility [everyone/contacts/none/unknown]: ')).trim();
      input.phone.settings.appleSharing = (await io.question('Share with Apple devices [on/off/not-available/unknown]: ')).trim();
      const keys = input.direction === 'samsung-to-linux' ? ['C', 'E', 'F', 'G', 'H', 'I'] : ['D', 'E', 'F', 'G', 'H', 'I'];
      for (const key of keys) {
        const answer = (await io.question(`${key} ${LABELS[key]} [pass/fail/not-tested/unknown]: `)).trim() || 'not-tested';
        if (!OUTCOMES.has(answer)) throw Error('Use one of the listed outcomes'); input.stages[key] = answer;
      }
    } finally { io.close(); }
  }
  input = observations(input); atomicJson(root, 'observations.json', { run: marker.run, ...input });
  const result = await createReport(root, await preflight(), input, options.readback ? path.resolve(options.readback) : undefined);
  if (options.archive) {
    const archive = 'quickshare-report-' + new Date().toISOString().replace(/[:.]/g, '-') + '.tar.gz';
    const output = await fs.open(path.join(result.directory, archive), 'wx', 0o600);
    try { execFileSync('tar', ['-czf', '-', '-C', result.directory, 'quickshare-test-report.md', 'quickshare-test-results.json'], { stdio: ['ignore', output.fd, 'ignore'] }); }
    finally { await output.close(); }
    console.log('Local sanitized archive: ' + path.join(result.directory, archive));
  }
  console.log('Report: ' + path.join(result.directory, 'quickshare-test-report.md') + '\nJSON: ' + path.join(result.directory, 'quickshare-test-results.json'));
  console.log(result.report.failure.category + ': ' + result.report.failure.summary + '\nNothing uploaded. Attach the two reports or the sanitized archive manually.');
}
async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  switch (options.operation) {
    case 'diagnose': await require('./quickshare-lab/diagnose.cjs').diagnose(options, module.exports); break;
    case 'preflight': printPreflight(await preflight()); break;
    case 'prepare': await prepare(options); break;
    case 'start': await start(options); break;
    case 'supervise': await supervise(options); break;
    case 'status': markerFor(rootFor(options)); console.log(JSON.stringify(await control(rootFor(options), 'status'), null, 2)); break;
    case 'collect': await collect(options); break;
    case 'stop': await stop(options); break;
    default: console.log(HELP);
  }
}
module.exports = { main, parse, rootFor, markerFor, control, prepare, start, stop, collect, listener };
if (require.main === module) main().catch(error => { console.error('Lab operation failed: ' + error.message + '\nRun --preflight or see docs/quickshare-s24-test.md. No raw diagnostics were exported.'); process.exitCode = 1; });
