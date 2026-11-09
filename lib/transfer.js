'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const archiver = require('archiver');
const { publishLocal, publishStream, validName } = require('./files');
const { archiveName, uniqueName, MAX_ZIP_BYTES } = require('../ui/zip');
async function transfer(root, sources, zip = false, options) {
  if (!sources.length) throw new Error('Select at least one file');
  if (!zip) {
    const results = [];
    for (const source of sources) {
      try {
        const original = await fs.promises.lstat(source);
        const existing = await fs.promises.lstat(path.join(root, path.basename(source))).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (original.isFile() && existing?.isFile() && original.ino === existing.ino && original.dev === existing.dev) {
          results.push({ok:true, name:path.basename(source), size:original.size, unchanged:true});
        } else results.push({ ok: true, ...await publishLocal(root, source, options) });
      }
      catch (error) { results.push({ ok: false, name: path.basename(source), error: error.message }); }
    }
    return results;
  }
  const handles = [];
  try {
    const files = [];
    let total = 0;
    for (const source of sources) {
      const handle = await fs.promises.open(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      handles.push(handle);
      const stat = await handle.stat();
      if (!stat.isFile() || !validName(path.basename(source))) throw new Error('Only regular, shareable files can be sent');
      total += stat.size;
      if (total > MAX_ZIP_BYTES) throw new Error('ZIP source files exceed 100 MiB. Send files separately.');
      files.push({ name: path.basename(source), size: stat.size, handle });
    }
    // Stream through validated descriptors with backpressure. Keep the existing
    // size policy, including when a source grows during archive creation.
    const archive = archiver('zip', { store: true });
    const streams = [], used = new Set(); total = 0;
    archive.on('warning', error => archive.destroy(error));
    try {
      for (const file of files) {
        const source = file.handle.createReadStream({ autoClose: false });
        const counter = new Transform({ transform(chunk, encoding, cb) {
          total += chunk.length;
          cb(total > MAX_ZIP_BYTES ? Error('ZIP source files exceed 100 MiB. Send files separately.') : null, chunk);
        } });
        source.on('error', error => counter.destroy(error));
        counter.on('error', error => archive.destroy(error));
        source.pipe(counter); streams.push(source, counter);
        archive.append(counter, { name: uniqueName(file.name, used) });
      }
      const publication = publishStream(root, archiveName(), archive, options);
      const [result] = await Promise.all([publication, archive.finalize()]);
      return [{ ok: true, ...result }];
    } finally { archive.abort(); for (const stream of streams) stream.destroy(); }

  } finally { await Promise.all(handles.map(handle => handle.close())); }
}
async function sendFiles(root, sources, zip = false, options) {
  return require('./maintenance').operation(() => transfer(root, sources, zip, options), options?.maintenanceRoot || (options?.anchored ? require('./paths').getPaths().root : path.dirname(root)));
}
module.exports = { sendFiles };
