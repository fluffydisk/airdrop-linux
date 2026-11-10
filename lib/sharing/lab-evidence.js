'use strict';
// Developer laboratory evidence. Never serialize adapter snapshots or raw logs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const PHASES = new Set(['connecting', 'awaiting-acceptance', 'transferring', 'verifying', 'complete', 'declined', 'cancelled', 'interrupted', 'outcome-unknown']);
const STATUSES = new Set(['disabled', 'starting', 'ready', 'error', 'stopped']);
const MAX_EVENTS = 2000;
const PROTOCOL_STAGES = new Set(['Initial', 'ReceivedConnectionRequest', 'SentUkeyServerInit', 'SentUkeyClientInit', 'SentUkeyClientFinish', 'SentPairedKeyEncryption', 'ReceivedUkeyClientFinish', 'SentConnectionResponse', 'SentPairedKeyResult', 'ReceivedPairedKeyResult', 'WaitingForUserConsent', 'ReceivingFiles', 'SendingFiles', 'Disconnected', 'Rejected', 'Cancelled', 'Finished', 'Sent', 'SentIntroduction']);
const LAB_FIXTURES = ['lab-empty.bin', 'lab-small.txt', 'lab-unicode-日本語-é.txt', 'lab-binary.bin', 'lab-image.png', 'lab-image.jpg', 'lab-medium.bin', ...Array.from({ length: 8 }, (_, i) => `lab-batch-${i + 1}.txt`)];
function readJson(file, limit = 1024 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > limit) throw Error('Invalid lab metadata'); return JSON.parse(fs.readFileSync(fd, 'utf8')); }
  finally { fs.closeSync(fd); }
}
function atomicJson(root, name, value) {
  atomicText(root, name, JSON.stringify(value, null, 2) + '\n');
}
function atomicText(root, name, value) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw Error('Invalid lab output name');
  const tmp = path.join(root, '.' + name + '-' + crypto.randomBytes(8).toString('hex'));
  try { fs.writeFileSync(tmp, value, { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, path.join(root, name)); }
  finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
function ownedDirectory(root) {
  const info = fs.lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(root) !== root || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077)) throw Error('Lab directory must be private, owned and canonical');
}
function capabilities(value = {}) {
  return Object.fromEntries(['lan', 'ble', 'bleFastInit', 'direct', 'resume', 'persistentTrust'].map(key => [key, value[key] === true]));
}
function number(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 64 * 1024 ** 3 ? value : 0; }
function category(error) {
  // Classification only. Errors can include local paths, peer data and codes.
  if (/verification|metadata/i.test(error || '')) return 'HELPER_VERIFICATION';
  if (/capabilit/i.test(error || '')) return 'CAPABILITY_UNAVAILABLE';
  if (/message|IPC/i.test(error || '')) return 'IPC_PROTOCOL';
  if (/staging|safely completed/i.test(error || '')) return 'RECEIVE_VALIDATION';
  if (/respond in time/i.test(error || '')) return 'IPC_TIMEOUT';
  return 'HELPER_UNAVAILABLE';
}
class Evidence {
  constructor(run) {
    this.run = run; this.started = performance.now(); this.aliases = new Map(); this.last = new Map();
    this.value = { schema: 1, run, startedAt: new Date().toISOString(), helper: { status: 'starting', started: false, listenerPort: null, capabilities: capabilities() }, recipients: 0, maxRecipients: 0, events: [], truncated: false };
  }
  event(type, fields = {}) {
    const item = { at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - this.started), type, ...fields };
    if (this.value.events.length === MAX_EVENTS) { this.value.events.shift(); this.value.truncated = true; }
    this.value.events.push(item);
  }
  state(snapshot) {
    const status = STATUSES.has(snapshot.status) ? snapshot.status : 'error';
    if (status !== this.value.helper.status) this.event('helper', { status, ...(status === 'error' ? { category: category(snapshot.error) } : {}) });
    this.value.helper = { status, started: status === 'ready', listenerPort: status === 'ready' && Number.isInteger(snapshot.listenerPort) && snapshot.listenerPort > 0 && snapshot.listenerPort <= 65535 ? snapshot.listenerPort : null, capabilities: capabilities(snapshot.capabilities), bleFastInitState: ['registered-for-120s', 'expired', 'bluez-unavailable', 'bluez-timeout', 'permission-denied', 'not-supported', 'bluetooth-off', 'no-adapter', 'adapter-busy', 'bluez-operation-failed', 'unavailable-or-denied'].includes(snapshot.bleFastInitState) ? snapshot.bleFastInitState : 'not-requested' };
    const count = Array.isArray(snapshot.recipients) ? Math.min(snapshot.recipients.length, 100) : 0;
    if (count !== this.value.recipients) this.event('discovery', { recipients: count });
    this.value.recipients = count; this.value.maxRecipients = Math.max(count, this.value.maxRecipients);
  }
  transfer(value) {
    if (!PHASES.has(value.phase) || !['incoming', 'outgoing'].includes(value.direction)) return;
    if (!this.aliases.has(value.id)) {
      if (this.aliases.size >= 100) { this.value.truncated = true; return; }
      this.aliases.set(value.id, 'attempt-' + (this.aliases.size + 1));
    }
    const attempt = this.aliases.get(value.id), key = attempt + ':' + value.phase;
    // Record transitions, not every progress tick; UI state remains in adapter.
    if (this.last.get(attempt) === key) return;
    this.last.set(attempt, key);
    this.event('transfer', { attempt, direction: value.direction, phase: value.phase, bytes: number(value.bytes), total: number(value.total) });
  }
  consent(accept) { this.event('consent', { accepted: accept === true }); }
  protocol(value) {
    if (!PROTOCOL_STAGES.has(value.protocolStage) || !['incoming', 'outgoing'].includes(value.direction)) return;
    if (!this.aliases.has(value.id)) {
      if (this.aliases.size >= 100) { this.value.truncated = true; return; }
      this.aliases.set(value.id, 'attempt-' + (this.aliases.size + 1));
    }
    const attempt = this.aliases.get(value.id), key = 'protocol:' + attempt;
    if (this.last.get(key) === value.protocolStage) return;
    this.last.set(key, value.protocolStage);
    this.event('protocol', { attempt, direction: value.direction, stage: value.protocolStage });
  }
  verification() { this.event('verification-available'); }
}
function openLab({ directory, repository, packaged, enabled }) {
  if (!directory) return null;
  if (packaged || !enabled) throw Error('Lab mode requires the source desktop and explicit Quick Share flag');
  const root = path.resolve(directory); ownedDirectory(root);
  const marker = readJson(path.join(root, 'lab.json'));
  if (marker.schema !== 1 || marker.repository !== fs.realpathSync(repository) || !/^[a-f0-9]{32}$/.test(marker.run || '')) throw Error('Lab marker does not match this checkout');
  const evidence = new Evidence(marker.run);
  let adapter, timer;
  const flush = () => {
    ownedDirectory(root);
    if (adapter) evidence.state(adapter.snapshot());
    atomicJson(root, 'desktop-state.json', evidence.value);
  };
  return {
    root, marker, evidence,
    attach(value) { adapter = value; value.on('state', () => evidence.state(value.snapshot())); value.on('protocol', v => evidence.protocol(v)); value.on('progress', v => evidence.transfer(v)); value.on('verification', () => evidence.verification()); timer = setInterval(flush, 1000); timer.unref(); flush(); },
    ready: flush,
    async approve(run) { evidence.verification(); flush(); const accepted = await run(); evidence.consent(accepted); flush(); return accepted; },
    close() { clearInterval(timer); flush(); },
    authorizeSources(sources) {
      const fixtureRoot = path.join(root, 'fixtures'); ownedDirectory(fixtureRoot);
      const manifest = readJson(path.join(fixtureRoot, 'fixture-manifest.json'));
      if (!Array.isArray(sources) || !sources.length || sources.length > LAB_FIXTURES.length) throw Error('Choose generated lab fixtures only');
      for (const source of sources) {
        const name = typeof source === 'string' ? path.basename(source) : '';
        if (!LAB_FIXTURES.includes(name) || source !== path.join(fixtureRoot, name)) throw Error('Choose only generated files from the laboratory fixture folder');
        const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        try {
          const stat = fs.fstatSync(fd), expected = manifest[name];
          if (!stat.isFile() || !expected || stat.size !== expected.size || stat.size > 3 * 1024 * 1024) throw Error('Generated fixture changed; prepare a new workspace');
          const bytes = fs.readFileSync(fd);
          if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw Error('Generated fixture hash changed; prepare a new workspace');
        } finally { fs.closeSync(fd); }
      }
    },
    info() { let runtime = {}; try { runtime = readJson(path.join(root, 'runtime.json')); } catch {} return { localAdvertisementObserved: runtime.run === marker.run && runtime.advertisements?.ownObserved === true, listenerReachable: runtime.run === marker.run && runtime.listenerReachable === true, enabled: true, commit: marker.commit, dirty: marker.dirty === true, helperVersion: marker.helperVersion, helperSha256: marker.helperSha256, fixtureDirectory: path.join(root, 'fixtures'), inbox: path.join(root, 'sessions', marker.run, 'share', 'Received'), readbackDirectory: path.join(root, 'sessions', marker.run, 'readback'), evidence: evidence.value, bleExplanation: 'Receiver discovery is LAN-only: BLE/GATT bootstrap is not implemented. Optional FE2C helps sender discovery only. No Android compatibility is inferred from startup.' }; }
  };
}
module.exports = { Evidence, openLab, ownedDirectory, readJson, atomicJson, atomicText, capabilities, PHASES, STATUSES, LAB_FIXTURES, PROTOCOL_STAGES };
