'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), https = require('node:https'), crypto = require('node:crypto');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const { createRelay } = require('../lib/relay-server');
const { RelayClient } = require('../lib/relay-client');
const { ShareGateway } = require('../lib/device-share');
const { relayUrl, proxyHeaders } = require('../lib/relay-protocol');
const lookup = (host, options, cb) => options.all ? cb(null, [{address:'127.0.0.1',family:4}]) : cb(null, '127.0.0.1', 4);
async function listen(server) { await new Promise(r => server.listen(0, '127.0.0.1', r)); return server.address().port; }
async function fixture(t, options={}) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-relay-')); t.after(() => fs.rm(dir, {recursive:true,force:true}));
 await promisify(execFile)('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(dir,'key'),'-out',path.join(dir,'cert'),'-subj','/CN=relay.test','-addext','subjectAltName=DNS:relay.test,DNS:*.relay.test']);
 const cert=await fs.readFile(path.join(dir,'cert')), key=await fs.readFile(path.join(dir,'key'));
 const accessKey=crypto.randomBytes(32).toString('hex');
 const relay=createRelay({domain:'relay.test',accessKey,tls:{cert,key},...options});t.after(()=>relay.close());
 const port=await listen(relay.server), url='https://relay.test:'+port;
 function request(target, options={}, body) { return new Promise((resolve,reject)=>{
   const req=https.request(target,{ca:cert,lookup,...options},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});
   req.on('error',reject);req.end(body);
 }); }
 const backend=http.createServer((req,res)=>{
   if(req.url==='/push/health'){res.setHeader('content-type','application/json');res.end('{"push":true,"share":true}');return;}
   if(req.method==='PUT'){req.pipe(res);return;}
   res.setHeader('content-type','text/plain');res.end('private file: '+req.url);
 });
 const backendPort=await listen(backend);t.after(()=>{backend.closeAllConnections();backend.close();});
 const gateway=new ShareGateway({backend:'http://127.0.0.1:'+backendPort,secure:true});const target=await gateway.listen();t.after(()=>gateway.close());
 const states=[];let connected;
 const ready=new Promise(r=>{connected=r;});
 const client=new RelayClient({url,accessKey,deviceKey:crypto.randomBytes(32).toString('base64url'),target:target.target,retryDelay:50,transportOptions:{ca:cert,lookup},onState:event=>{states.push(event);if(event.origin){gateway.setOrigin(event.origin);connected(event);}}});
 t.after(()=>client.stop());client.start();await ready;
 return {relay,client,gateway,url,request,states,cert,accessKey};
}
test('TLS reverse tunnel pairs a browser, streams uploads/downloads and revokes access on disconnect', {timeout:20000}, async t=>{
 const f=await fixture(t), origin=f.gateway.origin;
 assert.equal((await f.request(origin+'/file')).status,401);
 const pair=await f.request(origin+'/pair/',{method:'POST',headers:{origin,'content-type':'application/json'}},JSON.stringify({token:f.gateway.token}));
 assert.equal(pair.status,204);assert.match(pair.headers['set-cookie'][0],/Secure/);
 const cookie=pair.headers['set-cookie'][0].split(';')[0];
 assert.equal((await f.request(origin+'/file.txt',{headers:{cookie}})).body.toString(),'private file: /file.txt');
 const payload=crypto.randomBytes(4*1024*1024+17);
 const uploaded=await f.request(origin+'/upload',{method:'PUT',headers:{cookie,'content-type':'application/octet-stream'}},payload);
 assert.equal(uploaded.status,200);assert.deepEqual(uploaded.body,payload);
 assert.equal((await f.request(origin+'/file',{headers:{cookie,origin:'https://evil.test'}})).status,403);
 assert.equal((await f.request(origin+'/pair/',{method:'POST',headers:{origin},body:''},JSON.stringify({token:'wrong'}))).status,403);
 f.client.stop();await new Promise(r=>setTimeout(r,30));
 assert.equal((await f.request(origin+'/file',{headers:{cookie}})).status,503);
});
test('relay denies untrusted TLS and wrong registration keys; reconnect restores the same workspace', {timeout:20000},async t=>{
 const f=await fixture(t);
 const denied=await f.request(f.url+'/v1/control',{method:'POST',headers:{authorization:'Bearer wrong','x-airdrop-device':crypto.randomBytes(32).toString('base64url')}});
 assert.equal(denied.status,401);
 await assert.rejects(new Promise((resolve,reject)=>{const req=https.get(f.url+'/health',{lookup},resolve);req.on('error',reject);}),/self-signed/);
 const origin=f.gateway.origin;f.client.control.destroy();
 for(let i=0;i<100 && f.states.filter(s=>s.origin).length<2;i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(f.states.some(s=>s.status==='reconnecting'));assert.equal(f.states.filter(s=>s.origin).length,2);assert.equal(f.gateway.origin,origin);
 const health=await f.request(origin+'/push/health',{headers:{authorization:'Bearer '+f.gateway.token}});
 assert.equal(health.status,200);assert.equal(JSON.parse(health.body).share,true);
});
test('relay configuration requires HTTPS and strips dynamic hop headers',()=>{
 for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/#secret'])assert.throws(()=>relayUrl(url));
 assert.equal(relayUrl('https://relay.example.com:8443').origin,'https://relay.example.com:8443');
 assert.deepEqual(proxyHeaders({connection:'x-secret','x-secret':'hidden',cookie:'pair','x-forwarded-host':'evil',upgrade:'websocket'}),{cookie:'pair'});
 assert.throws(()=>createRelay({domain:'relay.example.com',accessKey:'a'.repeat(32)}),/TLS/);
});

test('automatic enrollment issues a device-scoped credential and enforces rate limits', {timeout:20000}, async t=>{
 const f=await fixture(t,{enrollment:true,enrollmentLimit:2});
 const a=crypto.randomBytes(32).toString('base64url'), b=crypto.randomBytes(32).toString('base64url');
 const headers={'x-airdrop-device':a,'content-length':'0'};
 const first=await f.request(f.url+'/v1/enroll',{method:'POST',headers});assert.equal(first.status,200);
 const key=JSON.parse(first.body).accessKey;assert.match(key,/^device\.[a-f0-9]{64}$/);assert.notEqual(key,f.accessKey);
 const foreign=await f.request(f.url+'/v1/control',{method:'POST',headers:{authorization:'Bearer '+key,'x-airdrop-device':b}});assert.equal(foreign.status,401);
 const {enrollDevice}=require('../lib/connection-service');
 assert.equal(await enrollDevice({url:f.url,deviceKey:a,transportOptions:{ca:f.cert,lookup}}),key);
 const limited=await f.request(f.url+'/v1/enroll',{method:'POST',headers});assert.equal(limited.status,429);
 const {deviceId}=require('../lib/relay-protocol');
 const events=[];const client=new RelayClient({url:f.url,accessKey:key,deviceKey:a,target:'http://127.0.0.1:1',transportOptions:{ca:f.cert,lookup},onState:e=>events.push(e)});t.after(()=>client.stop());client.start();
 for(let i=0;i<100&&!events.some(e=>e.origin);i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(new URL(events.find(e=>e.origin).origin).hostname,deviceId(a)+'.relay.test');
});
