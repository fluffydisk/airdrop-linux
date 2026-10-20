'use strict';
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const exec = promisify(execFile);
class FlatpakSession {
  constructor(paths) { this.paths = paths; this.child = null; this.background = false; }
  async start() {
    if (this.child) return;
    const env = { ...process.env, AIRDROP_APP_DIR: this.paths.app, AIRDROP_HOME: this.paths.root };
    await exec(path.join(this.paths.app, 'runtime/node'), [path.join(this.paths.server, 'scripts/user-service.js'), '--init'], { env });
    this.child = spawn(path.join(this.paths.app, 'runtime/node'), [path.join(this.paths.server, 'scripts/user-service.js')], { env, stdio: 'ignore' });
    this.child.once('error', () => { this.child = null; }); this.child.once('exit', () => { this.child = null; });
  }
  async requestBackground() {
    const dbus = require('dbus-next'), bus = dbus.sessionBus(); bus.on('error', () => {});
    try {
      const proxy = await bus.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop');
      const portal = proxy.getInterface('org.freedesktop.portal.Background');
      const token = 'airdrop' + process.pid;
      const requestPath = '/org/freedesktop/portal/desktop/request/' + bus.name.slice(1).replaceAll('.', '_') + '/' + token;
      const request = await bus.getProxyObject('org.freedesktop.portal.Desktop', requestPath, '<node><interface name="org.freedesktop.portal.Request"><signal name="Response"><arg type="u"/><arg type="a{sv}"/></signal></interface></node>');
      const response = new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 60000);
        request.getInterface('org.freedesktop.portal.Request').once('Response', (code, result) => { clearTimeout(timer); resolve(code === 0 && result.background?.value === true); });
      });
      await portal.RequestBackground('', { handle_token: new dbus.Variant('s', token), reason: new dbus.Variant('s', 'Keep private file sharing available during your desktop session.'), autostart: new dbus.Variant('b', true), commandline: new dbus.Variant('as', ['airdrop', '--background']) });
      this.background = await response;
    } catch { this.background = false; }
    finally { bus.disconnect(); }
    return this.background;
  }
  async stop() {
    const child = this.child; if (!child) return;
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  }
}
module.exports = { FlatpakSession };
