'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getPaths } = require('./paths');
const CHANNELS = new Set(['github', 'deb', 'flatpak', 'arch']);
function installation(paths = getPaths(), env = process.env) {
  let channel = env.APPIMAGE ? 'appimage' : 'github';
  if (!env.APPIMAGE) {
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(paths.app, 'install-source.json'), 'utf8'));
      if (!CHANNELS.has(marker.channel) || marker.schema !== 1) throw new Error('Invalid installation marker');
      channel = marker.channel;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { channel, managed: ['deb', 'flatpak', 'arch'].includes(channel), app: paths.app };
}
function assertSelfUpdate(paths) {
  if (installation(paths).managed) throw new Error('This installation is managed by its package manager. Use the package update option.');
}
module.exports = { installation, assertSelfUpdate };
