#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync:run}=require('node:child_process');
function selectFlatpakRelease(releases) {
  for(const release of releases) {
    if(release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name))continue;
    const version=release.tag_name.slice(1), names=release.assets.map(asset=>asset.name);
    if(!names.some(name=>name.endsWith('.flatpak')))continue;
    const expected=[`airdrop-linux-${version}-x86_64.flatpak`,`airdrop-linux-${version}-aarch64.flatpak`,'FLATPAK-SHA256SUMS'];
    for(const name of expected)if(!names.includes(name))throw new Error(`Incomplete Flatpak release ${release.tag_name}: missing ${name}`);
    return {tag:release.tag_name,expected};
  }
  return null;
}
async function downloadFlatpakAssets(output) {
  const repository=process.env.GH_REPO;
  if(!repository)throw new Error('GH_REPO is required');
  const releases=JSON.parse(run('gh',['api',`repos/${repository}/releases?per_page=100`],{encoding:'utf8',maxBuffer:16*1024*1024}));
  const selected=selectFlatpakRelease(releases);
  if(!selected){console.log('No published Flatpak assets yet; native repositories are independent.');return;}
  await fs.mkdir(output);
  for(const name of selected.expected)run('gh',['release','download',selected.tag,'--pattern',name,'--dir',output],{stdio:'inherit'});
  const records=(await fs.readFile(path.join(output,'FLATPAK-SHA256SUMS'),'utf8')).trim().split('\n');
  if(records.length!==2 || records.some(line=>!selected.expected.slice(0,2).includes(line.slice(66)) || !/^[a-f0-9]{64}  /.test(line)))throw new Error('Unexpected Flatpak checksum records');
  if(new Set(records.map(line=>line.slice(66))).size!==2)throw new Error('Duplicate Flatpak checksum records');
  run('sha256sum',['--strict','-c','FLATPAK-SHA256SUMS'],{cwd:output,stdio:'inherit'});
  console.log(`Verified both Flatpak architectures from ${selected.tag}`);
}
if(require.main===module)downloadFlatpakAssets(process.argv[2]||'flatpak-incoming').catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={selectFlatpakRelease};
