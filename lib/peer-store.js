'use strict';
// Receiver-owned transfer journal. Acknowledged chunks are durable and checked
// again on resume. Only whole, verified files become visible in the inbox.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { validName, numberedName, rootDirectory } = require('./files');
const CHUNK = 1024 * 1024;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const problem = (message, status = 400) => Object.assign(Error(message), { status });
async function atomic(file, value) {
  const tmp = file + '.tmp';
  const h = await fs.open(tmp, 'w', 0o600);
  try { await h.writeFile(JSON.stringify(value)); await h.sync(); } finally { await h.close(); }
  await fs.rename(tmp, file);
}
async function digest(file) {
  const h = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try { for await (const data of handle.createReadStream({ autoClose: false })) h.update(data); }
  finally { await handle.close(); }
  return h.digest('hex');
}
function manifest(files) {
  if (!Array.isArray(files) || !files.length || files.length > 1000) throw problem('Choose 1–1000 files');
  let total = 0;
  const result = files.map(f => {
    if (!f || !validName(f.name) || !Number.isSafeInteger(f.size) || f.size < 0 || !/^[a-f0-9]{64}$/.test(f.hash)) throw problem('Invalid file metadata');
    total += f.size;
    return { name: f.name, size: f.size, hash: f.hash };
  });
  if (total > 64 * 1024 ** 3) throw problem('A transfer must be at most 64 GiB', 413);
  return result;
}
class PeerStore {
  constructor(directory, inbox) { this.directory = directory; this.inbox = inbox; this.locks = new Set(); }
  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.inbox, { recursive: true, mode: 0o700 });
    this.inbox = await rootDirectory(this.inbox);
  }
  location(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw problem('Invalid transfer');
    return path.join(this.directory, id);
  }
  async exclusive(id, work) {
    if (this.locks.has(id)) throw problem('Transfer is busy. Retry shortly.', 409);
    this.locks.add(id); try { return await work(); } finally { this.locks.delete(id); }
  }
  async read(id, peer) {
    let value;
    try { value = JSON.parse(await fs.readFile(path.join(this.location(id), 'state.json'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') throw problem('Transfer unavailable. Send again.', 404); throw e; }
    if (value.peer !== peer) throw problem('Transfer belongs to another device', 403);
    if (value.status === 'cancelled') throw problem('Transfer cancelled', 410);
    return value;
  }
  save(s) { return atomic(path.join(this.location(s.id), 'state.json'), s); }
  async create(id, peer, files, accept) {
    files = manifest(files);
    return this.exclusive(id, async () => {
      try {
        const old = await this.read(id, peer);
        if (JSON.stringify(old.files.map(({ name, size, hash }) => ({ name, size, hash }))) !== JSON.stringify(files)) throw problem('Transfer contents changed', 409);
        return this.status(old);
      } catch (e) { if (e.status !== 404) throw e; }
      const entries = await fs.readdir(this.directory);
      if (entries.length >= 100) throw problem('Transfer history is full. Clear old transfers in Settings.', 429);
      if (!await accept(files)) throw problem('The receiver declined this transfer', 403);
      const available = await fs.statfs(this.inbox);
      const needed = files.reduce((sum, f) => sum + f.size, 0);
      // Chunks plus assembled file coexist until verification completes.
      if (needed * 2 > available.bavail * available.bsize) throw problem('Not enough disk space on the receiving device', 507);
      await fs.mkdir(this.location(id), { mode: 0o700 });
      const state = { id, peer, files: files.map(f => ({ ...f, chunks: {} })), status: 'receiving', created: Date.now() };
      await this.save(state); return this.status(state);
    });
  }
  async status(s) {
    const files = [];
    for (let index = 0; index < s.files.length; index++) {
      const f = s.files[index], chunks = [];
      if (!f.stored) for (const [part, expected] of Object.entries(f.chunks)) {
        try {
          const data = await fs.readFile(path.join(this.location(s.id), `${index}-${part}`));
          if (hash(data) === expected && data.length === Math.min(CHUNK, f.size - Number(part) * CHUNK)) chunks.push(Number(part));
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      files.push({ name: f.name, size: f.size, stored: f.stored || null, chunks });
    }
    return { id: s.id, status: s.status, files };
  }
  async chunk(id, peer, index, part, data, expected) {
    return this.exclusive(id, async () => {
      const s = await this.read(id, peer), f = s.files[index];
      if (!f || !Number.isSafeInteger(part) || part < 0 || part * CHUNK >= f.size || f.stored) throw problem('Invalid chunk');
      if (data.length !== Math.min(CHUNK, f.size - part * CHUNK) || hash(data) !== expected) throw problem('Chunk integrity check failed', 422);
      const dest = path.join(this.location(id), `${index}-${part}`), tmp = dest + '.tmp';
      const h = await fs.open(tmp, 'w', 0o600);
      try { await h.writeFile(data); await h.sync(); } finally { await h.close(); }
      await fs.rename(tmp, dest);
      f.chunks[part] = expected; await this.save(s);
      return { bytes: data.length };
    });
  }
  async finish(id, peer, index) {
    return this.exclusive(id, async () => {
      const s = await this.read(id, peer), f = s.files[index];
      if (!f) throw problem('Invalid file');
      if (f.stored) return { name: f.stored, size: f.size, hash: f.hash };
      const base = this.location(id);
      // Assemble on the inbox filesystem so atomic publication also works when
      // the private journal and shared workspace live on different volumes.
      const stage = await fs.mkdtemp(path.join(this.inbox, '.airdrop-receive-'));
      const assembled = path.join(stage, 'assembled');
      try {
      const stream = async function* () {
        for (let part = 0; part < Math.ceil(f.size / CHUNK); part++) {
          let data;
          try { data = await fs.readFile(path.join(base, `${index}-${part}`)); } catch (e) { if (e.code === 'ENOENT') throw problem('Missing chunk. Retry to resume.', 409); throw e; }
          if (hash(data) !== f.chunks[part]) throw problem('Stored chunk failed verification. Retry to repair.', 422);
          yield data;
        }
      };
      const { createWriteStream } = require('node:fs');
      await pipeline(Readable.from(stream()), createWriteStream(assembled, { mode: 0o600 }));
      if ((await fs.stat(assembled)).size !== f.size || await digest(assembled) !== f.hash) throw problem('File integrity check failed', 422);
      const h = await fs.open(assembled, 'r'); try { await h.sync(); } finally { await h.close(); }
      for (let n = 0; ; n++) {
        const recovering = !!f.reserved;
        const name = f.reserved || numberedName(f.name, n);
        f.reserved = name; await this.save(s);
        try { await fs.link(assembled, path.join(this.inbox, name)); break; }
        catch (e) {
          if (e.code !== 'EEXIST') throw e;
          // Recover a crash between publishing and updating the journal, while
          // avoiding following an inbox symlink or overwriting an existing file.
          const stat = await fs.lstat(path.join(this.inbox, name));
          if (recovering && stat.isFile() && stat.size === f.size && await digest(path.join(this.inbox, name)) === f.hash) break;
          delete f.reserved;
        }
      }
      f.stored = f.reserved; delete f.reserved;
      s.status = s.files.every(file => file.stored) ? 'complete' : 'receiving';
      await this.save(s);
      await fs.rm(assembled, { force: true });
      for (const part of Object.keys(f.chunks)) await fs.rm(path.join(base, `${index}-${part}`), { force: true });
      return { name: f.stored, size: f.size, hash: f.hash };
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    });
  }
  async cancel(id, peer) {
    return this.exclusive(id, async () => {
      const s = await this.read(id, peer); s.status = 'cancelled'; await this.save(s);
      for (const name of await fs.readdir(this.location(id))) if (name !== 'state.json') await fs.rm(path.join(this.location(id), name), { force: true });
      return { status: s.status };
    });
  }
  async history() {
    const result = [];
    for (const id of await fs.readdir(this.directory)) if (/^[a-f0-9]{32}$/.test(id)) {
      const s = JSON.parse(await fs.readFile(path.join(this.location(id), 'state.json'), 'utf8'));
      result.push({ id, peer: s.peer, status: s.status, created: s.created, total: s.files.reduce((n, f) => n + f.size, 0), bytes: s.files.reduce((n, f) => n + (f.stored ? f.size : Object.keys(f.chunks).reduce((sum, part) => sum + Math.min(CHUNK, f.size - Number(part) * CHUNK), 0)), 0), files: s.files.map(({ name, size, stored }) => ({ name, size, stored })) });
    }
    return result.sort((a, b) => b.created - a.created);
  }
}
module.exports = { PeerStore, CHUNK, hash, atomic, digest, problem, manifest };
