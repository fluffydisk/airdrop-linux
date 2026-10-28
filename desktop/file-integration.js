'use strict';
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile, spawn } = require('node:child_process');
const { fileURLToPath } = require('node:url');

// The Flatpak portal receives a directory FD, so /var/data is resolved on the
// host without granting home access or invoking a command outside the sandbox.
async function openFolder(directory, { flatpak, shell, execute = promisify(execFile) }) {
  if (flatpak) {
    await execute('/app/bin/airdrop-open-directory', [directory], { timeout: 65000 });
  } else {
    const error = await shell.openPath(directory);
    if (error) throw new Error(`Could not open folder: ${error}`);
  }
}

async function dragFiles(root, paths, explorer, start) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 100 || !paths.every(p => typeof p === 'string')) throw new Error('Select 1–100 shared files to drag');
  const files = [], descriptors = [];
  // Keep validated descriptors alive throughout the native drag operation.
  async function visit(index) {
    if (index === paths.length) return start(files, descriptors);
    return explorer.openFile(root, paths[index], (file, descriptor) => {
      files.push(path.resolve(file));
      descriptors.push(descriptor);
      return visit(index + 1);
    });
  }
  return visit(0);
}
function withPortalFiles(files, descriptors, start) {
  return new Promise((resolve, reject) => {
    const child = spawn('/app/bin/airdrop-open-directory', ['--export', ...files], {stdio:['pipe','pipe','pipe',...descriptors]});
    let output = '', errorOutput = '', ready = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Document portal did not respond')); }, 15000);
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', data => { errorOutput = (errorOutput + data).slice(-2000); });
    child.on('close', () => { clearTimeout(timer); if (!ready) reject(new Error(errorOutput || 'Document portal could not export these files')); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024 * 1024) { child.kill(); return; }
      if (ready || !output.endsWith('\nready\n')) return;
      ready = true; clearTimeout(timer);
      try {
        const exported = output.trimEnd().split('\n').slice(0,-1).map(fileURLToPath);
        if (exported.length !== files.length) throw new Error('Incomplete document portal export');
        start(exported); resolve();
      } catch (error) { reject(error); }
      finally { child.stdin.end(); }
    });
  });
}
async function retrieveClipboardFiles(key) {
  if (typeof key !== 'string' || !key || key.length > 4096 || /[\x00-\x1f\x7f]/.test(key)) throw new Error('Invalid clipboard transfer key. Copy the files again.');
  let stdout;
  try { ({stdout} = await promisify(execFile)('/app/bin/airdrop-open-directory', ['--retrieve', key], {timeout:15000,maxBuffer:1024*1024})); }
  catch { throw new Error('Clipboard file transfer expired or is unavailable. Copy the files again or use Choose files.'); }
  const files = stdout.trimEnd().split('\n').filter(Boolean).map(fileURLToPath);
  if (!files.length || files.length > 1000) throw new Error('Copy 1–1000 files');
  return files;
}
module.exports = { openFolder, dragFiles, withPortalFiles, retrieveClipboardFiles };
