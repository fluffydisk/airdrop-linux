'use strict';
// Real old/new release bytes in an isolated installation. Service management
// callbacks are controlled: never stop host services or claim a physical device.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),run=require('node:util').promisify(execFile);
const assert=require('node:assert/strict');const updater=require('../lib/updater');
const version=require('../package.json').version,tag='v'+version,repo='fluffydisk/airdrop-linux';
async function main(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-real-release-update-'));
 try{
  const draft=process.argv.includes('--draft');let fetcher=fetch;
  if(draft){
   const releases=JSON.parse((await run('gh',['api',`repos/${repo}/releases?per_page=100`])).stdout);
   const release=releases.find(r=>r.tag_name===tag);assert.ok(release,'Expected release draft');
   assert.equal(release.draft,true);
   const directory=path.join(root,'download');await fs.mkdir(directory);
   await run('gh',['release','download',tag,'--repo',repo,'--dir',directory]);
   fetcher=async url=>{
    if(url.endsWith('/releases/latest'))return Response.json({...release,draft:false,assets:release.assets.map(a=>({...a,browser_download_url:`https://github.com/${repo}/releases/download/${tag}/${a.name}`}))});
    const prefix=`https://github.com/${repo}/releases/download/${tag}/`;
    assert.ok(url.startsWith(prefix));return new Response(await fs.readFile(path.join(directory,url.slice(prefix.length))));
   };
  }
  for(const arch of ['x64','arm64']){
   const result=await updater.check('1.5.0',{fetcher,arch});assert.equal(result.status,'available');assert.equal(result.version,version);
   if(arch!==process.arch){const response=await fetcher(result.package.url);const b=Buffer.from(await response.arrayBuffer());assert.equal(b.length,result.package.size);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),result.package.sha256);}
  }
  const previousBase=`https://github.com/${repo}/releases/download/v1.5.0/`;
  const previous=await (await fetch(previousBase+'airdrop-update.json')).json();
  const item=previous.packages[process.arch];const b=Buffer.from(await (await fetch(previousBase+item.name)).arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(b).digest('hex'),item.sha256);
  const zip=path.join(root,'old.zip');await fs.writeFile(zip,b);await run('unzip',['-q',zip,'-d',root]);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'app/server/package.json'))).version,'1.5.0');
  const retained=['files/retain.txt','config/retain.env','state/desktop/connections/credential-retention-fixture'];
  for(const name of retained){const p=path.join(root,name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'retention fixture '+name);}
  await fs.writeFile(path.join(root,'state/runtime.json'),JSON.stringify({node:process.execPath}));
  const result=await updater.check('1.5.0',{fetcher});const prepared=await updater.prepare(root,result,{fetcher});const actions=[];
  await updater.activate(root,prepared,{relaunch:false,control:async action=>actions.push(action),health:async()=>{
   const {createServer}=require(path.join(root,'app/server/push-server.js'));
   const service=createServer({watchDir:path.join(root,'files'),stateDir:path.join(root,'state/backend-test'),watch:false});
   const server=service.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
   try{
    const base='http://127.0.0.1:'+server.address().port;
    assert.equal((await fetch(base+'/files/new-upload.txt',{method:'PUT',body:'new version transfer'})).status,201);
    assert.equal(await (await fetch(base+'/explorer/download?path=new-upload.txt')).text(),'new version transfer');
    const response=await fetch(base+'/explorer/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:['new-upload.txt','retain.txt']})});
    const archive=await require('jszip').loadAsync(await response.arrayBuffer());assert.equal(await archive.file('new-upload.txt').async('string'),'new version transfer');
   }finally{service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }});
  assert.deepEqual(actions,['stop','start']);
  for(const name of retained)assert.equal(await fs.readFile(path.join(root,name),'utf8'),'retention fixture '+name);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'app/server/package.json'))).version,version);
  const journal=await updater.readJournal(root);assert.equal(journal.phase,'complete');assert.equal(JSON.parse(await fs.readFile(path.join(journal.backup,'server/package.json'))).version,'1.5.0');
  console.log('VERIFIED: '+(draft?'authenticated draft metadata':'public latest release feed')+' advertises '+version+' to 1.5.0 on both architectures; both actual ZIP checksums verified; actual old ZIP upgraded on '+process.arch+'; new backend upload/download/ZIP passed; data/state fixtures and old-version backup retained. Host service authorization and physical desktop restart are not claimed.');
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
