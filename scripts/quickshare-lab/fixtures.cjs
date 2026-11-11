'use strict';
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicJson, atomicText, LAB_FIXTURES } = require('../../lib/sharing/lab-evidence');
const ROOT = path.resolve(__dirname, '../..');
const fixtureNames = LAB_FIXTURES;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function prepareFixtures(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Unsafe fixture directory');
  const data = new Map([
    ['lab-empty.bin', Buffer.alloc(0)], ['lab-small.txt', Buffer.from('Airdrop Linux native Quick Share S24+ laboratory\n', 'utf8')],
    ['lab-unicode-日本語-é.txt', Buffer.from('Deterministic UTF-8 fixture: 日本語 é 🙂\n', 'utf8')],
  ]);
  for (const [name, size] of [['lab-binary.bin', 65537], ['lab-medium.bin', 2 * 1024 * 1024 + 17]]) {
    const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = i % 256; data.set(name, bytes);
  }
  for (const name of ['lab-image.png', 'lab-image.jpg']) data.set(name, await fs.readFile(path.join(ROOT, 'tests/fixtures/quickshare-lab', name)));
  for (let i = 1; i <= 8; i++) data.set(`lab-batch-${i}.txt`, Buffer.from(`Quick Share disposable batch fixture ${i}\n`));
  const manifest = {};
  for (const name of fixtureNames) {
    const bytes = data.get(name), file = path.join(directory, name);
    // Never truncate a previous fixture or follow a link on prepare.
    try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = await fs.open(file, sync.constants.O_RDONLY | sync.constants.O_NOFOLLOW | sync.constants.O_NONBLOCK);
        const info = await existing.stat(); if (!info.isFile() || info.size !== bytes.length || sha(await existing.readFile()) !== sha(bytes)) throw Error();
      } catch { throw Error('Existing fixture differs; use a new --workspace directory'); }
      finally { await existing?.close(); }
    }
    manifest[name] = { size: bytes.length, sha256: sha(bytes) };
  }
  atomicJson(directory, 'fixture-manifest.json', manifest);
  atomicText(directory, 'SHA256SUMS', fixtureNames.map(name => manifest[name].sha256 + '  ' + name).join('\n') + '\n');
  return manifest;
}
async function hashDirectory(directory, expected) {
  if (!directory) return { checked: [], ignored: 0, available: false };
  const info = await fs.lstat(directory).catch(() => null);
  if (!info) return { checked: [], ignored: 0, available: false };
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Readback must be a real directory');
  const checked = []; let ignored = 0;
  const names = (await fs.readdir(directory)).sort();
  if (names.length > 1000) throw Error('Readback directory contains too many entries; use a disposable fixture-only directory');
  for (const name of names) {
    const canonical = name.replace(/ \([1-9][0-9]{0,2}\)(?=\.[^.]+$)/, '');
    if (!fixtureNames.includes(canonical) || !expected[canonical]) { ignored++; continue; }
    let handle;
    try {
      handle = await fs.open(path.join(directory, name), sync.constants.O_RDONLY | sync.constants.O_NOFOLLOW | sync.constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile()) { ignored++; continue; }
      const reference = expected[canonical];
      if (stat.size !== reference.size) { checked.push({ fixture: canonical, result: 'mismatch', reason: 'SIZE_MISMATCH', size: stat.size }); continue; }
      const hash = crypto.createHash('sha256');
      // Bounded fixtures only. Do not hash arbitrary personal files or large inputs.
      let size = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; if (size > reference.size) throw Error('Fixture changed while hashing'); hash.update(chunk); }
      const actual = hash.digest('hex');
      checked.push({ fixture: canonical, size, sha256: actual, expectedSha256: reference.sha256, result: size === reference.size && actual === reference.sha256 ? 'match' : 'mismatch' });
    } catch (error) { if (['ELOOP', 'EACCES', 'ENOENT'].includes(error.code)) ignored++; else throw error; }
    finally { await handle?.close(); }
  }
  return { checked, ignored, available: true };
}
module.exports = { fixtureNames, prepareFixtures, hashDirectory, sha };
