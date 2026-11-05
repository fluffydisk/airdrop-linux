'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Devices}=require('../lib/devices');
async function fixture(t){
 let healthy=true;
 const backend=http.createServer((req,res)=>{res.writeHead(healthy?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({push:healthy,share:healthy}));});
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-phone-verification-'));
 const d=new Devices({directory,backend:'http://127.0.0.1:'+backend.address().port,verificationAttempts:1,verificationDelay:0,
  probe:async()=>{throw Object.assign(Error('DNS error with a private URL that must never enter diagnostics'),{code:'ENOTFOUND'});},createInternetClient:()=>({start(){},stop(){}})});
 t.after(async()=>{await d.stop();backend.closeAllConnections();await new Promise(r=>backend.close(r));await fs.rm(directory,{recursive:true,force:true});});
 await d.initialize();await d.action('internet');await d.receive({status:'checking',origin:'https://phone-check.trycloudflare.com'},d.generation);
 function request(route,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{
  const r=http.request({hostname:'127.0.0.1',port:d.gateway.server.address().port,path:route,method,headers:{Host:d.gateway.proxyHost,...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});r.on('error',reject);r.end(body);
 });}
 return {d,request,setHealthy:value=>{healthy=value;}};
}
async function ready(d){for(let i=0;i<100&&d.state.status!=='ready';i++)await new Promise(r=>setTimeout(r,5));assert.equal(d.state.status,'ready');}
test('phone verification needs paired authenticated backend health; pairing alone, foreign origins and unavailable services cannot mark ready',async t=>{
 const {d,request,setHealthy}=await fixture(t);
 assert.equal(d.state.status,'error');assert.equal((await d.snapshot()).canVerifyWithPhone,true);assert.equal(d.diagnostics.local.status,'passed');assert.equal(d.diagnostics.public.code,'DNS');
 assert.ok(!JSON.stringify(d.connectionReport()).includes('private URL'));
 const state=await d.verifyWithPhone();assert.equal(state.status,'phone-verification');assert.equal(state.url,'');assert.equal(state.qr,'');assert.ok(state.verificationQr);const url=new URL(state.verificationUrl),token=url.hash.slice(1);
 await assert.rejects(d.completeSetup(),/Reconnect/);
 assert.equal((await request('/push/health')).status,401);assert.equal(d.state.status,'phone-verification');
 assert.equal((await request('/pair/',{method:'POST',body:JSON.stringify({token}),headers:{Origin:'https://foreign.example'}})).status,403);
 const paired=await request('/pair/',{method:'POST',body:JSON.stringify({token}),headers:{Origin:url.origin}});assert.equal(paired.status,204);assert.equal(d.state.status,'phone-verification');
 const headers={Cookie:paired.headers['set-cookie'][0].split(';')[0]};
 setHealthy(false);assert.equal((await request('/push/health',{headers})).status,503);assert.equal(d.state.status,'phone-verification');
 setHealthy(true);assert.equal((await request('/push/health',{headers})).status,200);await ready(d);assert.equal(d.verifiedBy,'phone');assert.equal(d.state.url,state.verificationUrl);
 assert.ok(!JSON.stringify(d.connectionReport()).includes(token));assert.ok(!JSON.stringify(d.connectionReport()).includes(url.hostname));
 await d.queue;await d.configure({background:false});await d.completeSetup();assert.equal(d.preferences.setupComplete,true);
 await d.action('local');assert.equal(d.state.url,'');assert.equal(d.state.verificationUrl,undefined);
});
test('a phone-verified connection survives blocked desktop self-probes and requires live tunnel connectivity when restoring', {timeout:15000},async t=>{
 const {d,request}=await fixture(t),state=await d.verifyWithPhone(),url=new URL(state.verificationUrl);
 const paired=await request('/pair/',{method:'POST',body:JSON.stringify({token:url.hash.slice(1)}),headers:{Origin:url.origin}});
 const headers={Cookie:paired.headers['set-cookie'][0].split(';')[0]};await request('/push/health',{headers});await ready(d);
 await new Promise(resolve=>setTimeout(resolve,10500));assert.equal(d.state.status,'ready','desktop-only DNS failure must not revoke a phone-verified working connection');
 const generation=d.generation;await d.receive({status:'reconnecting',message:'Tunnel interrupted'},generation);await request('/push/health',{headers});assert.equal(d.state.status,'reconnecting');assert.equal(d.state.url,'');
 await d.receive({status:'checking',origin:url.origin},generation);await request('/push/health',{headers});await ready(d);
 await d.action('local');await d.phoneVerified(generation);assert.equal(d.state.status,'local');assert.equal(d.state.url,'');
});
test('a missing local workspace prevents phone verification and is distinguished from public DNS failure',async t=>{
 const {d,setHealthy}=await fixture(t);setHealthy(false);
 await assert.rejects(d.verifyWithPhone(),error=>error.scope==='local'&&error.httpStatus===503);
 assert.equal(d.state.url,'');assert.equal(d.state.verificationQr,undefined);
});
