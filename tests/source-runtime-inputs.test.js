'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {verifySourceRuntimes,verifyOfflineCache}=require('../scripts/source-runtime-inputs');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');

async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-source-inputs-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const lockBytes=await fs.readFile(path.join(__dirname,'../packaging/source-runtimes.json'));
 const lock=JSON.parse(lockBytes);
 for(const component of ['node','dufs','electron']) {
  const folder=path.join(root,component);
  const binary=path.join(folder,component==='electron'?'electron':'bin/'+component);
  await fs.mkdir(path.dirname(binary),{recursive:true});
  // Only a validator fixture, never executed or accepted as a working runtime.
  const bytes=Buffer.alloc(64);bytes.set([127,69,76,70,2,1]);bytes.writeUInt16LE(62,18);
  await fs.writeFile(binary,bytes);
  const graph=Buffer.from('pinned source graph');
  await fs.writeFile(path.join(folder,'source-graph.txt'),graph);
  await fs.writeFile(path.join(folder,'provenance.json'),JSON.stringify({
   component,version:lock[component].version,lockSha256:hash(lockBytes),
   architecture:'x86_64',networkInterfacesDuringBuild:['lo'],binarySha256:hash(bytes),
   sourceSha256:lock[component].sha256,revision:lock[component].revision,sourceGraphSha256:hash(graph)
  }));
 }
 return root;
}
test('source assembly rejects modified binaries, foreign architectures and unisolated build records',async t=>{
 const root=await fixture(t);
 await verifySourceRuntimes(root,'x64');
 await assert.rejects(verifySourceRuntimes(root,'arm64'),/architecture mismatch/);
 const recordFile=path.join(root,'dufs/provenance.json');
 const record=JSON.parse(await fs.readFile(recordFile,'utf8'));
 await fs.writeFile(recordFile,JSON.stringify({...record,networkInterfacesDuringBuild:['lo','eth0']}));
 await assert.rejects(verifySourceRuntimes(root,'x64'),/isolated source-build/);
 await fs.writeFile(recordFile,JSON.stringify(record));
 await fs.appendFile(path.join(root,'node/bin/node'),'modified');
 await assert.rejects(verifySourceRuntimes(root,'x64'),/binary checksum mismatch/);
});
test('source assembly rejects stale npm lockfiles before any offline npm install',async t=>{
 const root=await fixture(t);
 const cache=path.join(root,'offline');await fs.mkdir(path.join(cache,'server'),{recursive:true});
 await fs.writeFile(path.join(cache,'server/package-lock.json'),'stale');
 await assert.rejects(verifyOfflineCache(cache),/Offline npm cache lock mismatch/);
});
