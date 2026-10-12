'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const JSZip = require('jszip');
test('installer file/CLI/VAPID blocks support fresh and repeat installation in isolated directories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-installer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = await fs.readFile('install.sh', 'utf8');
  const copy = installer.slice(installer.indexOf('info "Installing Airdrop files..."'), installer.indexOf('# ---------- npm dependencies'));
  const vapid = installer.slice(installer.indexOf('ENV_FILE="$CONFIG_DIR/server.env"'), installer.indexOf('# ---------- Systemd services'));
  const cli = installer.slice(installer.indexOf('# Use the detected Node executable'), installer.indexOf('# Make the local command directory available'));
  const env = { ...process.env, REPO_DIR: process.cwd(), SHARE_DIR: path.join(root, 'share'), PUSH_DIR: path.join(root, 'app/server'), AIRDROP_ROOT: root, UI_DIR: path.join(root, 'app/ui'), CONFIG_DIR: path.join(root, 'config'), STATE_DIR: path.join(root, 'state/push'), LOCAL_BIN_DIR: path.join(root, 'bin'), NODE_BIN: process.execPath };
  const stub = 'set -Eeuo pipefail\ninfo() { :; }; ok() { :; }; fail() { printf "%s\\n" "$1" >&2; exit 1; }\n';
  await run('bash', ['-c', stub + copy], { env });
  await fs.symlink(path.resolve('node_modules'), path.join(env.PUSH_DIR, 'node_modules'));
  await run('bash', ['-c', stub + vapid + cli], { env });
  for (const helper of ['airdrop', 'copy-clipboard', 'paste-clipboard']) await run('bash', ['-n', path.join(env.LOCAL_BIN_DIR, helper)]);
  const original = await fs.readFile(path.join(env.CONFIG_DIR, 'server.env'), 'utf8');
  assert.match(original, /VAPID_PUBLIC_KEY=.+/); assert.match(original, /VAPID_PRIVATE_KEY=.+/);
  assert.equal((await fs.stat(path.join(env.CONFIG_DIR, 'server.env'))).mode & 0o777, 0o600);
  for (const file of ['lib/files.js', 'lib/transfer.js', 'ui/zip.js', 'bin/airdrop.js', 'package-lock.json']) await fs.access(path.join(env.PUSH_DIR, file));
  for (const file of ['vendor/jszip.min.js', 'app.js', 'pending-share.js']) await fs.access(path.join(env.UI_DIR, file));
  const input = path.join(root, 'source file.txt'); await fs.writeFile(input, 'installer smoke');
  const cliEnv = { ...env, WATCH_DIR: env.SHARE_DIR };
  await run(path.join(env.LOCAL_BIN_DIR, 'airdrop'), [input], { env: cliEnv });
  await run(path.join(env.LOCAL_BIN_DIR, 'airdrop'), [input], { env: cliEnv });
  assert.equal(await fs.readFile(path.join(env.SHARE_DIR, 'source file (1).txt'), 'utf8'), 'installer smoke');
  await run(path.join(env.LOCAL_BIN_DIR, 'airdrop'), ['--zip', input], { env: cliEnv });
  const name = (await fs.readdir(env.SHARE_DIR)).find(name => name.endsWith('.zip'));
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(env.SHARE_DIR, name)));
  assert.equal(await zip.file('source file.txt').async('string'), 'installer smoke');
  await run('bash', ['-c', stub + copy + vapid + cli], { env });
  assert.equal(await fs.readFile(path.join(env.CONFIG_DIR, 'server.env'), 'utf8'), original);
  assert.equal(await fs.readFile(path.join(env.SHARE_DIR, 'source file.txt'), 'utf8'), 'installer smoke');
  assert.match((await run('./install-desktop.sh', ['--help'])).stdout, /optional Linux Electron/);
});

test('installer-generated systemd units validate before installation, including paths with spaces', async t => {
  try { await run('systemd-analyze', ['--version']); } catch { t.skip('systemd-analyze is not installed'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-systemd-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = await fs.readFile('install.sh', 'utf8');
  const start = installer.indexOf('  cat > "$TMP_SHARE_SERVICE" <<SERVICE');
  const end = installer.indexOf('  sudo install -m 0644 "$TMP_SHARE_SERVICE"');
  const template = installer.slice(start, end);
  assert.match(template, /systemd-analyze verify/);
  for (const name of ['normal', 'home with spaces']) {
    const appRoot = path.join(root, name);
    const serverDir = path.join(appRoot, 'app/server');
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(appRoot, 'config'));
    await fs.mkdir(path.join(appRoot, 'files'));
    await fs.writeFile(path.join(serverDir, 'push-server.js'), '');
    await fs.writeFile(path.join(appRoot, 'config/server.env'), '');
    const env = { ...process.env, CURRENT_USER: os.userInfo().username, AIRDROP_ROOT: appRoot,
      PUSH_DIR: serverDir, SHARE_DIR: path.join(appRoot, 'files'), ENV_FILE: path.join(appRoot, 'config/server.env'),
      push_node_bin: process.execPath, push_dufs_bin: process.execPath,
      TMP_SHARE_SERVICE: path.join(root, 'airdropshare.service'), TMP_PUSH_SERVICE: path.join(root, 'airdrop-push.service') };
    await run('bash', ['-c', 'set -Eeuo pipefail\nfail() { printf "%s\\n" "$1" >&2; exit 1; }\n' + template], { env });
    const unit = await fs.readFile(env.TMP_SHARE_SERVICE, 'utf8');
    assert.ok(unit.includes(`WorkingDirectory=${appRoot}\n`));
    // Reproduce the original failure to ensure verification catches it.
    await fs.writeFile(env.TMP_SHARE_SERVICE, unit.replace(`WorkingDirectory=${appRoot}`, `WorkingDirectory="${appRoot}"`));
    await assert.rejects(run('systemd-analyze', ['verify', env.TMP_SHARE_SERVICE]), error => /WorkingDirectory=.*path is not absolute/.test(error.stderr));
  }
});
