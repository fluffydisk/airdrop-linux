'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name !== 'ui' &&
    !name.startsWith('.') && !/[\/\\\x00-\x1f\x7f]/.test(name) && Buffer.byteLength(name) <= 240;
}
function numberedName(name, count) {
  const ext = path.extname(name);
  return count ? `${name.slice(0, name.length - ext.length)} (${count})${ext}` : name;
}
async function rootDirectory(root) {
  const stat = await fsp.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Share directory must be a real directory');
  return fsp.realpath(root);
}
async function publishStream(root, name, stream) {
  if (!validName(name)) throw Object.assign(new Error('Invalid file name'), { status: 400 });
  await fsp.mkdir(root, { recursive: true });
  root = await rootDirectory(root);
  const tempDir = await fsp.mkdtemp(path.join(root, '.airdrop-'));
  const temp = path.join(tempDir, 'upload');
  try {
    await pipeline(stream, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
    const size = (await fsp.stat(temp)).size;
    for (let count = 0; ; count++) {
      const storedName = numberedName(name, count);
      try {
        // An exclusive hard link publishes the complete file without overwriting a race winner.
        await fsp.link(temp, path.join(root, storedName));
        return { name: storedName, size };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}
async function openSharedFile(root, name) {
  if (!validName(name)) throw Object.assign(new Error('Invalid file name'), { status: 400 });
  root = await rootDirectory(root);
  let handle;
  try {
    handle = await fsp.open(path.join(root, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (!(await handle.stat()).isFile()) throw Object.assign(new Error('Not a regular file'), { status: 400 });
    return handle;
  } catch (error) {
    if (handle) await handle.close();
    if (['ENOENT', 'ELOOP'].includes(error.code)) error.status = error.code === 'ENOENT' ? 404 : 400;
    throw error;
  }
}
async function publishLocal(root, source) {
  const handle = await fsp.open(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Only regular files can be sent');
    return await publishStream(root, path.basename(source), handle.createReadStream({ autoClose: false }));
  } finally { await handle.close(); }
}
module.exports = { validName, numberedName, rootDirectory, publishStream, publishLocal, openSharedFile };
