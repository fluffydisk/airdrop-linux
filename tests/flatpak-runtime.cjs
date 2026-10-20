'use strict';
// Executed by the packager in an uninstalled, network-isolated Flatpak sandbox.
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
(async () => {
  const root = await fs.mkdtemp('/tmp/airdrop-runtime-');
  const child = spawn(process.execPath, ['/app/airdrop/server/scripts/user-service.js'], {
    env: { ...process.env, AIRDROP_HOME: root, AIRDROP_APP_DIR: '/app/airdrop', AIRDROP_SESSION_MONITOR: '0' }, stdio: 'inherit'
  });
  const exited = once(child, 'exit');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null) throw new Error('Sandbox server exited before becoming ready');
      try { ready = (await fetch('http://127.0.0.1:6001/push/health')).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Sandbox API became ready');
    assert.ok((await fetch('http://127.0.0.1:5000/')).ok, 'Bundled file server became ready');
    assert.ok((await fetch('http://127.0.0.1:6001/ui/')).ok, 'Bundled web UI is available');
    const upload = await fetch('http://127.0.0.1:6001/push/explorer/file?name=sandbox.txt', { method: 'PUT', body: 'İstanbul sandbox' });
    assert.ok(upload.ok, await upload.text());
    assert.equal(await fs.readFile(root + '/files/sandbox.txt', 'utf8'), 'İstanbul sandbox');
    console.log('Flatpak isolated runtime: both servers, web UI and upload passed.');
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited; clearTimeout(timer);
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
