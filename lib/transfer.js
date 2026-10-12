'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { publishLocal, publishStream, validName } = require('./files');
const { createZip, MAX_ZIP_BYTES } = require('../ui/zip');
async function sendFiles(root, sources, zip = false) {
  if (!sources.length) throw new Error('Select at least one file');
  if (!zip) {
    const results = [];
    for (const source of sources) {
      try { results.push({ ok: true, ...await publishLocal(root, source) }); }
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
    // Read through the validated handles; stop if a source grows past the limit.
    total = 0;
    for (const file of files) {
      const chunks = [];
      for await (const chunk of file.handle.createReadStream({ autoClose: false })) {
        total += chunk.length;
        if (total > MAX_ZIP_BYTES) throw new Error('ZIP source files exceed 100 MiB. Send files separately.');
        chunks.push(chunk);
      }
      file.data = Buffer.concat(chunks);
      file.size = file.data.length;
    }
    const archive = await createZip(files, 'nodebuffer');
    return [{ ok: true, ...await publishStream(root, archive.name, Readable.from([archive.data])) }];
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}
module.exports = { sendFiles };
