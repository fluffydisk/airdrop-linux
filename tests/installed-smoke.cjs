'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zip = require(path.join(process.env.HOME, '.local/share/airdrop/app/server/node_modules/jszip'));
const root = path.join(process.env.HOME, '.local/share/airdrop/files');
const name = fs.readdirSync(root).find(n => /^airdrop-.*\.zip$/.test(n));
if (!name) throw new Error('CLI ZIP output missing');
zip.loadAsync(fs.readFileSync(path.join(root, name)))
  .then(z => z.file('cli-sample.txt').async('string'))
  .then(value => { if (value !== 'cli smoke') throw new Error('CLI ZIP content differs'); })
  .catch(error => { console.error(error); process.exitCode = 1; });
