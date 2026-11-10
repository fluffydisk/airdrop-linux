'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { atomic } = require('../peer-store');
const { validName, publishLocal, rootDirectory } = require('../files');
const { candidates } = require('./addresses');

const MAX_FRAME = 4 * 1024 * 1024;
class QuickShare extends EventEmitter {
  constructor({ enabled = false, helper, sha256, directory, inbox, name = 'Airdrop Linux', approve = async () => false, spawnProcess = spawn, timeout = 10000 } = {}) {
    super(); Object.assign(this, { enabled, helper, sha256, directory, inbox, name, approve, spawnProcess, timeout });
    this.status = 'disabled'; this.requests = new Map(); this.recipients = new Map(); this.transfers = new Map();
    this.sequence = 0; this.generation = 0; this.events = Promise.resolve(); this.confirming = new Set(); this.accepted = new Set(); this.verifications = new Set();
  }
  get busy() { return [...this.transfers.values()].some(t => ['connecting', 'awaiting-acceptance', 'transferring', 'verifying'].includes(t.phase)); }
  async start() {
    if (!this.enabled) return this.snapshot();
    if (this.child) return this.snapshot();
    if (!/^[a-f0-9]{64}$/.test(this.sha256 || '')) throw Error('Quick Share helper verification metadata is missing.');
    const info = await fs.lstat(this.helper);
    if (!info.isFile() || info.isSymbolicLink() || crypto.createHash('sha256').update(await fs.readFile(this.helper)).digest('hex') !== this.sha256) throw Error('Quick Share helper verification failed.');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.directory = await rootDirectory(this.directory);
    this.staging = path.join(this.directory, 'staging');
    await fs.mkdir(this.staging, { recursive: true, mode: 0o700 }); this.staging = await rootDirectory(this.staging);
    await fs.mkdir(this.inbox, { recursive: true, mode: 0o700 }); this.inbox = await rootDirectory(this.inbox);
    try {
      const history = JSON.parse(await fs.readFile(path.join(this.directory, 'history.json'), 'utf8'));
      if (!Array.isArray(history) || history.length > 100) throw Error('Invalid Quick Share history');
      for (const record of history) this.transfers.set(record.id, { ...record, ...(['connecting', 'awaiting-acceptance', 'transferring', 'verifying'].includes(record.phase) ? { phase: 'interrupted' } : {}) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const generation = ++this.generation;
    const child = this.child = this.spawnProcess(this.helper, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.status = 'starting'; this.buffer = Buffer.alloc(0); this.recipients.clear();
    child.stdout.on('data', bytes => {
      if (generation !== this.generation) return;
      this.buffer = Buffer.concat([this.buffer, bytes]);
      if (this.buffer.length > MAX_FRAME) { this.failure('Quick Share helper exceeded its message limit.'); return; }
      let index;
      while ((index = this.buffer.indexOf(10)) >= 0) {
        const line = this.buffer.subarray(0, index); this.buffer = this.buffer.subarray(index + 1);
        try { this.message(JSON.parse(line.toString('utf8')), generation); }
        catch { this.failure('Quick Share helper returned an invalid message.'); return; }
      }
    });
    // Never copy untrusted helper diagnostics, verification codes or payloads
    // into the application log. Drain stderr to prevent a blocked child.
    child.stderr.on('data', () => {});
    child.once('error', () => this.failure('Quick Share helper could not start.'));
    child.once('exit', () => {
      if (this.child === child) { this.child = null; this.failure('Quick Share stopped. Retry the transfer.', false); }
    });
    try {
      const hello = await this.request('hello');
      if (hello.protocol !== 1 || hello.capabilities?.ble !== false || hello.capabilities?.direct !== false) throw Error('Unsupported Quick Share helper capabilities.');
      this.capabilities = hello.capabilities;
      await this.request('start', { staging: this.staging, name: this.name });
      this.status = 'ready'; return this.snapshot();
    } catch (error) { await this.stop(); throw error; }
  }
  failure(message, terminate = true) {
    ++this.generation;
    this.status = 'error'; this.error = message; this.recipients.clear();
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(Error(message)); }
    this.requests.clear();
    for (const record of this.transfers.values()) if (['connecting', 'awaiting-acceptance', 'transferring', 'verifying'].includes(record.phase)) record.phase = 'interrupted';
    if (terminate) this.child?.kill('SIGTERM');
    this.emit('state', this.snapshot());
  }
  request(method, params = {}) {
    if (!this.child || this.child.stdin.destroyed) return Promise.reject(Error('Quick Share is unavailable.'));
    const id = String(++this.sequence), line = JSON.stringify({ v: 1, id, method, params }) + '\n';
    if (Buffer.byteLength(line) > 65536) return Promise.reject(Error('Quick Share request is too large.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(Error('Quick Share did not respond in time.')); }, this.timeout); timer.unref();
      this.requests.set(id, { resolve, reject, timer });
      this.child.stdin.write(line, error => { if (error) { clearTimeout(timer); this.requests.delete(id); reject(Error('Quick Share disconnected.')); } });
    });
  }
  message(value, generation) {
    if (value.v !== 1) throw Error('IPC version');
    if (typeof value.id === 'string') {
      const pending = this.requests.get(value.id); if (!pending) return;
      this.requests.delete(value.id); clearTimeout(pending.timer);
      if (value.error) pending.reject(Error('Quick Share could not complete this request.'));
      else pending.resolve(value.result);
    } else if (value.event === 'recipient') {
      const endpoint = value.data;
      if (!endpoint || typeof endpoint.id !== 'string' || endpoint.id.length > 128) throw Error('Invalid endpoint');
      if (endpoint.present === true) {
        if (typeof endpoint.name !== 'string' || endpoint.name.length > 80 || /[\x00-\x1f\x7f]/.test(endpoint.name) || !candidates(endpoint.ip).length || !/^\d+$/.test(endpoint.port || '') || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535) return;
        if (this.recipients.size < 100 || this.recipients.has(endpoint.id)) this.recipients.set(endpoint.id, { id: 'quick-share:' + endpoint.id, name: endpoint.name, endpointId: endpoint.id, trust: 'unverified', availability: 'available' });
      } else this.recipients.delete(endpoint.id);
      this.emit('state', this.snapshot());
    } else if (value.event === 'transfer') {
      this.events = this.events.then(() => this.transfer(value.data, generation)).catch(() => this.failure('Quick Share transfer could not be safely completed.'));
    } else throw Error('Unknown helper event');
  }
  async transfer(value, generation) {
    if (generation !== this.generation) return;
    if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id) || !['incoming', 'outgoing'].includes(value.direction) || !['connecting', 'awaiting-acceptance', 'transferring', 'complete', 'interrupted', 'declined', 'cancelled'].includes(value.phase)) throw Error('Invalid transfer');
    if (this.transfers.get(value.id)?.phase === 'complete') return;
    if (this.transfers.size >= 100 && !this.transfers.has(value.id)) throw Error('History full');
    const { stagedPaths, pinCode, ...safe } = value;
    if (value.direction === 'outgoing' && Array.isArray(safe.files)) safe.files = safe.files.map(file => path.basename(file));
    const record = { ...this.transfers.get(value.id), ...safe, transport: 'quick-share', supportsResume: false };
    this.transfers.set(value.id, record);
    if (value.direction === 'outgoing' && /^\d{4}$/.test(pinCode || '') && !this.verifications.has(value.id)) {
      this.verifications.add(value.id); this.emit('verification', { id: value.id, code: pinCode, name: value.name });
    }
    if (value.phase === 'awaiting-acceptance' && value.direction === 'incoming' && !this.confirming.has(value.id)) {
      if (!Array.isArray(value.files) || !value.files.length || value.files.length > 100 || !value.files.every(validName) || !/^\d{4}$/.test(pinCode || '') || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 64 * 1024 ** 3) {
        await this.request('respond', { transferId: value.id, accept: false }); return;
      }
      const [stagedSpace, inboxSpace, stagedInfo, inboxInfo] = await Promise.all([fs.statfs(this.staging), fs.statfs(this.inbox), fs.stat(this.staging), fs.stat(this.inbox)]);
      if (value.total > stagedSpace.bavail * stagedSpace.bsize || value.total * (stagedInfo.dev === inboxInfo.dev ? 2 : 1) > inboxSpace.bavail * inboxSpace.bsize) {
        record.error = 'Not enough disk space to receive these files.';
        await this.request('respond', { transferId: value.id, accept: false }); return;
      }
      this.confirming.add(value.id);
      const child = this.child;
      let timer;
      const decision = Promise.race([this.approve({ type: 'receive', transport: 'quick-share', id: value.id, name: value.name, code: pinCode, files: value.files.map(name => ({ name })), total: value.total }),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), 55000); timer.unref(); })]);
      decision.then(async accept => {
        if (generation === this.generation && child === this.child && this.transfers.get(value.id)?.phase === 'awaiting-acceptance') {
          await this.request('respond', { transferId: value.id, accept: accept === true });
          if (accept === true) this.accepted.add(value.id);
        }
      }).catch(() => {}).finally(() => clearTimeout(timer));
    }
    if (value.phase === 'complete' && value.direction === 'incoming') {
      if (!this.accepted.has(value.id)) throw Error('Transfer was not accepted');
      if (!Array.isArray(stagedPaths) || !stagedPaths.length || stagedPaths.length > 100 || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 64 * 1024 ** 3) throw Error('Invalid completed transfer');
      record.phase = 'verifying'; this.emit('progress', { ...record });
      const checked = [];
      for (const source of stagedPaths) {
        if (typeof source !== 'string') throw Error('Invalid staged path');
        const relative = path.relative(this.staging, source), parts = relative.split(path.sep);
        if (parts.length !== 2 || !/^[a-f0-9]{32}$/.test(parts[0]) || !validName(parts[1])) throw Error('Unsafe staged path');
        const directory = path.dirname(source);
        if (await rootDirectory(directory) !== directory) throw Error('Unsafe staging directory');
        const info = await fs.lstat(source);
        if (!info.isFile() || info.isSymbolicLink()) throw Error('Invalid staged file');
        checked.push({ source, size: info.size });
      }
      if (checked.reduce((sum, file) => sum + file.size, 0) !== value.total) throw Error('Incomplete transfer');
      if (generation !== this.generation || !this.child) return;
      record.files = [];
      for (const file of checked) {
        if (generation !== this.generation || !this.child) { record.phase = 'interrupted'; return; }
        record.files.push(await publishLocal(this.inbox, file.source));
      }
      record.phase = 'complete'; record.integrity = 'protocol-authenticated';
      this.accepted.delete(value.id);
    }
    await atomic(path.join(this.directory, 'history.json'), [...this.transfers.values()]);
    this.emit('progress', { ...record });
  }
  async send({ recipientId, sources }) {
    const id = recipientId?.replace(/^quick-share:/, '');
    if (!this.recipients.has(id) || this.status !== 'ready') throw Error('Quick Share recipient is unavailable.');
    if (this.busy) throw Error('Wait for the current Quick Share transfer or cancel it first.');
    if (this.transfers.size >= 100) throw Error('Quick Share history is full.');
    const transferId = crypto.randomUUID();
    this.transfers.set(transferId, { id: transferId, phase: 'connecting', transport: 'quick-share', direction: 'outgoing', name: this.recipients.get(id).name, files: sources.map(source => path.basename(source)), created: Date.now() });
    try { await this.request('send', { recipientId: id, files: sources, transferId }); }
    catch (error) { this.transfers.get(transferId).phase = 'interrupted'; throw error; }
    return { transferId };
  }
  cancel(id) { return this.request('cancel', { transferId: id }); }
  snapshot() { return { enabled: this.enabled, status: this.status, error: this.error || '', capabilities: this.capabilities || { lan: false, ble: false, direct: false, resume: false, persistentTrust: false }, recipients: [...this.recipients.values()], transfers: [...this.transfers.values()].map(record => ({ ...record })) }; }
  async stop() {
    ++this.generation;
    const child = this.child;
    if (child) {
      child.stdin.end();
      let timer;
      await Promise.race([new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); }), new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    this.child = null; this.failure('Quick Share stopped.', false); this.status = this.enabled ? 'stopped' : 'disabled';
    this.accepted.clear(); this.confirming.clear();
  }
}
module.exports = { QuickShare };
