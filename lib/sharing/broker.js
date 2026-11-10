'use strict';
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

// Protocol engines retain ownership of their identities, journals and transfers.
// This boundary selects recipients and coordinates explicit browser invitations.
class SharingBroker extends EventEmitter {
  constructor({ nearby, devices, quickShare, now = Date.now, invitationTimeout = 90000, pollInterval = 250 } = {}) {
    super();
    this.nearby = nearby; this.devices = devices; this.quickShare = quickShare; this.now = now;
    this.invitationTimeout = invitationTimeout; this.pollInterval = pollInterval;
    this.invitation = { status: 'idle' }; this.generation = 0; this.queue = Promise.resolve();
  }
  async snapshot() {
    const nearby = await this.nearby.snapshot().catch(() => ({ devices: [], outgoing: [], incoming: [], enabled: false, discoveryError: 'Nearby is unavailable. Share a link or QR instead.' }));
    const connection = await this.devices.snapshot();
    const quickShare = this.quickShare?.snapshot() || { enabled: false, recipients: [], transfers: [] };
    return {
      recipients: [...nearby.devices.map(device => ({
        id: device.id, name: device.name, kind: 'device',
        availability: device.availability || (device.online ? 'available' : 'offline'),
        trust: device.trusted ? 'paired' : 'unverified', lastUsed: device.lastUsed,
        routes: [{ id: device.id, transport: 'linux-nearby', availability: device.online ? 'available' : 'unavailable',
          requiresAcceptance: !device.autoAccept, requiresNetworkChange: false, supportsResume: true }]
      })), ...quickShare.recipients.map(device => ({ ...device, kind: 'device', trust: 'unverified', routes: [{ id: device.id, transport: 'quick-share', availability: device.availability, requiresAcceptance: true, requiresNetworkChange: false, supportsResume: false }] }))],
      nearby, quickShare,
      connection: { status: connection.status, mode: connection.mode, message: connection.message, providers: connection.providers },
      invitation: this.invitationSnapshot()
    };
  }
  invitationSnapshot() {
    const value = this.invitation;
    if (value.status === 'ready' && !this.currentInvitation()) {
      this.invitation = { ...value, status: 'expired', url: undefined, qr: undefined, message: 'This link expired or the connection changed. Create a new link.' };
    }
    const { session, gateway, generation, epoch, origin, ...safe } = this.invitation;
    return safe;
  }
  currentInvitation() {
    const value = this.invitation;
    return value.status === 'ready' && value.expires > this.now() && this.devices.state.status === 'ready' &&
      value.generation === this.devices.generation && value.gateway === this.devices.gateway &&
      value.session === this.devices.gateway?.guest.session && value.origin === value.gateway.origin &&
      value.epoch === (value.gateway.epoch || 0);
  }
  async send({ recipientId, sources, retryId }) {
    if (recipientId?.startsWith('quick-share:')) {
      if (!this.quickShare || retryId) throw Error('Select files to start a fresh Quick Share transfer.');
      return this.quickShare.send({ recipientId, sources });
    }
    if (typeof recipientId !== 'string' || !/^[a-f0-9]{64}$/.test(recipientId)) throw Error('Choose an available recipient.');
    return this.nearby.send(recipientId, sources, retryId);
  }
  enqueue(work) { const result = this.queue.then(work); this.queue = result.catch(() => {}); return result; }
  startInvitation(options = {}) { return this.enqueue(() => this.beginInvitation(options)); }
  async beginInvitation({ sources = [], direction = 'send', provider } = {}) {
    if (!Array.isArray(sources) || sources.length > 100 || !sources.every(p => typeof p === 'string')) throw Error('Choose up to 100 files.');
    if (!['send', 'receive', 'both'].includes(direction)) throw Error('Choose a valid invitation permission.');
    if (direction === 'send' && !sources.length) throw Error('Choose files to share first.');
    if (provider !== undefined && !['internet', 'lan', 'tailscale', 'private'].includes(provider)) throw Error('Unknown connection provider.');
    // Only an explicit provider action may start or change a connection.
    if (this.devices.state.status !== 'ready' && provider === undefined) {
      return { status: 'connection-required', message: 'Choose a connection for this invitation.' };
    }
    await this.revokeInvitation();
    const generation = ++this.generation;
    const controller = this.controller = new AbortController();
    this.invitation = { status: 'preparing', message: 'Preparing a verified sharing link…' };
    this.task = this.prepareInvitation({ sources: [...sources], direction, provider, generation, signal: controller.signal })
      .catch(error => {
        if (generation === this.generation) this.invitation = { status: 'error', message: error.message };
      });
    return this.invitationSnapshot();
  }
  async prepareInvitation({ sources, direction, provider, generation, signal }) {
    if (provider && (this.devices.state.status !== 'ready' || provider !== this.devices.state.mode)) await this.devices.action(provider);
    const connectionGeneration = this.devices.generation;
    const deadline = this.now() + this.invitationTimeout;
    while (this.devices.state.status !== 'ready') {
      signal.throwIfAborted();
      if (connectionGeneration !== this.devices.generation) throw Error('Connection changed. Create a new invitation.');
      const state = this.devices.state;
      if (['error', 'local', 'disconnected', 'setup-required', 'needs-login', 'needs-approval', 'phone-verification'].includes(state.status)) {
        throw Error(state.message || 'Finish connecting in Settings, then create a new invitation.');
      }
      if (this.now() >= deadline) throw Error('The connection could not be verified. Retry or choose another permitted connection in Settings.');
      await delay(this.pollInterval, undefined, { signal });
    }
    signal.throwIfAborted();
    if (generation !== this.generation || connectionGeneration !== this.devices.generation) return;
    const gateway = this.devices.gateway;
    const prepared = await this.devices.startGuest(sources, { allowUploads: direction !== 'send' });
    const session = gateway.guest.session;
    if (!session || new URL(prepared.url).hash !== '#' + session.token) throw Error('Guest session changed. Create a new invitation.');
    this.pendingSession = { gateway, session };
    if (signal.aborted || generation !== this.generation) {
      // stopInvitation waits for this task before revoking its session.
      return;
    }
    if (gateway !== this.devices.gateway || connectionGeneration !== this.devices.generation) throw Error('Connection changed. Create a new invitation.');
    this.invitation = { status: 'ready', ...prepared, direction, provider: this.devices.state.mode,
      session, gateway, origin: gateway.origin, epoch: gateway.epoch || 0, generation: connectionGeneration };
    this.pendingSession = null;
  }
  stopInvitation() { return this.enqueue(() => this.revokeInvitation()); }
  async revokeInvitation() {
    ++this.generation;
    this.controller?.abort();
    await this.task;
    const previous = this.invitation;
    if (previous.gateway && previous.session === previous.gateway.guest.session) await previous.gateway.guest.close();
    // A cancelled preparation may just have created a session. Revoke it only
    // if it belongs to that preparation, never a newer legacy guest session.
    if (this.pendingSession && this.pendingSession.session === this.pendingSession.gateway.guest.session) await this.pendingSession.gateway.guest.close();
    this.pendingSession = null;
    this.invitation = { status: 'idle' };
  }
  invitationLink() {
    if (!this.currentInvitation()) throw Error('Create a fresh verified link first.');
    return this.invitation.url;
  }
  async stop() { await Promise.all([this.stopInvitation(), this.quickShare?.stop()]); }
}
module.exports = { SharingBroker };
