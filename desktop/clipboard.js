'use strict';
const fs = require('node:fs');
const path = require('node:path');
const MAX_TEXT_BYTES = 1024 * 1024;
function validateText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('Clipboard text must be at most 1 MiB.');
}
async function rootDirectory(root) {
  const stat = await fs.promises.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Share directory must be a real directory');
  return fs.promises.realpath(root);
}
async function readSharedClipboard(root) {
  let handle;
  try {
    root = await rootDirectory(root);
    handle = await fs.promises.open(path.join(root, '.clipboard.txt'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Shared clipboard must be a regular text file.');
    if (stat.size > MAX_TEXT_BYTES) throw new Error('Clipboard text must be at most 1 MiB.');
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_TEXT_BYTES) throw new Error('Clipboard text must be at most 1 MiB.');
    return buffer.subarray(0, total).toString('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { if (handle) await handle.close(); }
}
async function writeSharedClipboard(root, text) {
  validateText(text);
  await fs.promises.mkdir(root, { recursive: true });
  root = await rootDirectory(root);
  const temp = await fs.promises.mkdtemp(path.join(root, '.airdrop-clipboard-'));
  try {
    const source = path.join(temp, 'text');
    await fs.promises.writeFile(source, text, { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(source, path.join(root, '.clipboard.txt'));
  } finally { await fs.promises.rm(temp, { recursive: true, force: true }); }
}
module.exports = { readSharedClipboard, writeSharedClipboard, validateText };
