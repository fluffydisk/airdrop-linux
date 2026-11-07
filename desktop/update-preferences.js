'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const INTERVAL = 6 * 60 * 60 * 1000;
async function read(directory) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(directory, 'updates.json'), 'utf8'));
    return { automatic: value.automatic !== false };
  } catch (error) {
    if (error.code === 'ENOENT') return { automatic: true };
    // An unreadable preference must not silently enable network requests.
    return { automatic: false };
  }
}
async function write(directory, automatic) {
  if (typeof automatic !== 'boolean') throw Error('Invalid automatic update preference');
  const file = path.join(directory, 'updates.json'), temp = file + '.' + randomUUID();
  try {
    await fs.writeFile(temp, JSON.stringify({ automatic }), { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
  return { automatic };
}
function due({ automatic, busy, sending, lastAttempt = 0, now = Date.now() }) {
  return automatic && !busy && !sending && now - lastAttempt >= INTERVAL;
}
module.exports = { read, write, due, INTERVAL };
