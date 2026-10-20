'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getPaths } = require('./paths');
const unavailable = () => Object.assign(new Error('Airdrop is updating. Try again shortly.'), { status: 503 });
async function acquire(root = getPaths().root) {
  const state = path.join(root, 'state/operations');
  const marker = path.join(root, 'state/update-lock.json');
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  async function check() { try { await fs.access(marker); throw unavailable(); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  await check();
  const lease = path.join(state, `${process.pid}-${randomUUID()}`);
  await fs.writeFile(lease, '', { flag: 'wx', mode: 0o600 });
  try { await check(); } catch (error) { await fs.unlink(lease); throw error; }
  return () => fs.unlink(lease).catch(() => {});
}
async function operation(fn, root) { const release = await acquire(root); try { return await fn(); } finally { await release(); } }
async function drain(root, timeout = 120000) {
  const dir = path.join(root, 'state/operations'); const until = Date.now() + timeout;
  while (true) {
    let entries = [];
    try { entries = await fs.readdir(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let active = false;
    for (const name of entries) {
      const pid = Number(name.split('-')[0]);
      try { process.kill(pid, 0); active = true; }
      catch (error) { if (error.code === 'ESRCH') await fs.unlink(path.join(dir, name)).catch(() => {}); else throw error; }
    }
    if (!active) return;
    if (Date.now() >= until) throw new Error('Transfers are still running. Retry the update when they finish.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
module.exports = { acquire, operation, drain };
