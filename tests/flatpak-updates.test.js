'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {check,install}=require('../desktop/flatpak-updates');
const receipt={app_id:'io.github.fluffydisk.airdrop-linux',arch:'x86_64',branch:'stable',fingerprint:'6513D70958397F60D3787A0CB93F4FC1E97CF3AE',version:'1.5.0',revision:8,source_commit:'a'.repeat(40)};
const read=async()=>JSON.stringify({version:'1.5.0',revision:7});
test('Flatpak check detects same-version new content and rejects malformed/foreign metadata',async()=>{
 assert.equal((await check({read,fetcher:async()=>Response.json(receipt)})).status,'available');
 assert.equal((await check({read,fetcher:async()=>Response.json({...receipt,revision:7})})).status,'current');
 assert.equal((await check({read,fetcher:async()=>Response.json({...receipt,revision:6})})).status,'current');
 for(const extra of [{app_id:'other'},{fingerprint:'bad'},{revision:-1},{source_commit:'main'}])await assert.rejects(check({read,fetcher:async()=>Response.json({...receipt,...extra})}));
 await assert.rejects(check({read,fetcher:async()=>new Response('',{status:503})}),/online/);
});
test('portal installer surfaces real progress and success; failed or incomplete operations never become success',async()=>{
 for(const [output,code,success] of [['progress 40\ndone\n',0,true],['empty\n',0,true],['progress 20\n',1,false],['',0,false]]){
  const events=[];const spawnProcess=(file,args)=>{assert.equal(file,'/app/bin/airdrop-update-portal');assert.deepEqual(args,[]);const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};setImmediate(()=>{c.stdout.write(output);c.emit('close',code);});return c;};
  if(success){await install(s=>events.push(s),{spawnProcess});assert.ok(['updated','current'].includes(events.at(-1).status));}
  else await assert.rejects(install(s=>events.push(s),{spawnProcess}),/could not install/);
 }
});

test('startup and manual checks await the same completed result; failure clears the pending request',async()=>{
 const {singleFlight}=require('../desktop/flatpak-updates');let finish,calls=0;
 const run=singleFlight(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const first=run(),second=run();assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);
 finish({status:'available'});assert.deepEqual(await first,{status:'available'});assert.deepEqual(await second,{status:'available'});
 const next=run();await Promise.resolve();assert.equal(calls,2);finish({status:'current'});assert.deepEqual(await next,{status:'current'});
 let failures=0;const failed=singleFlight(async()=>{failures++;throw Error('Offline');});await assert.rejects(failed(),/Offline/);await assert.rejects(failed(),/Offline/);assert.equal(failures,2);
});
