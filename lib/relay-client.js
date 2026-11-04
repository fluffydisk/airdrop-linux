'use strict';
const http = require('node:http'), https = require('node:https'), net = require('node:net');
const { relayUrl, deviceId } = require('./relay-protocol');

class RelayClient {
  constructor({ url, accessKey, deviceKey, target, onState = () => {}, allowLoopback = false, retryDelay = 1000, transportOptions = {} } = {}) {
    this.url = relayUrl(url, { allowLoopback });
    this.transport = this.url.protocol === 'https:' ? https : http;
    this.headers = { authorization: 'Bearer ' + accessKey, 'x-airdrop-device': deviceKey };
    this.id = deviceId(deviceKey);
    this.target = new URL(target);
    if (this.target.protocol !== 'http:' || this.target.hostname !== '127.0.0.1') throw Error('Tunnel target must stay on loopback');
    this.onState = onState; this.retryDelay = retryDelay; this.transportOptions = transportOptions; this.connections = new Set(); this.stopped = true;
  }
  start() { if (!this.stopped) return; this.stopped = false; this.connect(); }
  connect() {
    if (this.stopped) return;
    this.onState({ status: 'connecting', message: 'Connecting to your Airdrop relay…' });
    let ended = false;
    const lost = () => {
      if (ended) return; ended = true;
      this.control?.destroy();
      for (const socket of this.connections) socket.destroy();
      this.connections.clear();
      if (this.stopped) return;
      this.onState({ status: 'reconnecting', message: 'Relay connection interrupted. Retrying automatically…' });
      this.timer = setTimeout(() => this.connect(), this.retryDelay);
    };
    const control = this.transport.request(new URL('/v1/control', this.url), { ...this.transportOptions, method: 'POST', headers: this.headers, agent: false }, response => {
      if (response.statusCode !== 200) {
        if ([401, 403].includes(response.statusCode)) {
          this.onState({ status: 'error', message: 'Relay access was denied. Check the relay access key in Settings.' });
          this.stopped = true;
        }
        response.resume(); lost(); return;
      }
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 65536) { lost(); return; }
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === 'ready') {
              const origin = new URL(event.origin);
              if (origin.protocol !== this.url.protocol || origin.hostname !== this.id + '.' + this.url.hostname || origin.port !== this.url.port || origin.origin !== event.origin) throw Error('Invalid relay origin');
              this.onState({ status: 'checking', origin: origin.origin, message: 'Checking the sharing endpoint…' });
            } else if (event.type === 'request' && /^[a-f0-9]{48}$/.test(event.id)) this.tunnel(event.id);
          } catch { lost(); return; }
        }
      });
      response.on('error', lost); response.on('end', lost);
    });
    this.control = control;
    control.setTimeout(45000, lost); control.on('error', lost); control.end();
  }
  track(socket) { this.connections.add(socket); socket.on('close', () => this.connections.delete(socket)); return socket; }
  tunnel(id) {
    if (this.stopped || this.connections.size >= 128) return;
    const local = this.track(net.connect({ host: '127.0.0.1', port: this.target.port }));
    local.setTimeout(300000, () => local.destroy());
    let request;
    local.on('error', () => request?.destroy());
    local.once('connect', () => {
      if (this.stopped) { local.destroy(); return; }
      // Node 26 derives CONNECT's default TLS name from the request target.
      // Our protocol uses a path, so pin SNI/certificate verification to the relay.
      request = this.transport.request(this.url, { ...this.transportOptions, servername: this.url.hostname, method: 'CONNECT', path: '/v1/tunnel/' + id, headers: this.headers, agent: false });
      request.setTimeout(15000, () => request.destroy());
      request.on('connect', (res, socket, head) => {
        this.track(socket);
        if (this.stopped || res.statusCode !== 200) { socket.destroy(); local.destroy(); return; }
        socket.setTimeout(300000, () => socket.destroy());
        socket.on('error', () => local.destroy());
        socket.on('close', () => local.destroy()); local.on('close', () => socket.destroy());
        if (head.length) local.write(head);
        socket.pipe(local); local.pipe(socket);
      });
      request.on('response', res => { res.resume(); local.destroy(); });
      request.on('error', () => local.destroy());
      local.on('close', () => request.destroy());
      request.end();
    });
  }
  stop() {
    this.stopped = true; clearTimeout(this.timer); this.control?.destroy(); this.control = null;
    for (const socket of this.connections) socket.destroy(); this.connections.clear();
  }
}
module.exports = { RelayClient };
