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
    const reference=`airdrop-linux-${version}-x86_64-reference-r2.flatpak`;
    if(names.includes(reference)) {
      if(!names.includes(reference+'.sha256'))throw new Error(`Incomplete Flatpak release ${release.tag_name}: missing reference checksum`);
      return {tag:release.tag_name,expected:[reference,reference+'.sha256'],reference:true};
    }
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
  if(selected.reference)await fs.copyFile(path.join(output,selected.expected[1]),path.join(output,'FLATPAK-SHA256SUMS'));
  const bundleNames=selected.expected.filter(name=>name.endsWith('.flatpak'));
  const records=(await fs.readFile(path.join(output,'FLATPAK-SHA256SUMS'),'utf8')).trim().split('\n');
  if(records.length!==bundleNames.length || records.some(line=>!bundleNames.includes(line.slice(66)) || !/^[a-f0-9]{64}  /.test(line)))throw new Error('Unexpected Flatpak checksum records');
  if(new Set(records.map(line=>line.slice(66))).size!==bundleNames.length)throw new Error('Duplicate Flatpak checksum records');
  run('sha256sum',['--strict','-c','FLATPAK-SHA256SUMS'],{cwd:output,stdio:'inherit'});
  await fs.writeFile(path.join(output,'tag.txt'),selected.tag+'\n');
  console.log(`Verified ${bundleNames.length} Flatpak architecture(s) from ${selected.tag}`);
}
if(require.main===module)downloadFlatpakAssets(process.argv[2]||'flatpak-incoming').catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={selectFlatpakRelease};
