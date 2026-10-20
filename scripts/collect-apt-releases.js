#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const output = path.resolve(process.argv[2] || '.test-artifacts/apt-input');
const releases = JSON.parse(execFileSync('gh', ['api', 'repos/fluffydisk/airdrop-linux/releases?per_page=100'], { encoding: 'utf8' })).filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name) && ['amd64', 'arm64'].every(arch => r.assets.some(a => a.name === `airdrop-linux_${r.tag_name.slice(1)}_${arch}.deb`))).slice(0, 2);
if (!releases.length) throw new Error('No stable release with complete DEB packages');
for (const release of releases) {
  const dir = path.join(output, release.tag_name.slice(1)); fs.mkdirSync(dir, { recursive: true });
  execFileSync('gh', ['release', 'download', release.tag_name, '--pattern', '*.deb', '--pattern', 'airdrop-update.json', '--dir', dir], { stdio: 'inherit' });
}
