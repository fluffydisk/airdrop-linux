'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'desktop/core');
fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
fs.mkdirSync(path.join(target, 'ui'), { recursive: true });
for (const name of ['files.js', 'transfer.js', 'paths.js', 'explorer.js', 'maintenance.js', 'updater.js', 'installation.js', 'backend-control.js']) fs.copyFileSync(path.join(root, 'lib', name), path.join(target, 'lib', name));
fs.copyFileSync(path.join(root, 'ui/zip.js'), path.join(target, 'ui/zip.js'));
fs.copyFileSync(path.join(root, 'ui/icon-192.png'), path.join(target, 'ui/icon-192.png'));

for (const name of ['explorer.js', 'explorer.css']) fs.copyFileSync(path.join(root, 'ui', name), path.join(target, 'ui', name));
