#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const { getPaths } = require('../lib/paths');
const { initialize } = require('../lib/session');
const paths = getPaths();
async function portFree(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the other Airdrop installation before starting this one.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
async function main() {
  await initialize(paths);
  if (process.argv.includes('--init')) return;
  const marker = path.join(paths.root, 'state/update-lock.json');
  if (process.argv.includes('--prepare-stop')) {
    await fsp.writeFile(marker, JSON.stringify({ pid: process.pid, serviceStop: true }), { flag: 'wx', mode: 0o600 });
    try { await require('../lib/maintenance').drain(paths.root, 120000); }
    catch (error) { await fsp.unlink(marker); throw error; }
    return;
  }
  try {
    const saved = JSON.parse(await fsp.readFile(marker, 'utf8'));
    if (saved.serviceStop) {
      let alive = true; try { process.kill(saved.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      if (!alive) await fsp.unlink(marker);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await portFree(5000); await portFree(6001);
  const env = { ...process.env, ...require('dotenv').parse(await fsp.readFile(paths.env)), AIRDROP_HOME: paths.root, AIRDROP_APP_DIR: paths.app,
    WATCH_DIR: paths.files, AIRDROP_STATE_DIR: paths.pushState, AIRDROP_UI_DIR: paths.ui, PORT: '6001', NODE_ENV: 'production' };
  const children = [spawn(path.join(paths.app, 'runtime/dufs'), [paths.files, '--bind', '127.0.0.1', '--port', '5000', '--allow-upload', '--allow-delete', '--allow-search', '--allow-archive', '--render-try-index', '--hidden', '.airdrop-*'], { env, stdio: 'inherit' }),
    spawn(process.execPath, [path.join(paths.server, 'push-server.js')], { env, stdio: 'inherit' })];
  let stopping = false, sessionMonitor;
  async function stop(code = 0) {
    if (stopping) return; stopping = true; clearInterval(sessionMonitor);
    try {
      try { await fsp.writeFile(marker, JSON.stringify({ pid: process.pid, serviceStop: true }), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await require('../lib/maintenance').drain(paths.root, 120000);
    } catch (error) { console.error(error.message); }
    const finished = children.map(child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }));
    const timeout = setTimeout(() => children.forEach(child => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }), 30000);
    await Promise.all(finished); clearTimeout(timeout); process.exitCode = code;
  }
  children.forEach(child => { child.once('error', error => { console.error(error.message); stop(1); }); child.once('exit', () => { if (!stopping) stop(1); }); });
  if (process.env.AIRDROP_SESSION_MONITOR === '1') {
    sessionMonitor = setInterval(async () => {
      if (stopping) return;
      try {
        const { stdout } = await exec('/usr/bin/loginctl', ['list-sessions', '--no-legend', '--no-pager'], { timeout: 3000 });
        const sessions = stdout.split('\n').map(line => line.trim().split(/\s+/)).filter(parts => Number(parts[1]) === process.getuid());
        let graphical = false;
        for (const session of sessions) {
          const value = await exec('/usr/bin/loginctl', ['show-session', session[0], '-p', 'Type', '-p', 'State'], { timeout: 3000 });
          if (/Type=(x11|wayland)/.test(value.stdout) && !/State=closing/.test(value.stdout)) graphical = true;
        }
        if (!graphical) await stop();
      } catch { /* A transient logind failure must not interrupt transfers. */ }
    }, 5000);
  }
  process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop());
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
