'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { rootDirectory } = require('./files');
async function initialize(paths) {
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  await rootDirectory(paths.root);
  for (const dir of [paths.files, paths.config, paths.pushState, paths.desktopData, paths.backups]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Application data folders must not be symbolic links');
  }
  try { await fs.access(paths.env); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const { generateVAPIDKeys } = require('web-push');
    const keys = generateVAPIDKeys();
    await fs.writeFile(paths.env, `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_CONTACT_EMAIL=mailto:example@example.com\n`, { flag: 'wx', mode: 0o600 });
  }
  const stat = await fs.lstat(paths.env);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid credential file');
  await fs.chmod(paths.env, 0o600);
}
module.exports = { initialize };
