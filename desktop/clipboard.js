'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
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
async function readClipboardFile(clipboard, nativeImage) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (typeof clipboard.read === 'function') {
    const items = await clipboard.read();
    for (const item of items) {
      const type = item.types.find(type => type.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      if (image.isEmpty()) throw new Error('Could not decode clipboard image');
      return { name: `clipboard-${stamp}.png`, data: image.toPNG() };
    }
    const item = items.find(item => item.types.includes('text/plain'));
    const text = item ? await (await item.getType('text/plain')).text() : '';
    validateText(text);
    if (!text) throw new Error('Clipboard has no supported image or text');
    return { name: `clipboard-${stamp}.txt`, data: Buffer.from(text, 'utf8') };
  }
  // Compatibility with installations built against older Electron runtimes.
  const image = clipboard.readImage();
  if (!image.isEmpty()) return { name: `clipboard-${stamp}.png`, data: image.toPNG() };
  const text = await clipboard.readText(); validateText(text);
  if (!text) throw new Error('Clipboard has no supported image or text');
  return { name: `clipboard-${stamp}.txt`, data: Buffer.from(text, 'utf8') };
}
function parseClipboardFiles(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error('Invalid clipboard file list');
  const lines = text.split(/\r?\n/).filter(line => line && !line.startsWith('#') && !['copy','cut'].includes(line));
  if (!lines.length || lines.length > 1000) throw new Error('Copy 1–1000 files');
  return lines.map(line => {
    const url = new URL(line);
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.search || url.hash) throw new Error('Only local clipboard files can be shared');
    return fileURLToPath(url);
  });
}
async function readClipboardFiles(clipboard) {
  const formats = ['text/uri-list', 'x-special/gnome-copied-files'];
  if (typeof clipboard.read === 'function') {
    for (const item of await clipboard.read()) {
      const format = formats.find(type => item.types.includes(type));
      if (format) return parseClipboardFiles(await (await item.getType(format)).text());
    }
  }
  if (typeof clipboard.availableFormats === 'function' && typeof clipboard.readBuffer === 'function') {
    const available = clipboard.availableFormats();
    const format = formats.find(type => available.includes(type));
    if (format) return parseClipboardFiles(clipboard.readBuffer(format).toString('utf8'));
  }
  return null;
}
module.exports = { readSharedClipboard, writeSharedClipboard, validateText, readClipboardFile, readClipboardFiles, parseClipboardFiles };
