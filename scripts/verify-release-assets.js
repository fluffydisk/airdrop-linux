'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function verifyReleaseAssets(directory) {
const dir = path.resolve(directory);
const entries = fs.readFileSync(path.join(dir,'SHA256SUMS'),'utf8').trim().split('\n').map(line=>{
  const match=/^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
  if(!match)throw new Error('Unsafe checksum record');return [match[2],match[1]];
});
const hashes=new Map(entries);
if(hashes.size!==entries.length)throw new Error('Duplicate checksum records');
 for(const name of fs.readdirSync(dir).filter(name=>name!=='SHA256SUMS')) {
  if(!fs.statSync(path.join(dir,name)).isFile())throw new Error('Unexpected directory in asset download');
  if(!hashes.has(name))throw new Error('Asset has no checksum: '+name);
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(path.join(dir,name)))hash.update(chunk);
  if(hash.digest('hex')!==hashes.get(name))throw new Error('Checksum mismatch: '+name);
 }
}
if(require.main===module)verifyReleaseAssets(process.argv[2]).then(()=>console.log('Downloaded release assets verified')).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verifyReleaseAssets};
