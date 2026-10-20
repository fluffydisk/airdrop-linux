'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { connectionState } = require('./core/lib/connection');
const NAME = 'io.github.fluffydisk.Airdrop.System';
const INTERFACE = NAME + '1';
const OBJECT = '/io/github/fluffydisk/Airdrop/System';
class Setup {
  constructor(paths, source, notify = () => {}) { this.paths = paths; this.source = source; this.firstLaunch = source.managed && !fs.existsSync(paths.env); this.notify = notify; this.value = { channel: source.channel, state: 'checking', label: 'Checking private connection…', step: 0 }; this.authUrl = ''; this.bus = null; this.iface = null; this.pending = false; this.polling = false; this.sessionError = ''; this.error = ''; }
  async bridge() {
    if (this.iface) return this.iface;
    const dbus = require('dbus-next');
    if (!this.bus) { this.bus = dbus.systemBus(); this.bus.on('error', () => { this.iface = null; }); }
    const proxy = await this.bus.getProxyObject(NAME, OBJECT);
    this.iface = proxy.getInterface(INTERFACE); return this.iface;
  }
  migrationRequired() {
    return ['deb', 'arch'].includes(this.source.channel) && (fs.existsSync(require('node:path').join(this.paths.root, 'app/desktop/Airdrop')) || ['airdrop-push.service', 'airdropshare.service'].some(name => fs.existsSync('/etc/systemd/system/' + name))) && !fs.existsSync(require('node:path').join(this.paths.config, 'package-migration-complete'));
  }
  async session() {
    if (!['deb', 'arch'].includes(this.source.channel) || this.migrationRequired()) return;
    const env = { ...process.env, AIRDROP_APP_DIR: this.paths.app, AIRDROP_HOME: this.paths.root };
    await exec(path.join(this.paths.app, 'runtime/node'), [path.join(this.paths.server, 'scripts/user-service.js'), '--init'], { env, timeout: 15000 });
    // A per-user environment file supports custom XDG roots without mutating global manager environment.
    const file = path.join(this.paths.config, 'session.env');
    for (const value of [this.paths.root, this.paths.app]) if (/[\n\r\0]/.test(value)) throw new Error('Invalid application path');
    fs.writeFileSync(file, `AIRDROP_HOME=${JSON.stringify(this.paths.root)}\nAIRDROP_APP_DIR=${JSON.stringify(this.paths.app)}\n`, { mode: 0o600 });
    for (const unit of ['airdrop-session.service', 'airdrop-prepare-stop.service']) {
      const dropin = path.join(process.env.XDG_CONFIG_HOME || path.join(require('node:os').homedir(), '.config'), 'systemd/user', unit + '.d');
      fs.mkdirSync(dropin, { recursive: true });
      fs.writeFileSync(path.join(dropin, 'data-root.conf'), `[Service]\nEnvironmentFile=${JSON.stringify(file).replaceAll('%', '%%')}\n`, { mode: 0o600 });
    }
    await exec('/usr/bin/systemctl', ['--user', 'daemon-reload']);
    await exec('/usr/bin/systemctl', ['--user', 'enable', '--now', 'airdrop-session.service']);
  }
  async poll() {
    if (this.polling) return this.value;
    this.polling = true;
    try {
      const raw = JSON.parse(await (await this.bridge()).Status());
      if (raw.protocol !== 1) throw new Error('Update the Airdrop system connection component.');
      this.value = { ...connectionState(raw), bridge: true, migrationRequired: this.migrationRequired(), pending: this.pending, sessionError: this.sessionError, message: this.error, loginAvailable: Boolean(this.authUrl) };
      if (this.value.url) {
        this.value.qr = await require('qrcode').toDataURL(this.value.url, { width: 220, margin: 2 });
      }
    } catch (error) {
      this.iface = null;
      this.value = { state: 'bridge-missing', step: 0, label: 'Install the system connection component to set up Tailscale.', bridge: false, action: 'bridge', pending: this.pending, sessionError: this.sessionError, message: this.error, loginAvailable: Boolean(this.authUrl) };
    } finally { this.polling = false; this.notify({ ...this.value, channel: this.source.channel, firstLaunch: this.firstLaunch }); }
    return this.value;
  }
  async run(action) {
    if (!['install', 'start', 'connect', 'share', 'migrate'].includes(action)) throw new Error('Unknown setup action');
    if (this.pending) throw new Error('Wait for the current setup operation to finish.');
    this.pending = true; this.error = ''; this.authUrl = ''; let migrationMarker;
    try {
      if (action === 'migrate') {
        await require('./migration').check(this.paths);
        migrationMarker = require('node:path').join(this.paths.root, 'state/update-lock.json');
        await fs.promises.mkdir(require('node:path').dirname(migrationMarker), { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(migrationMarker, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
        await require('./core/lib/maintenance').drain(this.paths.root, 120000);
      }
      const bridge = await this.bridge();
      const id = await bridge.Run(action); let opened = false;
      while (true) {
        const job = JSON.parse(await bridge.GetJob(id));
        if (job.auth_url && !opened) {
          const url = new URL(job.auth_url);
          if (url.protocol !== 'https:' || url.hostname !== 'login.tailscale.com' || url.username || url.password || url.port) throw new Error('Unexpected authentication link');
          this.authUrl = url.href; opened = true;
          await require('electron').shell.openExternal(url.href);
        }
        this.notify({ ...this.value, pending: true, message: job.message, loginAvailable: Boolean(this.authUrl) });
        if (job.state === 'error') throw new Error(job.message);
        if (job.state === 'complete') break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (action === 'migrate') {
        try { await require('./migration').apply(this.paths); fs.writeFileSync(path.join(this.paths.config, 'package-migration-complete'), '1\n', { mode: 0o600 }); await this.session(); }
        catch (error) {
          const rollback = await bridge.Run('restore-migration');
          while (true) { const job = JSON.parse(await bridge.GetJob(rollback)); if (job.state !== 'running') break; await new Promise(resolve => setTimeout(resolve, 500)); }
          throw error;
        }
      }
      this.authUrl = '';
    } catch (error) { this.error = error.message; throw error; }
    finally {
      if (migrationMarker) {
        try { const marker = JSON.parse(await fs.promises.readFile(migrationMarker, 'utf8')); if (marker.pid === process.pid) await fs.promises.unlink(migrationMarker); } catch {}
      }
      this.pending = false; await this.poll();
    }
  }
  close() { this.bus?.disconnect(); }
}
module.exports = { Setup, NAME, INTERFACE, OBJECT };
