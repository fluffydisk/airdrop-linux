#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const run = require('node:util').promisify(execFile);
const {verifyReleaseAssets} = require('./verify-release-assets');

const stable = /^v\d+\.\d+\.\d+$/;
function requiredPackages(tag) {
  if (!stable.test(tag)) throw new Error('Expected a stable release tag such as v1.5.0');
  const version = tag.slice(1);
  return [`airdrop-linux_${version}-1_amd64.deb`, `airdrop-linux_${version}-1_arm64.deb`,
    `airdrop-linux-${version}-1.x86_64.rpm`, `airdrop-linux-${version}-1.aarch64.rpm`];
}
async function gh(args) {
  try { return (await run('gh', args, {maxBuffer: 8 * 1024 * 1024})).stdout; }
  catch (error) {
    const detail=(error.stderr || error.message).replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g,'$1?[query omitted]');
    throw new Error(`gh ${args[0]} ${args[1]} failed: ${detail}`);
  }
}
async function downloadRepositoryAssets(tag, incoming, downloads, {command = gh, log = console.log} = {}) {
  requiredPackages(tag);
  incoming = path.resolve(incoming); downloads = path.resolve(downloads);
  // Fresh staging prevents stale files from concealing a failed download.
  await fs.mkdir(incoming); await fs.mkdir(downloads);
  const history = JSON.parse(await command(['release','list','--exclude-drafts','--exclude-pre-releases','--limit','100','--json','tagName']));
  if (!Array.isArray(history)) throw new Error('Invalid stable release history');
  // Always inspect the requested release, even if the release-list API omits it.
  const tags = [...new Set([tag, ...history.map(release => release.tagName)])];
  const inventory = [];
  const checksums = [];
  for (const current of tags) {
    requiredPackages(current);
    const release = JSON.parse(await command(['release','view',current,'--json','tagName,isDraft,isPrerelease,assets']));
    if (release.tagName !== current || release.isDraft !== false || release.isPrerelease !== false || !Array.isArray(release.assets)) {
      throw new Error(`Release ${current} is not a published stable release`);
    }
    const names = release.assets.map(asset => asset.name);
    const native = names.filter(name => typeof name === 'string' && /\.(deb|rpm)$/.test(name));
    if (!native.length && current !== tag) { log(`Skipping ${current}: predates native packages`); continue; }
    const expected = [...requiredPackages(current), 'SHA256SUMS'];
    for (const name of expected) if (!names.includes(name)) throw new Error(`${current}: missing required release asset ${name}`);
    const directory = path.join(downloads, current); await fs.mkdir(directory);
    for (const name of expected) {
      await command(['release','download',current,'--pattern',name,'--dir',directory]);
      const stat = await fs.lstat(path.join(directory,name));
      if (!stat.isFile() || !stat.size) throw new Error(`${current}: download missing or empty: ${name}`);
    }
    await verifyReleaseAssets(directory);
    const records = new Map((await fs.readFile(path.join(directory,'SHA256SUMS'),'utf8')).trim().split('\n').map(line=>[line.slice(66),line.slice(0,64)]));
    for (const name of requiredPackages(current)) {
      await fs.copyFile(path.join(directory,name),path.join(incoming,name));
      checksums.push(`${records.get(name)}  ${name}`);
      log(`${current}: verified ${name} -> ${path.join(incoming,name)}`);
    }
    inventory.push({tag: current, packages: requiredPackages(current)});
  }
  const actual = await fs.readdir(incoming);
  for (const name of requiredPackages(tag)) if (!actual.includes(name)) throw new Error(`Staging lost required package ${name}`);
  await fs.writeFile(path.join(incoming,'SHA256SUMS'),checksums.join('\n')+'\n');
  await verifyReleaseAssets(incoming);
  log(`Repository staging complete: ${actual.length} packages; requested release ${tag}`);
  return inventory;
}
if(require.main===module)downloadRepositoryAssets(process.argv[2],process.argv[3]||'incoming',process.argv[4]||'downloads').catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={downloadRepositoryAssets,requiredPackages};
