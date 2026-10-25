#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const JSZip=require('jszip');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const channel=process.argv[2];
const id='io.github.fluffydisk.airdrop-linux';
const base='http://127.0.0.1:6001';
const flatpakRun=['run','--user',...(process.env.AIRDROP_TEST_HOME?['--env=AIRDROP_HOME='+process.env.AIRDROP_TEST_HOME]:[])];
(async()=>{
 if(!['flatpak','snap'].includes(channel))throw new Error('Usage: smoke-sandbox.js flatpak|snap');
 let proc,log='',started=false,canary;
 try {
  if(channel==='flatpak'){
   proc=spawn('flatpak',[...flatpakRun,'--command=/app/lib/airdrop-linux/runtime/node',id,'/app/lib/airdrop-linux/server/scripts/managed-runtime.js','backend'],{stdio:['ignore','pipe','pipe']});
   proc.stdout.on('data',chunk=>{log+=chunk;});proc.stderr.on('data',chunk=>{log+=chunk;});
   proc.on('error',error=>{log+=error.message;});started=true;
  }else{await run('sudo',['snap','start','--users=all','airdrop-linux.backend']);started=true;}
  let ready=false;
  for(let i=0;i<100;i++){
   if(proc && (proc.exitCode!==null || proc.signalCode))throw new Error('Sandbox backend exited: '+log);
   try{const response=await fetch(base+'/push/health');const health=await response.json();if(response.ok&&health.push&&health.share){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready && channel==='snap') {
   try {log+=(await run('sudo',['journalctl','_SYSTEMD_USER_UNIT=snap.airdrop-linux.backend.service','--no-pager','--lines=80'])).stdout;} catch(error){log+=error.message;}
   try {log+=(await run('systemctl',['--user','status','snap.airdrop-linux.backend.service','--no-pager','--full','--lines=100'])).stdout;} catch(error){log+=error.stdout||error.message;}
  }
  assert.ok(ready,'Sandbox backend readiness timeout: '+log);
  if(channel==='flatpak') {
   canary=path.join(os.homedir(),'.airdrop-sandbox-canary-'+require('node:crypto').randomUUID());
   await fs.writeFile(canary,'host-only canary',{flag:'wx',mode:0o600});
   await run('flatpak',['run','--user','--command=/app/lib/airdrop-linux/runtime/node',id,'-e',
    'const fs=require("node:fs"),assert=require("node:assert/strict"); assert.throws(()=>fs.readFileSync(process.argv[1]),e=>["ENOENT","EACCES"].includes(e.code)); assert.ok(process.env.XDG_DATA_HOME.includes("/.var/app/"+process.env.FLATPAK_ID+"/"));',canary]);
   await assert.rejects(run('flatpak',[...flatpakRun,'--command=/app/lib/airdrop-linux/runtime/node',id,'/app/lib/airdrop-linux/server/scripts/managed-runtime.js','backend']),error=>/Port 5000 is already in use/.test(error.stderr));
   assert.equal((await fetch(base+'/push/health')).status,200,'A conflicting instance must not stop the original backend');
   console.log('flatpak: host home access denied, private data path and safe port conflict verified');
  }
  assert.equal((await fetch(base+'/ui/')).status,200);
  if(channel==='flatpak') {
   const listeners=(await Promise.all(['tcp','tcp6'].map(file=>fs.readFile('/proc/net/'+file,'utf8'))))
    .flatMap(table=>table.trim().split('\n').slice(1).map(line=>line.trim().split(/\s+/)))
    .filter(fields=>fields[3]==='0A'&&['1388','1771'].includes(fields[1].split(':')[1]));
   assert.equal(listeners.length,2,'Both backend ports must have one listener each');
   assert.ok(listeners.every(fields=>['0100007F','00000000000000000000000001000000'].includes(fields[1].split(':')[0])),
    'Backend must never listen on LAN/wildcard addresses');
   console.log(channel+': both backend listeners restricted to loopback');
   const malformed=require('node:zlib').gzipSync(Buffer.from('{"files":[]}'));
   const response=await fetch(base+'/push/archive',{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':'gzip'},body:Buffer.concat([malformed,Buffer.from('trailing compressed-body bytes')])});
   assert.equal(response.status,400);
   await new Promise(resolve=>setTimeout(resolve,100));
   assert.equal((await fetch(base+'/push/health')).status,200,'Malformed compressed input must not crash the backend');
   console.log('flatpak: GHSA-27r3-jxmh-p828 malformed compressed-body regression passed');
  }
  const name=`sandbox-smoke-${Date.now()}.txt`;
  const uploaded=await fetch(base+'/push/files/'+name,{method:'PUT',body:'sandbox payload'});assert.equal(uploaded.status,201);
  assert.equal(await(await fetch(base+'/'+name)).text(),'sandbox payload');
  const response=await fetch(base+'/push/archive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[name]})});
  assert.equal(response.status,200);
  const zip=await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));assert.equal(await zip.file(name).async('string'),'sandbox payload');
  console.log(channel+': real sandbox UI/API upload, dufs download and ZIP contents passed');
 }finally{
  if(canary)await fs.rm(canary,{force:true});
  if(started){
   if(channel==='snap')await run('sudo',['snap','stop','--users=all','airdrop-linux.backend']);
   else await run('flatpak',['kill',id]).catch(error=>{if(proc?.exitCode===null&&!proc?.signalCode)throw error;});
  }
 }
 for(let i=0;i<25;i++){
  const running=await fetch(base+'/push/health').then(()=>true,()=>false);
  if(!running){console.log(channel+': backend stopped');return;}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 throw new Error('Backend still running after stop');
})().catch(error=>{console.error(error);process.exitCode=1;});
