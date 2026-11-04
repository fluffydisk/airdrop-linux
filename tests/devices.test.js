'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Devices}=require('../lib/devices');
async function fixture(t, saved, options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-lifecycle-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 if(saved)await fs.writeFile(path.join(directory,'devices.json'),JSON.stringify(saved));
 const clients=[];
 const d=new Devices({directory,probe:async()=>{},createClient:options=>{const client={options,starts:0,stops:0,start(){this.starts++;},stop(){this.stops++;}};clients.push(client);return client;},...options});
 t.after(()=>d.stop());await d.initialize();await d.queue;
 return {d,clients,directory};
}
const configured={configured:true,mode:'private',relayUrl:'https://relay.example.com',accessKey:'secret-access-key'};
test('first open starts setup; configured opens reconnect with background off and keep identity private',async t=>{
 const fresh=await fixture(t);assert.equal(fresh.d.state.status,'setup-required');assert.equal((await fresh.d.snapshot()).preferences.background,false);
 const f=await fixture(t,configured);assert.equal(f.clients.length,1);assert.equal(f.clients[0].starts,1);
 await f.d.receive({status:'checking',origin:'https://workspace.relay.example.com'},f.d.generation);
 assert.equal(f.d.state.status,'ready');await f.d.queue;
 const snapshot=JSON.stringify(await f.d.snapshot());assert.ok(!snapshot.includes('secret-access-key'));assert.ok(!snapshot.includes(f.d.preferences.deviceKey));
 const saved=JSON.parse(await fs.readFile(path.join(f.directory,'devices.json')));assert.equal(saved.onboarded,true);assert.equal((await fs.stat(path.join(f.directory,'devices.json'))).mode&0o777,0o600);
 const key=f.d.preferences.deviceKey;await f.d.stop();const restart=new Devices({directory:f.directory,createClient:opts=>({start(){},stop(){}})});t.after(()=>restart.stop());await restart.initialize();await restart.queue;
 assert.equal(restart.preferences.deviceKey,key);assert.equal(restart.state.mode,'private');
});
test('auto-connect disabled does not open a tunnel; manual connect works and duplicate connect is idempotent',async t=>{
 const {d,clients}=await fixture(t,{...configured,autoConnect:false});assert.equal(clients.length,0);assert.equal(d.state.status,'local');
 await d.action('private');await d.action('private');assert.equal(clients.length,1);
 await d.configure({background:true});assert.equal(d.preferences.background,true);await d.configure({background:false});assert.equal(d.preferences.background,false);
 await d.action('local');assert.equal(clients[0].stops,1);assert.equal(d.state.url,'');assert.equal(d.preferences.mode,'local');
});
test('old Tailscale preferences migrate without starting a helper or exposing the old address',async t=>{
 const {d,clients}=await fixture(t,{mode:'tailscale',configured:true,onboarded:true});assert.equal(clients.length,0);assert.equal(d.state.mode,'private');assert.equal(d.state.status,'setup-required');assert.equal(d.state.url,'');
});
test('connection loss invalidates a pending health check and stale events cannot restore a link',async t=>{
 let release;const {d,clients}=await fixture(t,configured,{probe:()=>new Promise(r=>{release=r;})});
 const generation=d.generation,ready=d.receive({status:'checking',origin:'https://workspace.relay.example.com'},generation);
 await new Promise(r=>setImmediate(r));await d.receive({status:'reconnecting',message:'Retrying'},generation);release();await ready;
 assert.equal(d.state.status,'reconnecting');assert.equal(d.state.url,'');
 await d.action('local');await d.receive({status:'checking',origin:'https://workspace.relay.example.com'},generation);assert.equal(d.state.mode,'local');
 assert.equal(clients[0].stops,1);
});
test('invalid settings are rejected and changing relay credentials replaces the active tunnel',async t=>{
 const {d,clients}=await fixture(t,configured);
 await assert.rejects(d.configure({relayUrl:'http://insecure.example.com'}));await assert.rejects(d.configure({accessKey:'bad\r\nheader'}));
 await d.configure({relayUrl:'https://new-relay.example.com',accessKey:'new-key'});assert.equal(clients.length,2);assert.equal(clients[0].stops,1);assert.equal(clients[1].options.accessKey,'new-key');
 await d.configure({accessKey:''});assert.equal(d.preferences.accessKey,'new-key');
});
test('a managed service enrolls automatically and never needs an end-user access key',async t=>{
 const calls=[];const {d,clients}=await fixture(t,undefined,{service:{relayUrl:'https://service.example.com'},enroll:async options=>{calls.push(options);return 'device.'+'a'.repeat(64);}});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://service.example.com');assert.equal(d.preferences.credentialType,'enrolled');assert.equal(clients.length,1);
 const state=await d.snapshot();assert.equal(state.serviceAvailable,true);assert.equal(state.preferences.accessKey,undefined);assert.equal(state.setupComplete,false);
 await assert.rejects(d.completeSetup(),/Reconnect/);
 await d.receive({status:'checking',origin:'https://workspace.service.example.com'},d.generation);await d.queue;
 await d.configure({background:false});await d.completeSetup();assert.equal((await d.snapshot()).setupComplete,true);assert.equal(d.preferences.backgroundChosen,true);
});
test('free internet mode needs no relay key and only advertises after a verified endpoint',async t=>{
 let internet;
 const {d,clients}=await fixture(t,undefined,{createInternetClient:options=>{internet={options,start(){options.onState({status:'downloading',message:'Preparing component…'});},stop(){this.stopped=true;}};return internet;}});
 await d.action('internet');assert.equal(clients.length,0);assert.equal(d.preferences.accessKey,'');assert.equal(d.state.status,'downloading');assert.equal(d.state.url,'');assert.match(internet.options.proxyHost,/^airdrop-/);
 await internet.options.onState({status:'checking',origin:'https://controlled.trycloudflare.com'});
 for(let i=0;i<100&&d.state.status!=='ready';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(d.state.status,'ready');assert.match(d.state.url,/^https:\/\/controlled.trycloudflare.com/);
 await d.action('local');assert.equal(internet.stopped,true);assert.equal(d.state.qr,'');
});
