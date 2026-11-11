'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { atomic } = require('../peer-store');
const { validName, publishLocal, rootDirectory } = require('../files');
const { candidates } = require('./addresses');

const diagnostic = require('./quickshare-diagnostics');
const MAX_FRAME = 4 * 1024 * 1024;
const TERMINAL = new Set(['complete', 'interrupted', 'declined', 'cancelled', 'outcome-unknown']);
class QuickShare extends EventEmitter {
  constructor({ enabled = false, helper, sha256, directory, inbox, name = 'Airdrop Linux', port, bleFastInit = false, bleNative = false, protocolDiagnostics = false, approve = async () => false, spawnProcess = spawn, timeout = 10000 } = {}) {
    super(); Object.assign(this, { enabled, helper, sha256, directory, inbox, name, approve, spawnProcess, timeout });
    this.status = 'disabled'; this.requests = new Map(); this.recipients = new Map(); this.routes = new Map(); this.transfers = new Map();
    this.sequence = 0; this.generation = 0; this.events = Promise.resolve(); this.confirming = new Set(); this.accepted = new Set(); this.verifications = new Set();
    this.manifests = new Map(); this.pipeline = {}; this.lifecycle = {outcome: 'running', shutdownRequested: false}; this.stopping = false;
    this.pendingTransfers = new Map(); this.drainingTransfers = false;
    this.port = port;
    this.bleNative = bleNative; this.bleFastInit = bleFastInit; this.protocolDiagnostics = protocolDiagnostics;
  }
  get busy() { return [...this.transfers.values()].some(t => ['connecting', 'awaiting-acceptance', 'transferring', 'verifying'].includes(t.phase)); }
  async start() {
    if (!this.enabled) return this.snapshot();
    if (this.child) return this.snapshot();
    await this.events;
    if (!/^[a-f0-9]{64}$/.test(this.sha256 || '')) throw Error('Quick Share helper verification metadata is missing.');
    const info = await fs.lstat(this.helper);
    if (!info.isFile() || info.isSymbolicLink() || crypto.createHash('sha256').update(await fs.readFile(this.helper)).digest('hex') !== this.sha256) throw Error('Quick Share helper verification failed.');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.directory = await rootDirectory(this.directory);
    this.staging = path.join(this.directory, 'staging');
    await fs.mkdir(this.staging, { recursive: true, mode: 0o700 }); this.staging = await rootDirectory(this.staging);
    await fs.chmod(this.directory, 0o700); await fs.chmod(this.staging, 0o700);
    await this.cleanStaging();
    this.accepted.clear(); this.confirming.clear(); this.verifications.clear(); this.manifests.clear();
    await fs.mkdir(this.inbox, { recursive: true, mode: 0o700 }); this.inbox = await rootDirectory(this.inbox);
    try {
      const history = JSON.parse(await fs.readFile(path.join(this.directory, 'history.json'), 'utf8'));
      if (!Array.isArray(history) || history.length > 100) throw Error('Invalid Quick Share history');
      for (const record of history) this.transfers.set(record.id, { ...record, ...(['connecting', 'awaiting-acceptance', 'transferring', 'verifying'].includes(record.phase) ? { phase: 'interrupted' } : {}) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const generation = ++this.generation;
    const child = this.child = this.spawnProcess(this.helper, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.stopping=false;this.lifecycle={outcome:'running',shutdownRequested:false};
    this.status = 'starting'; this.error = ''; this.buffer = Buffer.alloc(0); this.recipients.clear(); this.routes.clear();
    child.stdin.on('error', () => {
      if (this.child === child && generation === this.generation) this.failure('Quick Share disconnected.');
    });
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
    child.once('error', () => {this.lifecycle={outcome:'start-failed',shutdownRequested:this.stopping};this.failure('Quick Share helper could not start.');});
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null;
        this.lifecycle={outcome:this.stopping && code === 0 && !signal ? 'clean-stop' : this.stopping && this.forcedStop ? 'forced-stop' : 'unexpected-exit',shutdownRequested:this.stopping};
        if (!this.stopping || this.lifecycle.outcome === 'unexpected-exit') this.failure('Quick Share stopped. Retry the transfer.', false);
        this.events = this.events.then(() => this.cleanStaging()).catch(() => { this.error = 'Quick Share staging cleanup failed.'; });
      }
    });
    try {
      const hello = await this.request('hello');
      if (hello.protocol !== 1 || (hello.capabilities?.ble !== false && !(this.bleNative && hello.capabilities?.ble === true && hello.capabilities?.gattBootstrap === true)) || hello.capabilities?.direct !== false) throw Error('Unsupported Quick Share helper capabilities.');
      if (this.protocolDiagnostics && hello.capabilities.protocolDiagnostics !== true) throw Error('Rebuild the helper for laboratory protocol diagnostics.');
      if (this.bleNative && hello.capabilities?.gattBootstrap !== true) throw Error('Rebuild the helper with --ble-native.');
      this.capabilities = hello.capabilities;
      const started = await this.request('start', { staging: this.staging, name: this.name, ...(this.bleNative ? { bleNative: true } : {}), ...(this.port !== undefined ? { port: this.port } : {}), ...(this.bleFastInit ? { bleFastInit: true } : {}), ...(this.protocolDiagnostics ? { protocolDiagnostics: true } : {}) });
      this.listenerPort = started.port;
      this.bleFastInitAt = Date.now();
      this.bleFastInitState = ['registered-for-120s', 'expired', 'bluez-unavailable', 'bluez-timeout', 'permission-denied', 'not-supported', 'bluetooth-off', 'no-adapter', 'adapter-busy', 'bluez-operation-failed', 'unavailable-or-denied'].includes(started.bleFastInitState) ? started.bleFastInitState : 'not-requested';
      this.status = 'ready'; return this.snapshot();
    } catch (error) { await this.stop(); throw error; }
  }
  failure(message, terminate = true, expected = false) {
    ++this.generation;
    this.status = expected ? (this.enabled ? 'stopped' : 'disabled') : 'error'; this.error = expected ? '' : message; this.recipients.clear(); this.routes.clear(); this.bluetooth = sanitizeBluetooth({ stage: 'stopped' });
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(Error(message)); }
    this.requests.clear();
    this.pendingTransfers.clear();
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
    if (generation !== this.generation) return;
    if (value.v !== 1) throw Error('IPC version');
    if (typeof value.id === 'string') {
      const pending = this.requests.get(value.id); if (!pending) return;
      this.requests.delete(value.id); clearTimeout(pending.timer);
      if (value.error) pending.reject(Error('Quick Share could not complete this request.'));
      else pending.resolve(value.result);
    } else if(value.event==='connection'){
      const data=value.data;
      if(!this.protocolDiagnostics||!data||!/^[a-zA-Z0-9-]{1,80}$/.test(data.id||'')||!['incoming','outgoing'].includes(data.direction)||!diagnostic.CONNECTION_METHODS.has(data.connectionMethod))throw Error('Invalid connection diagnostic');
      this.emit('connection',{id:data.id,direction:data.direction,connectionMethod:data.connectionMethod});
    } else if(value.event==='finalization'){
      const data=value.data;
      if(!this.protocolDiagnostics||!data||!/^[a-zA-Z0-9-]{1,80}$/.test(data.id||'')||!['incoming','outgoing'].includes(data.direction)||!diagnostic.FINALIZATION_STAGES.has(data.stage))throw Error('Invalid finalization diagnostic');
      this.emit('finalization',{id:data.id,direction:data.direction,stage:data.stage});
    } else if (value.event === 'protocol') {
      const data = value.data;
      if (!this.protocolDiagnostics || !data || !/^[a-zA-Z0-9-]{1,80}$/.test(data.id || '') || !['incoming', 'outgoing'].includes(data.direction) || typeof data.protocolStage !== 'string' || data.protocolStage.length > 64) throw Error('Invalid protocol diagnostic');
      this.emit('protocol', { id: data.id, direction: data.direction, protocolStage: data.protocolStage });
    } else if (value.event === 'bluetooth') {
      if (!this.bleNative) throw Error('Unexpected Bluetooth event');
      this.bluetooth = sanitizeBluetooth(value.data); this.emit('state', this.snapshot());
    } else if (value.event === 'recipient') {
      diagnostic.increment(this.pipeline,'ipc_recipient_messages');
      const endpoint = value.data;
      if (!endpoint || typeof endpoint.id !== 'string' || endpoint.id.length > 128) {diagnostic.increment(this.pipeline,'ipc_recipient_invalid');throw Error('Invalid endpoint');}
      if (endpoint.present === true) {
        const bluetooth = this.bleNative && ['ble-gatt', 'ble-l2cap'].includes(endpoint.transport) && typeof endpoint.connectable === 'boolean' && /^ble-[a-f0-9]{32}$/.test(endpoint.id);
        if (typeof endpoint.name !== 'string' || endpoint.name.length > 80 || /[\x00-\x1f\x7f]/.test(endpoint.name) || (!bluetooth && (!candidates(endpoint.ip).length || !/^\d+$/.test(endpoint.port || '') || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535))) {diagnostic.increment(this.pipeline,'ipc_recipient_invalid'); return;}
        const key = /^ble-[a-f0-9]{32}$/.test(endpoint.discovery_key || '') ? endpoint.discovery_key : endpoint.id;
        if (this.routes.size >= 100 && !this.routes.has(endpoint.id)) diagnostic.increment(this.pipeline,'recipient_route_capacity_rejected');
        else {diagnostic.increment(this.pipeline,'recipient_route_published'); this.routes.set(endpoint.id, { id: 'quick-share:' + key, name: endpoint.name, endpointId: endpoint.id, trust: 'unverified', availability: bluetooth && !endpoint.connectable ? 'checking' : 'available', connectionMethod: bluetooth ? endpoint.transport : 'lan', discoveryStage: bluetooth ? endpoint.discovery_stage : 'lan-resolved', connectable: bluetooth ? endpoint.connectable : true });}
      } else {diagnostic.increment(this.pipeline,'ipc_recipient_removed'); this.routes.delete(endpoint.id);}
      diagnostic.increment(this.pipeline,'selector_publications');this.recipients.clear();
      for (const route of this.routes.values()) {
        const key=route.id.slice('quick-share:'.length), previous=this.recipients.get(key);
        if (!previous || (previous.connectionMethod !== 'lan' && (route.connectionMethod === 'lan' || !previous.connectable))) this.recipients.set(key,route);
      }
      this.emit('state', this.snapshot());
    } else if (value.event === 'transfer') {
      const transfer = value.data;
      if (!transfer || typeof transfer.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(transfer.id)) throw Error('Invalid transfer');
      if (this.pendingTransfers.size >= 100 && !this.pendingTransfers.has(transfer.id)) throw Error('Too many pending transfers');
      // Helper messages are complete snapshots. Keep only the newest pending
      // snapshot per transfer while disk/publication work is in progress. The
      // helper cannot advance an incoming transfer past consent until we reply.
      if (typeof transfer.protocolStage === 'string' && transfer.protocolStage.length <= 64 && ['incoming', 'outgoing'].includes(transfer.direction)) this.emit('protocol', { id: transfer.id, direction: transfer.direction, protocolStage: transfer.protocolStage });
      const pending = this.pendingTransfers.get(transfer.id)?.value;
      if (pending && TERMINAL.has(pending.phase)) return;
      this.pendingTransfers.set(transfer.id, { value: transfer, generation });
      if (!this.drainingTransfers) {
        this.drainingTransfers = true;
        this.events = this.drainTransfers();
      }
    } else throw Error('Unknown helper event');
  }
  async drainTransfers() {
    try {
      while (this.pendingTransfers.size) {
        const [id, next] = this.pendingTransfers.entries().next().value;
        this.pendingTransfers.delete(id);
        await this.transfer(next.value, next.generation);
      }
    } catch { this.failure('Quick Share transfer could not be safely completed.'); }
    finally { this.drainingTransfers = false; }
  }
  async transfer(value, generation) {
    if (generation !== this.generation) return;
    if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id) || !['incoming', 'outgoing'].includes(value.direction) || !['connecting', 'awaiting-acceptance', 'transferring', 'complete', 'interrupted', 'declined', 'cancelled', 'outcome-unknown'].includes(value.phase)) throw Error('Invalid transfer');
    const previous = this.transfers.get(value.id);
    if (previous && TERMINAL.has(previous.phase)) return;
    if (previous && previous.direction !== value.direction) throw Error('Transfer direction changed');
    const rank = { connecting: 0, 'awaiting-acceptance': 1, transferring: 2, verifying: 3 };
    if (previous && rank[value.phase] < rank[previous.phase]) return;
    this.makeRoom(value.id);
    const { stagedPaths, pinCode, ...safe } = value;
    if (value.direction === 'outgoing' && Array.isArray(safe.files)) safe.files = safe.files.map(file => path.basename(file));
    const record = { created: Date.now(), ...this.transfers.get(value.id), ...safe, transport: 'quick-share', supportsResume: false };
    // A helper completion is an assertion to validate, never a committed result.
    // failure() must still be able to interrupt a rejected or failed publication.
    if (value.phase === 'complete' && value.direction === 'incoming') record.phase = 'verifying';
    this.transfers.set(value.id, record);
    if (value.direction === 'outgoing' && /^\d{4}$/.test(pinCode || '') && !this.verifications.has(value.id)) {
      this.verifications.add(value.id); this.emit('verification', { id: value.id, code: pinCode, name: value.name });
    }
    if (value.phase === 'awaiting-acceptance' && value.direction === 'incoming' && !this.confirming.has(value.id)) {
      if (!Array.isArray(value.files) || !value.files.length || value.files.length > 100 || !value.files.every(validName) || !/^\d{4}$/.test(pinCode || '') || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 64 * 1024 ** 3) {
        await this.request('respond', { transferId: value.id, accept: false }); return;
      }
      const manifest = this.stagedManifest(stagedPaths);
      if (manifest.paths.length !== value.files.length || manifest.paths.some((source, index) => path.basename(source) !== value.files[index]) || [...this.manifests.entries()].some(([id, other]) => id !== value.id && other.directory === manifest.directory)) throw Error('Invalid receive manifest');
      this.manifests.set(value.id, { ...manifest, total: value.total });
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
          if (accept === true) this.accepted.add(value.id);
          try { await this.request('respond', { transferId: value.id, accept: accept === true }); }
          catch (error) { this.accepted.delete(value.id); throw error; }
        }
      }).catch(() => {}).finally(() => clearTimeout(timer));
    }
    if (value.phase === 'complete' && value.direction === 'incoming') {
      if (!this.accepted.has(value.id)) throw Error('Transfer was not accepted');
      if (!Array.isArray(stagedPaths) || !stagedPaths.length || stagedPaths.length > 100 || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 64 * 1024 ** 3) throw Error('Invalid completed transfer');
      const manifest = this.manifests.get(value.id);
      if (!manifest || value.total !== manifest.total || stagedPaths.length !== manifest.paths.length || new Set(stagedPaths).size !== stagedPaths.length || stagedPaths.some(source => !manifest.paths.includes(source))) throw Error('Receive manifest changed after consent');
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
      if (generation !== this.generation || !this.child) { record.phase = 'interrupted'; return; }
      record.phase = 'complete'; record.integrity = 'protocol-authenticated';
      this.accepted.delete(value.id);
    }
    if (['complete', 'interrupted', 'declined', 'cancelled', 'outcome-unknown'].includes(record.phase)) {
      const manifest = this.manifests.get(value.id);
      if (manifest) await this.cleanStaging(manifest.directory);
      this.manifests.delete(value.id); this.accepted.delete(value.id); this.confirming.delete(value.id); this.verifications.delete(value.id);
    }
    await atomic(path.join(this.directory, 'history.json'), [...this.transfers.values()]);
    this.emit('progress', { ...record });
  }
  async send({ recipientId, sources }) {
    diagnostic.increment(this.pipeline,'outbound_requested');
    const id = recipientId?.replace(/^quick-share:/, '');
    if (!this.recipients.has(id) || this.recipients.get(id).connectable === false || this.status !== 'ready') throw Error('Quick Share recipient is unavailable.');
    if (this.busy) throw Error('Wait for the current Quick Share transfer or cancel it first.');
    const transferId = crypto.randomUUID();
    this.makeRoom(transferId);
    this.transfers.set(transferId, { id: transferId, phase: 'connecting', transport: 'quick-share', direction: 'outgoing', connectionMethod:this.recipients.get(id).connectionMethod==='lan'?'lan-tcp':this.recipients.get(id).connectionMethod, name: this.recipients.get(id).name, files: sources.map(source => path.basename(source)), created: Date.now() });
    this.emit('progress', { ...this.transfers.get(transferId) });
    try { await this.request('send', { recipientId: this.recipients.get(id).endpointId, files: sources, transferId }); }
    catch (error) { this.transfers.get(transferId).phase = 'interrupted'; this.emit('progress', { ...this.transfers.get(transferId) }); throw error; }
    return { transferId };
  }
  cancel(id) { return this.request('cancel', { transferId: id }); }
  makeRoom(id) {
    if (this.transfers.has(id) || this.transfers.size < 100) return;
    const oldest = [...this.transfers.values()].filter(record => ['complete', 'interrupted', 'declined', 'cancelled', 'outcome-unknown'].includes(record.phase)).sort((a, b) => (a.created || 0) - (b.created || 0))[0];
    if (!oldest) throw Error('Too many active Quick Share transfers.');
    this.transfers.delete(oldest.id); this.accepted.delete(oldest.id); this.confirming.delete(oldest.id); this.verifications.delete(oldest.id);
  }
  stagedManifest(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100 || new Set(paths).size !== paths.length) throw Error('Invalid staged paths');
    let directory;
    for (const source of paths) {
      if (typeof source !== 'string' || !path.isAbsolute(source) || path.resolve(source) !== source) throw Error('Invalid staged path');
      const parts = path.relative(this.staging, source).split(path.sep);
      if (parts.length !== 2 || !/^[a-f0-9]{32}$/.test(parts[0]) || !validName(parts[1]) || (directory && directory !== parts[0])) throw Error('Unsafe staged path');
      directory = parts[0];
    }
    return { directory, paths: [...paths] };
  }
  async cleanStaging(directory) {
    if (!this.staging) return;
    if (await rootDirectory(this.staging) !== this.staging) throw Error('Unsafe staging root');
    if (directory !== undefined && !/^[a-f0-9]{32}$/.test(directory)) throw Error('Unsafe staging directory');
    if (directory === undefined && this.child) throw Error('Cannot clean active staging');
    const names = directory === undefined ? await fs.readdir(this.staging) : [directory];
    for (const name of names) if (/^[a-f0-9]{32}$/.test(name)) await fs.rm(path.join(this.staging, name), { recursive: true, force: true });
  }
  snapshot() { return { lifecycle:diagnostic.lifecycle(this.lifecycle),pipeline:diagnostic.pipeline(this.pipeline), runtimeCapabilities: runtimeCapabilities(this), enabled: this.enabled, status: this.status, bluetooth: sanitizeBluetooth(this.bluetooth), listenerPort: this.status === 'ready' ? this.listenerPort : null, bleFastInitState: this.bleFastInitState === 'registered-for-120s' && Date.now() - this.bleFastInitAt >= 120000 ? 'expired' : this.bleFastInitState || 'not-requested', error: this.error || '', capabilities: this.capabilities || { lan: false, ble: false, direct: false, resume: false, persistentTrust: false }, recipients: [...this.recipients.values()], transfers: [...this.transfers.values()].map(record => ({ ...record })) }; }
  diagnostics() {
    // Deliberately construct an allowlist: snapshot() includes private names,
    // paths and transfer identifiers and must never become a diagnostic export.
    return { schema: 1, experimental: true, status: this.status, lifecycle:diagnostic.lifecycle(this.lifecycle),pipeline:diagnostic.pipeline(this.pipeline), runtimeCapabilities: runtimeCapabilities(this),
      errorCode: this.status === 'error' ? 'HELPER_UNAVAILABLE' : null,
      bluetooth: sanitizeBluetooth(this.bluetooth),
      capabilities: Object.fromEntries(['lan', 'ble', 'bleScanning', 'bleAdvertising', 'gattBootstrap', 'l2cap', 'lanListening', 'lanUpgrade', 'directWireless', 'direct', 'resume', 'persistentTrust'].map(key => [key, this.capabilities?.[key] === true])),
      counts: { recipients: this.recipients.size, transfers: this.transfers.size,
        active: [...this.transfers.values()].filter(record => !TERMINAL.has(record.phase)).length,
        pendingRequests: this.requests.size, pendingTransfers: this.pendingTransfers.size } };
  }
  async stop() {
    this.stopping = true;this.lifecycle.shutdownRequested=true;this.forcedStop=false;
    ++this.generation;
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      let timer;
      const closed = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
      child.stdin.end();
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, this.bleNative ? 15000 : 5000); })]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        this.forcedStop=true;child.kill('SIGKILL');
        await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); clearTimeout(timer);
      }
    }
    const exited = !child || child.exitCode !== null || child.signalCode !== null;
    if (!exited) throw Error('Quick Share could not stop safely.');
    this.child = null; if (this.lifecycle.outcome === 'running') this.lifecycle={outcome:this.forcedStop?'forced-stop':'clean-stop',shutdownRequested:true};
    this.failure('Quick Share stopped.', false, this.lifecycle.outcome !== 'unexpected-exit');
    await this.events; await this.cleanStaging();
    if (this.lifecycle.outcome !== 'unexpected-exit') this.status = this.enabled ? 'stopped' : 'disabled';
    this.emit('state',this.snapshot());
    this.accepted.clear(); this.confirming.clear(); this.verifications.clear(); this.manifests.clear();
  }
}
module.exports = { QuickShare };

// Allowlist only local counters/capabilities and fixed failure stages. No names,
// addresses, endpoint IDs, packet bodies, keys or verification codes escape.
const BLE_STAGES = new Set(['not-requested','starting','stopped','adapter-ready','adapter-unavailable','advertisement-registration-failed','scan-start-failed','gatt-connection-pending','gatt-resolution-pending','gatt-resolution-failed','gatt-session-failed','gatt-registration-failed','weave-established','l2cap-connection-pending','l2cap-established','l2cap-session-failed','connection-failed']);
function sanitizeBluetooth(value = {}) {
  const result = Object.fromEntries(['bleScanning','bleAdvertising','gattBootstrap','l2cap','lanUpgrade','directWireless'].map(k => [k, value?.[k] === true]));
  result.stage = BLE_STAGES.has(value?.stage) ? value.stage : 'not-requested';
  result.mode = ['off','dual','compact-gatt'].includes(value?.mode) ? value.mode : 'off';
  result.selectedMethod = ['ble-gatt','ble-l2cap','lan'].includes(value?.selectedMethod) ? value.selectedMethod : 'none';
  for (const key of ['observed','decoded','resolved','ready']) result[key] = Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? Math.min(value[key], 1000000) : 0;
  if (value?.controller && typeof value.controller === 'object') {
    const c = value.controller; result.controller = { bluez: c.bluez === true, powered: c.powered === true, extendedAdvertising: c.extendedAdvertising === true, registrationTested: false };
    for (const key of ['advertisingInstances','activeInstances','maxAdvertisementLength','maxScanResponseLength']) result.controller[key] = Number.isInteger(c[key]) && c[key] >= 0 && c[key] <= 255 ? c[key] : null;
  }
  result.diagnostics = diagnostic.diagnostics(value?.diagnostics);
  return result;
}
module.exports.sanitizeBluetooth = sanitizeBluetooth;

function runtimeCapabilities(adapter) {
  const b=sanitizeBluetooth(adapter.bluetooth);
  return { bleScanning:b.bleScanning, bleAdvertising:b.bleAdvertising, gattBootstrap:b.gattBootstrap, l2cap:b.l2cap, lanListening:adapter.status === 'ready' && Number.isInteger(adapter.listenerPort) && adapter.listenerPort > 0, lanUpgrade:false, directWireless:false };
}
