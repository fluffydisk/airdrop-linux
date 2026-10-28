'use strict';
// Linux directory descriptors keep every operation anchored to the shared tree,
// including when an intermediate name is replaced with a symbolic link.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { validName, numberedName, rootDirectory, publishStream } = require('./files');
const bad = message => Object.assign(new Error(message), { status: 400 });
function parts(relative = '') {
  if (typeof relative !== 'string' || relative.length > 4096 || relative.startsWith('/') || relative.includes('\\')) throw bad('Invalid shared path');
  if (!relative) return [];
  const names = relative.split('/');
  if (!names.every(validName)) throw bad('Invalid shared path');
  return names;
}
const join = (dir, name) => dir ? `${dir}/${name}` : name;
async function directory(root, relative = '', internal = false) {
  const names = internal ? relative.split('/').filter(Boolean) : parts(relative);
  const canonical = await rootDirectory(root);
  let handle = await fsp.open(canonical, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    for (const name of names) {
      const next = await fsp.open(`/proc/self/fd/${handle.fd}/${name}`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      await handle.close(); handle = next;
    }
    const anchored = `/proc/self/fd/${handle.fd}`;
    const actual = await fsp.realpath(anchored);
    if (actual !== canonical && !actual.startsWith(canonical + '/')) throw bad('Folder is outside the shared root');
    return { path: anchored, close: () => handle.close() };
  } catch (error) { await handle.close(); throw error; }
}
async function withParent(root, relative, callback) {
  const names = parts(relative);
  if (!names.length) throw bad('The shared root cannot be changed');
  const name = names.pop(); const parent = await directory(root, names.join('/'));
  try { return await callback(`${parent.path}/${name}`, name, parent.path); }
  finally { await parent.close(); }
}
function selection(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 1000) throw bad('Select 1–1000 items');
  paths.forEach(item => { if (!parts(item).length) throw bad('Select a file or folder'); });
  return [...new Set(paths)].filter(item => !paths.some(other => item !== other && item.startsWith(other + '/')));
}
async function list(root, relative = '') {
  const dir = await directory(root, relative);
  try {
    const entries = await fsp.readdir(dir.path, { withFileTypes: true });
    const result = await Promise.all(entries.filter(entry => validName(entry.name)).map(async entry => {
      try {
        const stat = await fsp.lstat(`${dir.path}/${entry.name}`);
        if (!stat.isFile() && !stat.isDirectory()) return null;
        return { name: entry.name, path: join(relative, entry.name), type: stat.isDirectory() ? 'directory' : 'file', size: stat.size, modified: stat.mtimeMs };
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }));
    return result.filter(Boolean).sort((a, b) => (b.type === 'directory') - (a.type === 'directory') || a.name.localeCompare(b.name));
  } finally { await dir.close(); }
}
async function openFile(root, relative, open) {
  return withParent(root, relative, async source => {
    const handle = await fsp.open(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw bad('Only regular files can be opened');
      const canonical = await rootDirectory(root);
      const actual = await fsp.realpath(`/proc/self/fd/${handle.fd}`);
      if (!actual.startsWith(canonical + '/')) throw bad('File is outside the shared root');
      const current = await fsp.lstat(actual);
      if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino) throw bad('File changed before it could be opened');
      return await open(actual, handle.fd);
    } finally { await handle.close(); }
  });
}
async function uniqueDirectory(parent, name) {
  if (!validName(name)) throw bad('Invalid folder name');
  for (let count = 0; ; count++) {
    const candidate = numberedName(name, count);
    try { await fsp.mkdir(`${parent}/${candidate}`, { mode: 0o700 }); return candidate; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
async function mkdir(root, relative, name) {
  const dir = await directory(root, relative);
  try { const stored = await uniqueDirectory(dir.path, name); return { name: stored, path: join(relative, stored) }; }
  finally { await dir.close(); }
}
async function upload(root, relative, name, stream) {
  const dir = await directory(root, relative);
  try {
    // publishStream needs a real directory as root; the descriptor path is a
    // trusted procfs reference rather than an untrusted user-supplied link.
    return { ...await publishStream(dir.path, name, stream, { anchored: true }), directory: relative };
  } finally { await dir.close(); }
}
async function collect(root, paths) {
  paths = selection(paths);
  const files = [];
  async function visit(relative, archivePath) {
    await withParent(root, relative, async (source) => {
      const stat = await fsp.lstat(source);
      if (stat.isDirectory()) {
        const children = await list(root, relative);
        files.push({ name: archivePath + '/', directory: true });
        if (files.length > 1000) throw bad('Select at most 1000 files and folders');
        // Hidden files and links inside a selected folder must not be copied.
        const dir = await directory(root, relative);
        try {
          const actual = await fsp.readdir(dir.path);
          if (actual.some(name => validName(name) && !children.some(child => child.name === name))) throw bad('Folders containing links or special files cannot be copied or downloaded');
        } finally { await dir.close(); }
        for (const child of children) await visit(child.path, archivePath + '/' + child.name);
      } else {
        const handle = await fsp.open(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        if (!(await handle.stat()).isFile()) { await handle.close(); throw bad('Only regular files and folders are supported'); }
        files.push({ name: archivePath, handle });
        if (files.length > 1000) throw bad('Select at most 1000 files and folders');
      }
    });
  }
  try {
    for (const relative of paths) await visit(relative, relative); // preserve relative hierarchy
    return files;
  } catch (error) { await Promise.all(files.filter(file => file.handle).map(file => file.handle.close())); throw error; }
}
async function copy(root, relative, paths, name) {
  paths = selection(paths);
  const files = await collect(root, paths);
  let dir, stage, reserved;
  try {
    dir = await directory(root, relative);
    if (!validName(name)) throw bad('Invalid folder name');
    stage = await fsp.mkdtemp(`${dir.path}/.airdrop-copy-`);
    for (const file of files) {
      const source = paths.find(item => file.name === item || file.name.startsWith(item + '/'));
      const target = path.join(stage, path.posix.basename(source), file.name.slice(source.length));
      if (file.directory) await fsp.mkdir(target, { recursive: true, mode: 0o700 });
      else {
        await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await pipeline(file.handle.createReadStream({ autoClose: false }), fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      }
    }
    reserved = await uniqueDirectory(dir.path, name);
    await fsp.rename(stage, `${dir.path}/${reserved}`); stage = null;
    return { name: reserved, path: join(relative, reserved) };
  } catch (error) { if (reserved) await fsp.rmdir(`${dir.path}/${reserved}`).catch(() => {}); throw error; }
  finally { if (stage) await fsp.rm(stage, { recursive: true, force: true }); if (dir) await dir.close(); await Promise.all(files.filter(file => file.handle).map(file => file.handle.close())); }
}
async function trashRoot(root) {
  const dir = await directory(root);
  try { await fsp.mkdir(`${dir.path}/.airdrop-trash`, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); }
  finally { await dir.close(); }
  return directory(root, '.airdrop-trash', true);
}
async function trash(root, paths) {
  paths = selection(paths);
  const dir = await trashRoot(root); const results = [];
  try {
    for (const relative of paths) {
      try {
        const id = randomUUID();
        await withParent(root, relative, async source => {
          const stat = await fsp.lstat(source);
          if (!stat.isFile() && !stat.isDirectory()) throw bad('Links and special files cannot be deleted');
          await fsp.mkdir(`${dir.path}/${id}`, { mode: 0o700 });
          const record = { id, path: relative, name: path.posix.basename(relative), deleted: Date.now(), type: stat.isDirectory() ? 'directory' : 'file' };
          await fsp.writeFile(`${dir.path}/${id}/metadata.json`, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
          await fsp.rename(source, `${dir.path}/${id}/item`);
          results.push({ ...record, ok: true });
        });
      } catch (error) { results.push({ path: relative, ok: false, error: error.message }); }
    }
    return results;
  } finally { await dir.close(); }
}
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
async function trashList(root) {
  const dir = await trashRoot(root);
  try {
    const result = [];
    for (const id of await fsp.readdir(dir.path)) {
      if (!validId(id)) continue;
      const item = await directory(root, `.airdrop-trash/${id}`, true);
      try {
        const meta = await fsp.open(`${item.path}/metadata.json`, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const record = JSON.parse(await meta.readFile('utf8')); parts(record.path);
          await fsp.lstat(`${item.path}/item`);
          result.push({ ...record, id });
        } finally { await meta.close(); }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      finally { await item.close(); }
    }
    return result.sort((a, b) => b.deleted - a.deleted);
  } finally { await dir.close(); }
}
async function restore(root, id) {
  if (!validId(id)) throw bad('Invalid trash item');
  const record = (await trashList(root)).find(item => item.id === id);
  if (!record) throw Object.assign(new Error('Trash item not found'), { status: 404 });
  const source = await directory(root, `.airdrop-trash/${id}`, true);
  try {
    return await withParent(root, record.path, async (destination, name, parent) => {
      const stat = await fsp.lstat(`${source.path}/item`);
      let stored;
      if (stat.isDirectory()) {
        stored = await uniqueDirectory(parent, name);
        await fsp.rename(`${source.path}/item`, `${parent}/${stored}`);
      } else if (stat.isFile()) {
        for (let count = 0; ; count++) {
          stored = numberedName(name, count);
          try { await fsp.link(`${source.path}/item`, `${parent}/${stored}`); break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        await fsp.unlink(`${source.path}/item`);
      } else throw bad('Invalid trash item');
      await fsp.unlink(`${source.path}/metadata.json`);
      return { name: stored, path: join(path.posix.dirname(record.path) === '.' ? '' : path.posix.dirname(record.path), stored) };
    });
  } finally { await source.close(); }
}
async function download(root, paths) {
  const files = await collect(root, paths);
  const single = files.length === 1 && !files[0].directory;
  let stream;
  const inputs = []; let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    inputs.forEach(input => input.destroy());
    return Promise.all(files.filter(file => file.handle).map(file => file.handle.close().catch(() => {})));
  };
  if (single) {
    stream = files[0].handle.createReadStream({ autoClose: false });
  } else {
    stream = require('archiver')('zip', { store: true });
    for (const file of files) {
      if (file.directory) stream.append('', { name: file.name });
      else {
        const input = file.handle.createReadStream({ autoClose: false });
        inputs.push(input);
        input.on('error', error => stream.destroy(error));
        stream.append(input, { name: file.name });
      }
    }
    // Finalize after the consumer has attached its error handlers.
    queueMicrotask(() => stream.finalize().catch(error => stream.destroy(error)));
  }
  stream.once('close', close); stream.once('end', close); stream.once('error', close);
  return { stream, name: single ? path.posix.basename(files[0].name) : `airdrop-${Date.now()}.zip`, type: single ? 'application/octet-stream' : 'application/zip' };
}
module.exports = { parts, directory, list, openFile, mkdir, upload, copy, trash, trashList, restore, download, collect };
