'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {PassThrough}=require('node:stream'),{EventEmitter}=require('node:events');
const {verifiedHelper,InternetConnection}=require('../lib/internet-connection');
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-internet-component-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const bytes=Buffer.from('controlled executable fixture, never executed');return {directory,bytes,asset:{url:'https://github.com/cloudflare/cloudflared/releases/download/fixture/cloudflared-linux-amd64',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length}};}
test('internet component downloads with real progress, verifies its pinned hash and reuses only verified bytes',async t=>{
 const f=await fixture(t);let downloads=0;const progress=[];
 const request=async()=>{downloads++;return new Response(f.bytes);};
 const target=await verifiedHelper({...f,request,progress:(size,total)=>progress.push([size,total])});assert.equal(await fs.readFile(target,'utf8'),f.bytes.toString());assert.equal((await fs.stat(target)).mode&0o777,0o700);assert.ok(progress.length>0);
 assert.equal(await verifiedHelper({...f,request}),target);assert.equal(downloads,1);
 await fs.writeFile(target,'tampered');assert.equal(await verifiedHelper({...f,request}),target);assert.equal(downloads,2);
});
test('a corrupt, oversized or cancelled download is never executed or retained',async t=>{
 for(const type of ['hash','size','cancel']){
  const f=await fixture(t),controller=new AbortController();if(type==='cancel')controller.abort();
  await assert.rejects(verifiedHelper({...f,signal:controller.signal,request:async()=>new Response(type==='size'?Buffer.concat([f.bytes,f.bytes]):type==='hash'?Buffer.alloc(f.bytes.length):f.bytes)}));
  assert.deepEqual(await fs.readdir(f.directory),[]);
 }
});
test('internet tunnel accepts only the provider HTTPS origin, keeps progress real and kills only its child',async t=>{
 const f=await fixture(t);let child,args;const states=[];
 const connection=new InternetConnection({...f,target:'http://127.0.0.1:1234',proxyHost:'fixed.internal',request:async()=>new Response(f.bytes),onState:s=>states.push(s),spawnProcess:(exe,parameters)=>{
  args=parameters;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;child.kill=signal=>{child.exitCode=0;child.emit('exit',0,signal);};return child;
 }});t.after(()=>connection.stop());connection.start();
 for(let i=0;i<100&&!child;i++)await new Promise(r=>setTimeout(r,5));assert.ok(child);assert.ok(args.includes('--no-autoupdate'));assert.ok(args.includes('--http-host-header'));assert.ok(!args.includes('--no-tls-verify'));
 child.stderr.write('https://bad.trycloudflare.com.evil.example\n');assert.equal(states.some(s=>s.origin),false);
 child.stderr.write(JSON.stringify({message:'https://test-tunnel.trycloudflare.com'})+'\n');assert.equal(states.at(-1).origin,'https://test-tunnel.trycloudflare.com');assert.equal(states.at(-1).status,'checking');
 await connection.stop();assert.equal(child.exitCode,0);assert.ok(states.some(s=>s.status==='downloading'));
});
