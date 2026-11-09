'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {InternetConnection}=require('../lib/internet-connection');
const {Devices}=require('../lib/devices');
const {ShareGateway}=require('../lib/device-share');
const {HealthError}=require('../lib/connection-health');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('condition did not become true');}
async function tunnel(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-recovery-')),bytes=Buffer.from('fake helper');
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));const children=[],states=[];
 const c=new InternetConnection({directory,asset:{url:'https://github.com/cloudflare/cloudflared/releases/download/test/fake',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},target:'http://127.0.0.1:1234',proxyHost:'fixed.internal',request:async()=>new Response(bytes),retryDelay:1,random:()=>0.5,onState:s=>states.push(s),spawnProcess:()=>{
  assert.ok(children.every(c=>c.exitCode!==null),'previous child must exit before the next spawn');
  const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.exitCode=null;p.signalCode=null;p.kill=()=>{p.exitCode=0;p.emit('exit');};p.log=message=>p.stderr.write(JSON.stringify(message)+'\n');children.push(p);return p;
 },...options});t.after(()=>c.stop());c.start();await until(()=>children.length===1);return {c,children,states};
}
function register(p,name='first'){p.log({message:`https://${name}.trycloudflare.com`});p.log({message:'Registered tunnel connection',connIndex:0});}
test('unexpected exit invalidates before retry and only a new registered hostname can be checked',async t=>{
 const {c,children,states}=await tunnel(t);register(children[0]);assert.equal(states.at(-1).status,'checking');
 children[0].kill();assert.equal(states.at(-1).status,'reconnecting');assert.equal(states.at(-1).origin,undefined);
 await until(()=>children.length===2);children[0].log({message:'Registered tunnel connection'});assert.notEqual(states.at(-1).origin,'https://first.trycloudflare.com');
 children[1].log({message:'https://second.trycloudflare.com'});assert.equal(states.at(-1).status,'connecting');children[1].log({message:'Registered tunnel connection'});assert.equal(states.at(-1).origin,'https://second.trycloudflare.com');
 assert.equal(states.at(-1).session,2);const count=states.length;children[0].emit('error',Error('delayed old-child error'));assert.equal(states.length,count,'late child errors cannot interrupt a new tunnel');await c.stop();
});
test('loss of the last edge connection replaces the tunnel; rapid reconnects cannot create competing children',async t=>{
 const {c,children}=await tunnel(t);register(children[0]);children[0].log({message:'Registered tunnel connection',connIndex:1});children[0].log({message:'Unregistered tunnel connection',connIndex:0});assert.equal(children[0].exitCode,null);
 children[0].log({message:'Connection terminated',connIndex:1});for(let i=0;i<20;i++)c.reconnect();await until(()=>children.length===2);assert.equal(children.length,2);await c.stop();
});
test('retry exhaustion is bounded and stop during backoff cancels every future spawn',async t=>{
 const {children,states}=await tunnel(t,{maxRestarts:2});children[0].kill();await until(()=>children.length===2);children[1].kill();await until(()=>children.length===3);children[2].kill();await until(()=>states.at(-1).status==='error');assert.equal(children.length,3);
 const other=await tunnel(t,{retryDelay:1000});other.children[0].kill();await other.c.stop();assert.equal(other.children.length,1);
});
test('startup timeout never advertises an unregistered hostname and is recoverable',async t=>{
 const {children,states}=await tunnel(t,{startupTimeout:20,maxRestarts:0});children[0].log({message:'https://never-registered.trycloudflare.com'});await until(()=>states.at(-1).status==='error');assert.ok(!states.some(s=>s.origin));
});
test('a real controlled HTTP 530 page identifies Cloudflare 1033 without logging response contents',async t=>{
 const server=http.createServer((req,res)=>{res.writeHead(530);res.end('<h1>Error 1033</h1><p>private data</p>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const g=new ShareGateway({secure:true});g.setOrigin('https://controlled.trycloudflare.com');
 await assert.rejects(g.probe({request:()=>fetch('http://127.0.0.1:'+server.address().port)}),e=>e.code==='TUNNEL'&&e.httpStatus===530&&!e.message.includes('private data'));
});
async function devices(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-devices-recovery-'));let reconnects=0;
 const d=new Devices({directory,probeLocal:async()=>{},probe:async()=>{},monitorInterval:100000,createInternetClient:()=>({start(){},stop(){},reconnect(){reconnects++;}}),...options});
 t.after(async()=>{await d.stop();await d.queue;await fs.rm(directory,{recursive:true,force:true});});await d.initialize();await d.action('internet');return {d,reconnects:()=>reconnects};
}
test('1033 revokes ready QR, guest session and phone credentials, then re-verifies a fresh QR',async t=>{
 const {d,reconnects}=await devices(t);await d.receive({status:'checking',origin:'https://first.trycloudflare.com',session:1},d.generation);const old={...d.state},token=d.gateway.token,epoch=d.gateway.epoch||0;
 d.pairedAt=123;d.probe=async()=>{throw new HealthError('TUNNEL','public',530);};await d.monitorInternet();assert.equal(d.pairedAt,0);assert.equal(reconnects(),1);assert.equal(d.state.status,'reconnecting');assert.equal(d.state.qr,'');assert.equal(d.gateway.origin,null);assert.notEqual(d.gateway.token,token);assert.equal(d.verifiedBy,null);
 await d.phoneVerified(d.generation,epoch);assert.equal(d.state.url,'');
 d.probe=async()=>{};await d.receive({status:'checking',origin:'https://second.trycloudflare.com',session:2},d.generation);assert.equal(d.state.status,'ready');assert.notEqual(d.state.qr,old.qr);assert.notEqual(d.state.url,old.url);
 await d.receive({status:'checking',origin:'https://first.trycloudflare.com',session:1},d.generation);assert.equal(d.state.url.includes('second.trycloudflare.com'),true);
});
test('failed startup verification never creates a ready QR; transient 502/503 recover within bounded checks',async t=>{
 let calls=0;const {d}=await devices(t,{verificationDelay:0,verificationAttempts:4,probe:async()=>{if(++calls<3)throw new HealthError('HTTP','public',calls===1?502:503);}});
 const checking=d.receive({status:'checking',origin:'https://delayed.trycloudflare.com'},d.generation);assert.equal(d.state.qr,'');await checking;assert.equal(calls,3);assert.equal(d.state.status,'ready');
});
test('initial HTTP 1033 replaces the hostname instead of repeatedly checking an expired tunnel',async t=>{
 const {d,reconnects}=await devices(t,{verificationAttempts:1,probe:g=>g.probe({request:async()=>new Response('<h1>Error 1033</h1>',{status:530})})});
 await d.receive({status:'checking',origin:'https://expired.trycloudflare.com'},d.generation);assert.equal(d.state.status,'reconnecting');assert.equal(reconnects(),1);assert.equal(d.state.qr,'');assert.equal(d.gateway.origin,null);
});
test('beginning phone re-verification hides an old ready QR before any asynchronous check',async t=>{
 const {d}=await devices(t);await d.receive({status:'checking',origin:'https://phone.trycloudflare.com'},d.generation);let release;d.probeLocal=()=>new Promise(r=>{release=r;});
 const pending=d.beginPhoneVerification(d.generation);assert.equal(d.state.url,'');assert.equal(d.state.qr,'');assert.equal(d.state.status,'checking');release();await pending;assert.equal(d.state.status,'phone-verification');
});
test('interrupted automatic phone preparation cannot stop a replacement tunnel',async t=>{
 let calls=0,release;
 const {d}=await devices(t,{verificationAttempts:4,verificationDelay:0,probeLocal:async()=>{if(++calls===4)await new Promise(r=>{release=r;});},probe:async()=>{throw Object.assign(Error('DNS'),{code:'ENOTFOUND'});}});
 const generation=d.generation;
 const pending=d.receive({status:'checking',origin:'https://old.trycloudflare.com'},generation).catch(error=>{if(generation===d.generation)d.fail(error);});
 await until(()=>release);await d.receive({status:'reconnecting',message:'Replacing interrupted tunnel'},generation);release();await pending;
 assert.equal(d.generation,generation,'obsolete phone work must not call fail()/stop()');assert.equal(d.state.status,'reconnecting');assert.ok(d.client);assert.equal(d.state.qr,'');
});
test('guest QR preparation cannot return a retired tunnel capability after recovery',async t=>{
 const {d}=await devices(t);await d.receive({status:'checking',origin:'https://first.trycloudflare.com'},d.generation);let release;
 d.gateway.guest.start=()=>new Promise(r=>{release=r;});
 const pending=d.startGuest();await until(()=>release);
 await d.receive({status:'reconnecting'},d.generation);await d.receive({status:'checking',origin:'https://replacement.trycloudflare.com'},d.generation);
 release({token:'retired-guest-capability',expires:Date.now()+1000,files:[]});await assert.rejects(pending,/Connection changed/);assert.equal(d.state.status,'ready');assert.ok(d.state.url.includes('replacement.trycloudflare.com'));
});
test('late failed monitor cannot overwrite a replacement tunnel or a provider switch',async t=>{
 const {d}=await devices(t);await d.receive({status:'checking',origin:'https://first.trycloudflare.com'},d.generation);let reject;
 d.probe=()=>new Promise((_,r)=>{reject=r;});const pending=d.monitorInternet();await until(()=>reject);await d.action('local');reject(new HealthError('TUNNEL','public',530));await pending;assert.equal(d.state.status,'local');assert.equal(d.state.url,'');
});
test('phone verification is a renewable lease, cannot conceal 1033, and expires without phone heartbeats',async t=>{
 let now=1000;const {d,reconnects}=await devices(t,{now:()=>now,phoneLease:50,verificationAttempts:4,verificationDelay:0});await d.receive({status:'checking',origin:'https://phone.trycloudflare.com'},d.generation);
 d.probe=async()=>{throw Object.assign(Error('private'),{code:'ENOTFOUND'});};await d.beginPhoneVerification(d.generation);await d.phoneVerified(d.generation);assert.equal(d.state.status,'ready');now+=25;await d.monitorInternet();assert.equal(d.state.status,'ready');now+=30;await d.monitorInternet();assert.equal(d.state.status,'phone-verification');assert.equal(d.state.qr,'');
 await d.phoneVerified(d.generation);d.probe=async()=>{throw new HealthError('TUNNEL','public',530);};await d.monitorInternet();assert.equal(d.state.status,'reconnecting');assert.equal(reconnects(),1);
});
test('a stale phone callback cannot verify a replacement tunnel while fresh phone health can',async t=>{
 const {d}=await devices(t,{verificationAttempts:4,verificationDelay:0});await d.receive({status:'checking',origin:'https://first.trycloudflare.com',session:1},d.generation);const epoch=d.gateway.epoch||0;
 await d.receive({status:'reconnecting'},d.generation);d.probe=async()=>{throw Object.assign(Error('DNS'),{code:'ENOTFOUND'});};
 await d.receive({status:'checking',origin:'https://replacement.trycloudflare.com',session:2},d.generation);assert.equal(d.state.status,'phone-verification');
 await d.phoneVerified(d.generation,epoch);assert.equal(d.state.status,'phone-verification');assert.equal(d.state.qr,'');
 await d.phoneVerified(d.generation,d.gateway.epoch);assert.equal(d.state.status,'ready');assert.ok(d.state.url.includes('replacement.trycloudflare.com'));
});
test('stop during component preparation and repeated start calls cannot leave a tunnel running',async t=>{
 let release;const f=await tunnel(t);await f.c.stop();
 f.c.request=()=>new Promise(r=>{release=r;});await fs.rm(f.c.directory,{recursive:true,force:true});
 const starting=f.c.start();await until(()=>release);const stopping=f.c.stop();release(new Response(Buffer.from('fake helper')));await Promise.all([starting,stopping]);assert.equal(f.children.length,1);
});
