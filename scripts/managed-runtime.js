#!/usr/bin/env node
'use strict';
// This entry point is shared by native user units, Flatpak and Snap.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const code = path.resolve(__dirname, '../..');
process.env.AIRDROP_CODE_DIR = code;
process.env.AIRDROP_INSTALL_MANIFEST = path.join(code, 'distribution.json');
const { distribution } = require('../lib/installation');
const { getPaths } = require('../lib/paths');
const { initialize, record, available, read, runtimeConfig, saveRuntimeConfig } = require('../lib/manage');
const dist = distribution();
const version = require('../package.json').version;
if (!['flatpak','snap'].includes(dist.source) && !process.env.AIRDROP_HOME) {
  try { const config=JSON.parse(fs.readFileSync(runtimeConfig(),'utf8')); if(config.source!==dist.source)throw new Error('Runtime installation source mismatch'); process.env.AIRDROP_HOME=config.root; }
  catch(error){if(error.code!=='ENOENT')throw error;}
}
if (dist.source === 'snap') process.env.AIRDROP_HOME = path.join(process.env.SNAP_USER_COMMON, 'airdrop');
const paths = getPaths();
const action = process.argv[2] || 'desktop';
const children = [];
let controlServer;
function child(command, args, options = {}) {
  const proc = spawn(command, args, { stdio:'inherit', ...options }); children.push(proc);
  proc.on('error', error => { console.error(error.message); shutdown(1); });
  return proc;
}
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  controlServer?.close();
  for (const proc of children) proc.kill('SIGTERM');
  const timeout = setTimeout(() => { for (const proc of children) proc.kill('SIGKILL'); process.exit(code); }, 5000);
  Promise.all(children.map(proc => proc.exitCode !== null ? Promise.resolve() : new Promise(resolve => proc.once('exit',resolve)))).then(()=>{ clearTimeout(timeout); process.exit(code); });
}
process.on('SIGTERM',()=>shutdown()); process.on('SIGINT',()=>shutdown());
async function prepare() {
  const marker = await read(path.join(paths.root,'state/installation.json'));
  if (marker && marker.source !== dist.source) throw new Error('Existing installation found. Run airdrop setup --migrate explicitly.');
  if (!marker && fs.existsSync(path.join(paths.root,'app/server'))) throw new Error('Existing script installation found. Migrate explicitly with airdrop setup --migrate.');
  await initialize(paths); await record(paths, await saveRuntimeConfig(paths,dist.source), dist.source);
}
async function backend() {
  await available(5000); await available(6001); await prepare();
  const dufs = child(path.join(code,'runtime/dufs'), [paths.files,'--bind','127.0.0.1','--port','5000','--allow-upload','--allow-delete','--allow-search','--allow-archive','--render-try-index','--hidden','.airdrop-*']);
  process.env.AIRDROP_ENV_FILE = paths.env; process.env.AIRDROP_UI_DIR = paths.ui;
  const api = child(path.join(code,'runtime/node'), [path.join(code,'server/push-server.js')]);
  for (const proc of [dufs,api]) proc.once('exit',exit => { if (!stopping) shutdown(exit || 1); });
  for (let i=0;i<50;i++) {
    try {
      const h=await fetch('http://127.0.0.1:6001/push/health');
      if (h.ok && (await fetch('http://127.0.0.1:5000/')).ok) {
        if (dist.source === 'snap') controlServer = await require('../lib/backend-control').listen(paths.root, version, () => shutdown());
        return;
      }
    } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Backend health check failed');
}
async function main() {
  if (!dist.managed) throw new Error('Missing package distribution marker');
  if (action === 'cli') {
    require('../bin/airdrop'); return;
  }
  if (action === 'backend') { await backend(); return; }
  if (action !== 'desktop') throw new Error('Unknown runtime action');
  if (dist.source === 'flatpak') await prepare();
  else if (dist.source === 'snap') {
    await prepare();
    try {
      const status = await require('../lib/backend-control').request(paths.root);
      if (status.version !== version) throw new Error('A different Airdrop version owns the user service. Restart that service from the host.');
      process.env.AIRDROP_SNAP_BACKGROUND = '1';
    } catch (error) {
      if (!['ENOENT','ECONNREFUSED'].includes(error.code)) throw error;
      await backend();
      process.env.AIRDROP_SNAP_BACKGROUND = '0';
    }
  } else {
    await prepare();
    let active=false;
    try { execFileSync('systemctl',['--user','is-active','--quiet','airdrop-linux-backend.service']); active=true; } catch {}
    if(!active){await available(5000);await available(6001);}
    execFileSync('systemctl',['--user','enable','--now','airdrop-linux.target'],{stdio:'inherit'});
  }
  const executable=path.join(code,'desktop/Airdrop');
  const gui = dist.source === 'flatpak' ? child('zypak-wrapper',[executable,...process.argv.slice(3)],{stdio:['inherit','pipe','inherit']}) : child(executable,process.argv.slice(3));
  if(dist.source==='flatpak') {
    let output='',started=false;
    gui.stdout.on('data',chunk=>{
      output=(output+chunk).slice(-4096);
      if(!started && output.includes('AIRDROP_START_BACKEND')){started=true;backend().catch(error=>{console.error(error.message);shutdown(1);});}
    });
  }
  gui.once('exit',exit=>shutdown(exit || 0));
}
main().catch(error=>{console.error(error.message);shutdown(1);});
