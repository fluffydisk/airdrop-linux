'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');

async function verifiedHelper({ directory, asset, request = fetch, signal, progress = () => {} }) {
  if (!asset || !/^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\//.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Internet sharing is unavailable on this system. Use Wi-Fi sharing instead.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, 'cloudflared-' + asset.sha256);
  try {
    const stat = await fs.lstat(target);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size === asset.size && crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') === asset.sha256) { await fs.chmod(target,0o700);return target; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await request(asset.url, { signal });
  if (!response.ok || !response.body) throw Error('The connection component could not be downloaded. Check your internet connection and try again.');
  const temporary = target + '.' + crypto.randomBytes(8).toString('hex') + '.part';
  const file = await fs.open(temporary, 'wx', 0o600), hash = crypto.createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted(); size += chunk.byteLength;
      if (size > asset.size) throw Error('Connection component verification failed.');
      hash.update(chunk); await file.writeFile(chunk); progress(size, asset.size);
    }
    if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw Error('Connection component verification failed. Please try again.');
    await file.close(); await fs.chmod(temporary, 0o700); await fs.rename(temporary, target);
    return target;
  } catch (error) { await file.close().catch(() => {}); await fs.rm(temporary, { force: true }); throw error; }
}

// Optional, account-free internet sharing through Cloudflare Quick Tunnels.
// Wi-Fi sharing remains independent of this service.
class InternetConnection {
  constructor({ directory, asset, target, proxyHost, onState = () => {}, request, spawnProcess = spawn } = {}) {
    const local = new URL(target);
    if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1') throw Error('Internet sharing must target the local sharing gateway.');
    this.directory = directory; this.asset = asset; this.target = target; this.proxyHost = proxyHost;
    this.onState = onState; this.request = request; this.spawnProcess = spawnProcess; this.stopped = true;
  }
  start() { this.stopped = false; this.controller = new AbortController(); this.run().catch(() => { if (!this.stopped) this.onState({ status: 'error', message: 'Free internet sharing could not start. Try again, or connect over the same Wi-Fi.' }); }); }
  async run() {
    this.onState({ status: 'downloading', message: 'Preparing free internet sharing inside Airdrop…' });
    const helper = await verifiedHelper({ directory: this.directory, asset: this.asset, request: this.request, signal: this.controller.signal,
      progress: (size, total) => this.onState({ status: 'downloading', message: `Preparing connection: ${Math.floor(size / total * 100)}% downloaded` }) });
    if (this.stopped) return;
    const config = path.join(this.directory, 'quick-tunnel.yml'); await fs.writeFile(config, '{}\n', { mode: 0o600 });
    if (this.stopped) return;
    this.onState({ status: 'connecting', message: 'Creating your free internet connection…' });
    const child = this.spawnProcess(helper, ['tunnel', '--config', config, '--no-autoupdate', '--protocol', 'http2', '--output', 'json', '--metrics', '127.0.0.1:0', '--url', this.target, '--http-host-header', this.proxyHost], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = child;
    this.timer = setTimeout(() => { if (!this.origin && !this.stopped) { this.onState({ status: 'error', message: 'The free connection service did not respond. Try again or use Wi-Fi sharing.' }); child.kill('SIGTERM'); } }, 60000);
    for (const stream of [child.stdout, child.stderr]) {
      let buffer = '';
      stream.on('data', chunk => {
        if (this.stopped) return;
        buffer = (buffer + chunk).slice(-65536);
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s|"\\]|$)/.exec(line);
          if (match && !this.origin) {
            this.origin = match[0]; clearTimeout(this.timer);
            this.onState({ status: 'checking', origin: this.origin, message: 'Checking your connection before sharing…' });
          }
        }
      });
    }
    child.on('error', () => { clearTimeout(this.timer); if (!this.stopped) this.onState({ status: 'error', message: 'The internet connection could not start. Use Wi-Fi sharing or try again.' }); });
    child.on('exit', () => { clearTimeout(this.timer); if (!this.stopped) this.onState({ status: 'error', message: 'Internet sharing stopped. Reconnect here, or use Wi-Fi sharing.' }); });
  }
  async stop() {
    this.stopped = true; this.controller?.abort(); clearTimeout(this.timer);
    const child = this.proc; this.proc = null;
    if (!child || child.exitCode !== null || child.signalCode) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
    });
  }
}
module.exports = { InternetConnection, verifiedHelper };
