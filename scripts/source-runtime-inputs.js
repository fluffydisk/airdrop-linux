'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const lockPath=path.join(__dirname,'../packaging/source-runtimes.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

async function verifySourceRuntimes(directory, arch=process.arch) {
 const lockBytes=await fs.readFile(lockPath),lock=JSON.parse(lockBytes);
 const machine={x64:'x86_64',arm64:'aarch64'}[arch];
 const elfMachine={x64:62,arm64:183}[arch];
 if(!machine)throw new Error('Unsupported source-runtime architecture');
 const result={};
 for(const component of ['node','dufs','electron']) {
  const root=path.join(directory,component);
  const binary=path.join(root,component==='electron'?'electron':'bin/'+component);
  const record=JSON.parse(await fs.readFile(path.join(root,'provenance.json'),'utf8'));
  const bytes=await fs.readFile(binary);
  if(record.component!==component || record.version!==lock[component].version || record.lockSha256!==hash(lockBytes))throw new Error('Source runtime lock/version mismatch: '+component);
  if(JSON.stringify(record.networkInterfacesDuringBuild)!=='["lo"]')throw new Error('Missing isolated source-build record: '+component);
  if(record.binarySha256!==hash(bytes))throw new Error('Source runtime binary checksum mismatch: '+component);
  if(bytes.length<20 || !bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])) || bytes[4]!==2 || bytes[5]!==1 || bytes.readUInt16LE(18)!==elfMachine)throw new Error('Source runtime ELF architecture mismatch: '+component);
  if(component==='electron') {
   if(record.revision!==lock.electron.revision || record.sourceGraphSha256!==hash(await fs.readFile(path.join(root,'source-graph.txt'))))throw new Error('Electron source graph mismatch');
  } else if(record.architecture!==machine || record.sourceSha256!==lock[component].sha256)throw new Error('Source runtime origin mismatch: '+component);
  result[component]={root,binary,record};
 }
 return result;
}

async function verifyOfflineCache(directory) {
 for(const [component,relative] of [['server','..'],['desktop','../desktop'],['tools','../packaging/source-tools']]) {
  const expected=await fs.readFile(path.join(__dirname,relative,'package-lock.json'));
  const actual=await fs.readFile(path.join(directory,component,'package-lock.json'));
  if(hash(expected)!==hash(actual))throw new Error('Offline npm cache lock mismatch: '+component);
 }
 await fs.access(path.join(directory,'npm-cache'));
}
module.exports={verifySourceRuntimes,verifyOfflineCache};
