'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const run=require('node:util').promisify(require('node:child_process').execFile);
const {downloadRepositoryAssets,requiredPackages}=require('../scripts/download-repository-assets');
const {verifyReleaseAssets}=require('../scripts/verify-release-assets');

async function fixture(t,{omit=[],corrupt=false,failView=false}={}) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-repository-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const tag='v1.5.0', names=requiredPackages(tag);
 const content=new Map(names.map(name=>[name,Buffer.from('package bytes '+name)]));
 content.set('SHA256SUMS',Buffer.from(names.map(name=>crypto.createHash('sha256').update(content.get(name)).digest('hex')+'  '+name).join('\n')+'\n'));
 const calls=[];
 async function command(args) {
  calls.push(args);
  if(args[1]==='list')return JSON.stringify([{tagName:'v1.4.1'}]); // Target deliberately absent from history.
  if(args[1]==='view'){
   if(failView)throw new Error('GitHub API unavailable');
   return JSON.stringify({tagName:args[2],isDraft:false,isPrerelease:false,assets:args[2]===tag?[...content.keys()].filter(name=>!omit.includes(name)).map(name=>({name})):[]});
  }
  if(args[1]==='download'){
   const name=args[args.indexOf('--pattern')+1],out=args[args.indexOf('--dir')+1];
   await fs.writeFile(path.join(out,name),corrupt&&name===names[0]?'corrupted bytes':content.get(name));
   return '';
  }
  throw new Error('Unexpected gh invocation');
 }
 return {directory,tag,names,calls,command,incoming:path.join(directory,'incoming'),downloads:path.join(directory,'downloads')};
}
test('legacy inverted ripgrep check hides missing executable as a successful skip',async t=>{
 const {directory}=await fixture(t);const assets=path.join(directory,'asset-names');
 await fs.writeFile(assets,'airdrop-linux_1.5.0-1_amd64.deb\n');
 const result=await run('/bin/bash',['-c','if ! rg -q "\\.deb$" "$1"; then echo skipped; fi','bash',assets],{env:{PATH:path.join(directory,'no-tools')}});
 assert.equal(result.stdout.trim(),'skipped');assert.match(result.stderr,/rg: command not found/);
});
test('downloads requested release even when history omits it and stages both formats and architectures',async t=>{
 const f=await fixture(t);const inventory=await downloadRepositoryAssets(f.tag,f.incoming,f.downloads,{command:f.command,log:()=>{}});
 assert.deepEqual(inventory.map(item=>item.tag),[f.tag]);
 assert.deepEqual((await fs.readdir(f.incoming)).sort(),[...f.names,'SHA256SUMS'].sort());
 await verifyReleaseAssets(f.incoming);
 assert.equal(f.calls.filter(args=>args[1]==='download').length,5);
});
for(const missing of ['airdrop-linux-1.5.0-1.x86_64.rpm','airdrop-linux_1.5.0-1_arm64.deb','SHA256SUMS']) {
 test('rejects incomplete release before download: '+missing,async t=>{
  const f=await fixture(t,{omit:[missing]});
  await assert.rejects(downloadRepositoryAssets(f.tag,f.incoming,f.downloads,{command:f.command,log:()=>{}}),error=>error.message.includes(missing));
  assert.equal(f.calls.some(args=>args[1]==='download'),false);
  assert.deepEqual(await fs.readdir(f.incoming),[]);
 });
}
test('does not turn a release API error into a skipped release',async t=>{
 const f=await fixture(t,{failView:true});
 await assert.rejects(downloadRepositoryAssets(f.tag,f.incoming,f.downloads,{command:f.command}),/GitHub API unavailable/);
 assert.deepEqual(await fs.readdir(f.incoming),[]);
});
test('does not stage packages with a mismatched checksum',async t=>{
 const f=await fixture(t,{corrupt:true});
 await assert.rejects(downloadRepositoryAssets(f.tag,f.incoming,f.downloads,{command:f.command}),/Checksum mismatch/);
 assert.deepEqual(await fs.readdir(f.incoming),[]);
});
test('empty package directory fails before creating repository output or invoking signing tools',async t=>{
 const f=await fixture(t);await fs.mkdir(f.incoming);const output=path.join(f.directory,'public');
 await assert.rejects(run('bash',[path.resolve(__dirname,'../scripts/build-repository.sh'),f.incoming,output],{env:{...process.env,SIGNING_KEY_FINGERPRINT:'A'.repeat(40)}}),error=>error.stderr.includes('Both DEB and RPM assets are required')&&error.stdout.includes('DEB=0 RPM=0'));
 await assert.rejects(fs.access(output),{code:'ENOENT'});
});
