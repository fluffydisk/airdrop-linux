'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),https=require('node:https');
const {execFile,fork}=require('node:child_process'),{promisify}=require('node:util'),{once}=require('node:events');
const {probeInProcess}=require('../lib/public-probe-process');
async function directory(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-probe-process-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('the real Node worker verifies TLS and health while retaining the original hostname',async t=>{
 const root=await directory(t);
 await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(root,'key'),'-out',path.join(root,'cert'),'-subj','/CN=worker-fixture.trycloudflare.com','-addext','subjectAltName=DNS:worker-fixture.trycloudflare.com']);
 const ca=await fs.readFile(path.join(root,'cert'),'utf8'),key=await fs.readFile(path.join(root,'key'));let observed,healthy=true;
 const server=https.createServer({cert:ca,key},(req,res)=>{observed={host:req.headers.host,sni:req.socket.servername,authorization:req.headers.authorization};res.writeHead(healthy?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({push:true,share:true}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const options={origin:'https://worker-fixture.trycloudflare.com:'+server.address().port,token:'worker-fixture-capability',addresses:[{address:'127.0.0.1',family:4}],ca};
 await probeInProcess(options);assert.equal(observed.sni,'worker-fixture.trycloudflare.com');assert.equal(observed.host,new URL(options.origin).host);assert.equal(observed.authorization,'Bearer '+options.token);
 await assert.rejects(probeInProcess({...options,ca:undefined}),e=>e.code==='TLS');
 await assert.rejects(probeInProcess({...options,origin:options.origin.replace('worker-fixture.','mismatch.')}),e=>e.code==='TLS');
 healthy=false;await assert.rejects(probeInProcess(options),e=>e.code==='HTTP'&&e.httpStatus===503);
});
test('a blocked TLS worker is killed at the deadline without blocking the parent',async t=>{
 const root=await directory(t),worker=path.join(root,'blocked.cjs');await fs.writeFile(worker,"process.on('message',()=>{while(true){}});");let child;
 const pending=probeInProcess({},{worker,timeout:150,forkProcess:(...args)=>{child=fork(...args);return child;}});
 const exited=once(child,'exit');await assert.rejects(pending,e=>e.code==='TIMEOUT');await exited;assert.equal(child.signalCode,'SIGKILL');
 let responsive=false;await new Promise(r=>setImmediate(()=>{responsive=true;r();}));assert.equal(responsive,true);
});
test('worker crashes and malformed results are failures, without leaking private error text',async t=>{
 const root=await directory(t);
 for(const [name,source] of [['crash',"process.once('message',()=>process.exit(9));"],['malformed',"process.once('message',()=>process.send({code:'PRIVATE https://secret.invalid/#capability'}));"]]){
  const worker=path.join(root,name+'.cjs');await fs.writeFile(worker,source);await assert.rejects(probeInProcess({},{worker}),e=>e.code==='NETWORK'&&!e.message.includes('secret'));
 }
});
