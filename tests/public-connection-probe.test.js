'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),https=require('node:https');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {createPublicProbe,probeAddresses,publicAddress}=require('../lib/public-connection-probe');
const {HealthError}=require('../lib/connection-health');
const gateway=()=>({origin:'https://resolver-fixture.trycloudflare.com',token:'private-test-capability',probe:async()=>{throw new HealthError('DNS');}});
test('ordinary successful probes do not contact an alternate resolver',async()=>{
 const g=gateway();g.probe=async()=>{};
 await createPublicProbe({request:()=>assert.fail('Unexpected DNS request'),environment:{},resolveProxy:()=>assert.fail('Unexpected proxy lookup')})(g);
 assert.equal(g.probeTransport,'system');
});
test('DNS fallback queries only the public hostname, filters addresses, caches results and retains the TLS hostname',async()=>{
 const g=gateway(),requests=[],resolved=[];
 const probe=createPublicProbe({environment:{},resolveProxy:async()=> 'DIRECT',request:async(url,options)=>{
  requests.push({url,options});assert.equal(options.headers.Authorization,undefined);assert.equal(options.credentials,'omit');
  return Response.json({Status:0,Answer:[{type:1,data:'104.16.230.132'},{type:1,data:'127.0.0.1'},{type:28,data:'2606:4700::6810:e684'}]});
 },probeResolved:async options=>resolved.push(options)});
 await probe(g);await probe(g);assert.equal(requests.length,2);assert.equal(resolved.length,2);assert.equal(g.probeTransport,'secure-dns');
 assert.equal(resolved[0].origin,g.origin);assert.equal(resolved[0].token,g.token);assert.ok(resolved[0].addresses.every(a=>a.address!=='127.0.0.1'));
 for(const r of requests){assert.equal(new URL(r.url).searchParams.get('name'),new URL(g.origin).hostname);assert.ok(!r.url.includes(g.token));}
});
test('HTTP denial, TLS failure, private domains and configured proxies never select a direct fallback route',async()=>{
 const options={environment:{},resolveProxy:async()=> 'DIRECT',request:()=>assert.fail('Unexpected DNS request'),probeResolved:()=>assert.fail('Unexpected direct connection')};
 for(const error of [new HealthError('HTTP','public',403),new HealthError('TLS')]){
  const g=gateway();g.probe=async()=>{throw error;};await assert.rejects(createPublicProbe(options)(g),e=>e===error);
 }
 for(const origin of ['https://private.example','https://host.trycloudflare.com:8443','https://host.trycloudflare.com.evil.example'])await assert.rejects(createPublicProbe(options)({...gateway(),origin}),e=>e.code==='DNS');
 await assert.rejects(createPublicProbe({...options,environment:{HTTPS_PROXY:'http://configured-proxy.invalid'}})(gateway()),e=>e.code==='DNS');
 await assert.rejects(createPublicProbe({...options,resolveProxy:async()=> 'PROXY configured-proxy.invalid:3128; DIRECT'})(gateway()),e=>e.code==='DNS');
});
test('untrusted/private DNS answers cannot select an internal endpoint and failed lookups are bounded',async()=>{
 let calls=0;const g=gateway();const probe=createPublicProbe({environment:{},resolveProxy:async()=> 'DIRECT',request:async()=>{calls++;return Response.json({Status:0,Answer:[{type:1,data:'10.1.2.3'},{type:1,data:'169.254.169.254'},{type:28,data:'::1'}]});},probeResolved:()=>assert.fail('Private address was accepted')});
 await assert.rejects(probe(g),e=>e.code==='DNS');assert.equal(calls,4);await assert.rejects(probe(g),e=>e.code==='DNS');assert.equal(calls,4);
 for(const ip of ['0.0.0.0','127.0.0.1','10.2.3.4','100.64.0.1','192.168.1.1','172.16.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','fd00::1'])assert.equal(publicAddress(ip),false,ip);
});
test('resolved-address HTTPS keeps real SNI/Host checks, rejects untrusted or mismatched certificates and checks actual health',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-dns-tls-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(directory,'key'),'-out',path.join(directory,'cert'),'-subj','/CN=resolver-fixture.trycloudflare.com','-addext','subjectAltName=DNS:resolver-fixture.trycloudflare.com']);
 const ca=await fs.readFile(path.join(directory,'cert')),key=await fs.readFile(path.join(directory,'key'));let observed,healthy=true;
 const server=https.createServer({cert:ca,key},(req,res)=>{observed={host:req.headers.host,sni:req.socket.servername,path:req.url,authorization:req.headers.authorization};res.writeHead(healthy?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({push:true,share:healthy}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const origin='https://resolver-fixture.trycloudflare.com:'+server.address().port,addresses=[{address:'127.0.0.1',family:4}],token='fixture-capability';
 await probeAddresses({origin,addresses,token,ca});assert.equal(observed.host,new URL(origin).host);assert.equal(observed.sni,new URL(origin).hostname);assert.equal(observed.path,'/push/health');assert.equal(observed.authorization,'Bearer '+token);
 await assert.rejects(probeAddresses({origin,addresses,token}),e=>e.code==='TLS');
 await assert.rejects(probeAddresses({origin:origin.replace('resolver-fixture.','mismatch.'),addresses,token,ca}),e=>e.code==='TLS');
 healthy=false;await assert.rejects(probeAddresses({origin,addresses,token,ca}),e=>e.httpStatus===503);
});
