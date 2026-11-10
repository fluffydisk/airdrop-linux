'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'desktop/core');
fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
fs.mkdirSync(path.join(target, 'ui'), { recursive: true });
fs.cpSync(path.join(root, 'lib/sharing'), path.join(target, 'lib/sharing'), { recursive: true });
for(const name of ['public-connection-probe.js','public-probe-process.js','public-probe-worker.js'])fs.rmSync(path.join(target,'lib',name),{force:true});
for (const name of ['nearby.js', 'peer-store.js', 'guest-share.js', 'files.js', 'transfer.js', 'paths.js', 'explorer.js', 'maintenance.js', 'updater.js', 'installation.js', 'backend-control.js', 'device-share.js', 'devices.js', 'connection-health.js', 'relay-client.js', 'relay-protocol.js', 'connection-service.js', 'internet-connection.js', 'tailscale-connection.js']) fs.copyFileSync(path.join(root, 'lib', name), path.join(target, 'lib', name));
fs.copyFileSync(path.join(root, 'packaging/internet-helper.json'), path.join(target, 'internet-helper.json'));
const service = require('../packaging/connection-service.json');
if (process.env.AIRDROP_CONNECTION_SERVICE_URL) service.relayUrl = require('../lib/relay-protocol').relayUrl(process.env.AIRDROP_CONNECTION_SERVICE_URL).origin;
if (service.relayUrl) require('../lib/relay-protocol').relayUrl(service.relayUrl);
fs.writeFileSync(path.join(target, 'connection-service.json'), JSON.stringify(service));
fs.copyFileSync(path.join(root, 'ui/zip.js'), path.join(target, 'ui/zip.js'));
fs.copyFileSync(path.join(root, 'ui/icon-192.png'), path.join(target, 'ui/icon-192.png'));

for (const name of ['guest.html', 'guest.js', 'guest.css', 'explorer.js', 'explorer.css']) fs.copyFileSync(path.join(root, 'ui', name), path.join(target, 'ui', name));
