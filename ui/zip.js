/* Shared by the browser, CLI and Electron main process. JSZip is bundled locally. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('jszip'));
  else root.AirdropZip = factory(root.JSZip);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JSZip) {
  const MAX_ZIP_BYTES = 100 * 1024 * 1024;
  function archiveName(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `airdrop-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.zip`;
  }
  function uniqueName(name, used) {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; used.has(candidate); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate);
    return candidate;
  }
  async function createZip(files, type = 'blob', onProgress) {
    if (!files.length) throw new Error('Select at least one file');
    if (files.reduce((n, f) => n + f.size, 0) > MAX_ZIP_BYTES) throw new Error('ZIP source files exceed 100 MiB. Send files separately.');
    const zip = new JSZip();
    const used = new Set();
    for (const file of files) {
      if (!file.name || /[\/\\\x00-\x1f]/.test(file.name) || file.name === '.' || file.name === '..') throw new Error('Invalid archive file name');
      const data = file.data !== undefined ? file.data : await file.arrayBuffer();
      zip.file(uniqueName(file.name, used), data);
    }
    return { name: archiveName(), data: await zip.generateAsync({ type, compression: 'STORE' }, onProgress) };
  }
  return { MAX_ZIP_BYTES, archiveName, uniqueName, createZip };
});
