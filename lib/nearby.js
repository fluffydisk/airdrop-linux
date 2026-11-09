'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const https = require('node:https');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { PeerStore, CHUNK, hash, atomic, problem } = require('./peer-store');
const { privateIPv4 } = require('./device-share');
const fingerprint = cert => cert?.raw ? hash(cert.raw) : '';
const friendly = name => typeof name === 'string' && name.trim() && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name);
const code = (a, b) => hash([a, b].sort().join(':')).slice(0, 12).toUpperCase().match(/.{4}/g).join(' ');
async function body(req, limit) {
  const data = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw problem('Request too large', 413); data.push(chunk); }
  return Buffer.concat(data);
}
class Nearby extends EventEmitter {
  constructor({ directory, inbox, name = os.hostname(), approve = async () => false, discovery = true, host = '0.0.0.0', concurrency = 2, maintenanceRoot } = {}) {
    super(); this.maintenanceRoot = maintenanceRoot; this.directory = directory; this.name = friendly(name) ? name : 'Linux device';
    this.approve = approve; this.discovery = discovery; this.host = host;
    this.concurrency = Math.max(1, Math.min(4, Number(concurrency) || 2));
    this.store = new PeerStore(path.join(directory, 'incoming'), inbox);
    this.peers = new Map(); this.active = new Map(); this.requests = 0; this.pendingPair = false;
    this.journalQueue = Promise.resolve(); this.refreshing = false;
  }
  get busy() { return this.active.size > 0 || this.store.locks.size > 0; }
  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'identity.json');
    try { this.identity = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const pems = await require('selfsigned').generate([{ name: 'commonName', value: 'Airdrop nearby' }], { keySize: 2048, algorithm: 'sha256', notAfterDate: new Date('2126-01-01T00:00:00Z') });
      this.identity = { key: pems.private, cert: pems.cert }; await atomic(file, this.identity);
    }
    this.id = hash(new crypto.X509Certificate(this.identity.cert).raw);
    try { this.settings = JSON.parse(await fs.readFile(path.join(this.directory, 'trusted.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; this.settings = { name: this.name, trusted: {}, enabled: true }; }
    this.name = this.settings.name; this.concurrency = this.settings.concurrency || this.concurrency; this.outgoing = [];
    try { this.outgoing = JSON.parse(await fs.readFile(path.join(this.directory, 'outgoing.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    // A process cannot still be sending after restart. The manifest and paths
    // remain available for an explicit retry of the same transfer ID.
    for (const s of this.outgoing) if (['preparing', 'sending', 'waiting'].includes(s.status)) s.status = 'interrupted';
    await this.store.initialize();
    if (this.settings.enabled !== false) await this.start();
    return this;
  }
  saveSettings() {
    const work = () => atomic(path.join(this.directory, 'trusted.json'), this.settings);
    this.journalQueue = this.journalQueue.then(work, work); return this.journalQueue;
  }
  saveOutgoing() {
    const work = () => atomic(path.join(this.directory, 'outgoing.json'), this.outgoing);
    this.journalQueue = this.journalQueue.then(work, work); return this.journalQueue;
  }
  async start() {
    if (this.server) return;
    this.server = https.createServer({ key: this.identity.key, cert: this.identity.cert, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.2' }, (req, res) => this.handle(req, res));
    this.sockets = new Set();
    this.server.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
    this.server.requestTimeout = 120000; this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, this.host, resolve); });
    this.port = this.server.address().port;
    if (this.discovery) {
      try {
        const { Bonjour } = require('bonjour-service');
        this.bonjour = new Bonjour(undefined, error => { this.discoveryError = 'Nearby discovery unavailable: ' + error.message; });
        this.service = this.bonjour.publish({ name: 'Airdrop-' + this.id.slice(0, 16), type: 'airdrop-linux', port: this.port, txt: { id: this.id, name: this.name, v: '1' } });
        this.browser = this.bonjour.find({ type: 'airdrop-linux' }, service => this.discovered(service));
        this.browser.on('down', service => { const p = this.peers.get(service.txt?.id); if (p) p.seen = 0; });
      } catch (e) { this.discoveryError = 'Nearby discovery unavailable: ' + e.message; }
    }
    this.timer = setInterval(() => this.refresh().catch(e => { this.discoveryError = e.message; }), 5000); this.timer.unref();
  }
  discovered(service) {
    const { id, name, v } = service.txt || {};
    if (v !== '1' || !/^[a-f0-9]{64}$/.test(id) || id === this.id || !friendly(name) || !Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return;
    // DNS-SD is a hint, never an authentication boundary. Do not let remote
    // records turn this native client into a proxy to public/loopback services.
    const addresses = (service.addresses || []).filter(a => net.isIPv4(a) && privateIPv4(a));
    if (!addresses.length || (!this.peers.has(id) && this.peers.size >= 100)) return;
    this.peers.set(id, { id, name, addresses: [...new Set(addresses)].slice(0, 4), port: service.port, seen: Date.now(), online: false });
    this.refresh().catch(() => {});
  }
  async refresh() {
    if (this.refreshing) return; this.refreshing = true;
    try {
      this.browser?.update();
      await Promise.all([...this.peers.values()].map(async peer => {
        try {
          // A bounded race avoids a stale interface delaying a working one.
          const address = await Promise.any(peer.addresses.slice(0, 4).map(async address => {
            await this.request({ ...peer, address }, '/hello', undefined, { timeout: 2000 }); return address;
          }));
          peer.address = address; peer.online = true;
        } catch { peer.online = false; }
      }));
    } finally { this.refreshing = false; }
  }
  request(peer, url, data, { binary = false, signal, timeout = 90000, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const payload = data === undefined ? null : binary ? data : Buffer.from(JSON.stringify(data));
      const req = https.request({ hostname: peer.address || peer.addresses?.[0], port: peer.port, path: url, method: payload === null ? 'GET' : 'POST',
        key: this.identity.key, cert: this.identity.cert, rejectUnauthorized: false, agent: false, signal,
        headers: { ...(payload ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', 'Content-Length': payload.length } : {}), ...headers } }, async res => {
        try {
          const value = JSON.parse((await body(res, 2 * 1024 * 1024)).toString());
          if (res.statusCode >= 400) throw problem(value.error || 'Device request failed', res.statusCode);
          resolve(value);
        } catch (e) { reject(e); }
      });
      const timer = setTimeout(() => req.destroy(Error('Device did not respond in time. Check it is open, then retry.')), timeout); timer.unref();
      req.once('close', () => clearTimeout(timer)); req.on('error', reject);
      req.on('socket', socket => socket.once('secureConnect', () => {
        if (fingerprint(socket.getPeerCertificate()) !== peer.id) { req.destroy(Error('Device identity changed. Forget and pair again.')); return; }
        req.end(payload);
      }));
    });
  }
  async handle(req, res) {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const reply = (status, value) => { if (!res.destroyed) { res.writeHead(status); res.end(JSON.stringify(value)); } };
    if (this.requests >= 8) { reply(429, { error: 'Device is busy. Retry shortly.' }); return; }
    this.requests++; let release;
    const interrupted = new AbortController();
    res.once('close', () => { if (!res.writableFinished) interrupted.abort(); });
    try {
      const peer = fingerprint(req.socket.getPeerCertificate());
      if (!peer || req.headers.origin) throw problem('Native device authentication required', 403);
      if (req.url === '/hello' && req.method === 'GET') return reply(200, { id: this.id, name: this.name, protocol: 1 });
      if (req.url === '/pair' && req.method === 'POST') {
        if (this.pendingPair) throw problem('Another pairing is pending', 429);
        this.pendingPair = true;
        try {
          const data = JSON.parse((await body(req, 1024)).toString());
          if (!friendly(data.name)) throw problem('Invalid device name');
          if (this.settings.trusted[peer]) return reply(200, { name: this.name });
          if (!await this.confirm({ type: 'pair', name: data.name, code: code(this.id, peer) })) throw problem('Pairing declined', 403);
          this.settings.trusted[peer] = { name: data.name, autoAccept: false, paired: Date.now() }; await this.saveSettings();
          return reply(200, { name: this.name });
        } finally { this.pendingPair = false; }
      }
      const trusted = this.settings.trusted[peer];
      if (!trusted) throw problem('Pair this device first', 403);
      const match = /^\/transfers\/([a-f0-9]{32})(?:\/(\d+)\/(\d+|finish))?$/.exec(req.url);
      if (!match) throw problem('Unknown device operation', 404);
      const [, id, index, part] = match;
      if (req.method === 'POST' && this.maintenanceRoot) release = await require('./maintenance').acquire(this.maintenanceRoot);
      if (req.method === 'GET' && index === undefined) return reply(200, await this.store.status(await this.store.read(id, peer)));
      if (req.method !== 'POST') throw problem('Unknown device operation', 405);
      if (index === undefined) {
        const data = JSON.parse((await body(req, 512 * 1024)).toString());
        if (data.cancel === true) return reply(200, await this.store.cancel(id, peer));
        return reply(200, await this.store.create(id, peer, data.files, files => trusted.autoAccept || this.confirm({ type: 'receive', name: trusted.name, files })));
      }
      if (part === 'finish') return reply(200, await this.store.finish(id, peer, Number(index), interrupted.signal));
      reply(200, await this.store.chunk(id, peer, Number(index), Number(part), await body(req, CHUNK), req.headers['x-chunk-sha256']));
    } catch (e) {
      reply(e.code === 'ENOSPC' ? 507 : e.status || 400, { error: e.code === 'ENOSPC' ? 'Receiving device is out of disk space. Free space and retry.' : e.message });
    } finally { this.requests--; await release?.(); }
  }
  async confirm(details) {
    let timer;
    try { return await Promise.race([this.approve(details), new Promise(resolve => { timer = setTimeout(() => resolve(false), 60000); timer.unref(); })]); }
    finally { clearTimeout(timer); }
  }
  async pair(id) {
    if (this.settings.trusted[id]) return;
    if (this.pairing) throw Error('Finish the current pairing before starting another.');
    const peer = this.peers.get(id);
    if (!peer?.online) throw Error('Device is offline. Open Airdrop on both devices and retry.');
    this.pairing = { name: peer.name, code: code(this.id, id) };
    try {
      if (!await this.confirm({ type: 'pair', ...this.pairing })) throw Error('Pairing cancelled');
      const result = await this.request(peer, '/pair', { name: this.name });
      this.settings.trusted[id] = { name: result.name, autoAccept: false, paired: Date.now() }; await this.saveSettings();
    } finally { this.pairing = null; }
  }
  async configure({ name, enabled, id, autoAccept, forget, clearHistory, concurrency } = {}) {
    if (concurrency !== undefined) { if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('Choose 1–4 simultaneous transfers'); this.settings.concurrency = this.concurrency = concurrency; }
    if (name !== undefined) { if (!friendly(name)) throw Error('Use a device name of 1–80 characters'); this.settings.name = this.name = name.trim(); }
    if (enabled !== undefined) { if (typeof enabled !== 'boolean') throw Error('Invalid nearby preference'); this.settings.enabled = enabled; }
    if (id !== undefined) {
      if (!this.settings.trusted[id]) throw Error('Device is not paired');
      if (forget === true) delete this.settings.trusted[id];
      else { if (typeof autoAccept !== 'boolean') throw Error('Invalid receive permission'); this.settings.trusted[id].autoAccept = autoAccept; }
    }
    if (clearHistory === true) {
      if (this.active.size || this.requests || this.store.locks.size) throw Error('Wait for active transfers before clearing history');
      await fs.rm(this.store.directory, { recursive: true, force: true }); await this.store.initialize();
      this.outgoing = []; await this.saveOutgoing();
    }
    await this.saveSettings();
    if (name !== undefined || enabled === false) await this.stop();
    if (this.settings.enabled !== false) await this.start();
  }
  async send(id, sources, retryId) {
    if (this.active.size >= this.concurrency) throw Error('All transfer slots are busy. Wait or cancel a transfer.');
    if (!this.settings.trusted[id]) throw Error('Pair this device before sending');
    const peer = this.peers.get(id);
    if (!peer?.online || !this.server) throw Error('Device is offline. Open Airdrop on both devices and retry.');
    let s = retryId && this.outgoing.find(s => s.id === retryId && s.peer === id);
    if (retryId && !s) throw Error('Transfer unavailable');
    if (s && this.active.has(s.id)) throw Error('Transfer is already running');
    if (!s) {
      if (this.outgoing.length >= 100) throw Error('Transfer history is full. Clear old transfers in Settings.');
      s = { id: crypto.randomBytes(16).toString('hex'), peer: id, name: this.settings.trusted[id].name, sources, files: [], status: 'preparing', created: Date.now(), bytes: 0 };
      this.outgoing.push(s);
    }
    const controller = new AbortController(); this.active.set(s.id, controller);
    const request = (url, data, options) => this.request(peer, url, data, { ...options, signal: controller.signal });
    let release;
    try {
      if (this.maintenanceRoot) release = await require('./maintenance').acquire(this.maintenanceRoot);
      s.status = 'preparing'; s.error = ''; await this.saveOutgoing();
      const files = [];
      for (const source of s.sources) {
        controller.signal.throwIfAborted();
        const stat = await fs.lstat(source);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Choose regular files; folders can be shared in Files.');
        const handle = await fs.open(source, require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
        try {
          const h = crypto.createHash('sha256');
          for await (const data of handle.createReadStream({ autoClose: false })) { controller.signal.throwIfAborted(); h.update(data); }
          files.push({ name: path.basename(source), size: stat.size, hash: h.digest('hex') });
        } finally { await handle.close(); }
      }
      if (s.files.length && JSON.stringify(s.files) !== JSON.stringify(files)) throw Error('Source files changed. Start a new transfer.');
      s.files = files; s.total = files.reduce((sum, f) => sum + f.size, 0); s.status = 'waiting'; await this.saveOutgoing();
      const remote = await request('/transfers/' + s.id, { files });
      s.status = 'sending'; s.bytes = 0; const start = Date.now(); let transmitted = 0;
      for (let index = 0; index < files.length; index++) {
        const file = files[index], state = remote.files[index];
        s.currentFile = file.name; s.fileBytes = 0; s.fileSize = file.size;
        if (state.stored) { s.bytes += file.size; continue; }
        const handle = await fs.open(s.sources[index], require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
        try {
          for (let part = 0; part < Math.ceil(file.size / CHUNK); part++) {
            controller.signal.throwIfAborted();
            const length = Math.min(CHUNK, file.size - part * CHUNK);
            if (!state.chunks.includes(part)) {
              const data = Buffer.alloc(length); let read = 0;
              while (read < length) { const n = await handle.read(data, read, length - read, part * CHUNK + read); if (!n.bytesRead) throw Error('Source file changed'); read += n.bytesRead; }
              await request(`/transfers/${s.id}/${index}/${part}`, data, { binary: true, headers: { 'X-Chunk-Sha256': hash(data) } });
              transmitted += length;
            }
            s.bytes += length; s.fileBytes += length; s.speed = Math.round(transmitted * 1000 / Math.max(1, Date.now() - start));
            s.remaining = s.speed ? Math.ceil((s.total - s.bytes) / s.speed) : null; this.emit('progress', this.publicTransfer(s));
          }
          s.verifying = true; this.emit('progress', this.publicTransfer(s));
          await request(`/transfers/${s.id}/${index}/finish`, {});
          s.verifying = false;
        } finally { await handle.close(); }
        await this.saveOutgoing();
      }
      s.status = 'complete'; s.completed = Date.now(); s.remaining = 0; this.settings.trusted[id].lastUsed = Date.now(); await this.saveSettings();
    } catch (e) { s.status = controller.signal.aborted ? 'cancelled' : 'interrupted'; s.error = controller.signal.aborted ? 'Cancelled. Retry to resume verified chunks.' : e.message; }
    finally { this.active.delete(s.id); try { await this.saveOutgoing(); this.emit('progress', this.publicTransfer(s)); } finally { await release?.(); } }
    return this.publicTransfer(s);
  }
  publicTransfer(s) { const { sources, ...safe } = s; return safe; }
  cancel(id) { this.active.get(id)?.abort(); }
  async snapshot() {
    const ids = new Set([...this.peers.keys(), ...Object.keys(this.settings.trusted)]);
    return { name: this.name, pairing: this.pairing || null, concurrency: this.concurrency, enabled: this.settings.enabled !== false, discoveryError: this.discoveryError || '', devices: [...ids].map(id => {
      const found = this.peers.get(id), saved = this.settings.trusted[id];
      return { id, name: saved?.name || found?.name, online: !!this.server && !!found?.online, trusted: !!saved, autoAccept: !!saved?.autoAccept, lastUsed: saved?.lastUsed || 0 };
    }).sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name)), outgoing: this.outgoing.map(s => this.publicTransfer(s)), incoming: await this.store.history() };
  }
  async stop() {
    clearInterval(this.timer); for (const controller of this.active.values()) controller.abort();
    this.browser?.stop();
    if (this.bonjour) { await new Promise(resolve => this.bonjour.unpublishAll(resolve)); this.bonjour.destroy(); this.bonjour = null; }
    const server = this.server; this.server = null;
    for (const socket of this.sockets || []) socket.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    for (const p of this.peers.values()) p.online = false;
  }
}
module.exports = { Nearby, code, fingerprint };
