#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const code=process.env.AIRDROP_CODE_DIR || '/usr/lib/airdrop-linux';
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-managed-smoke-'));
 const proc=spawn(path.join(code,'runtime/node'),[path.join(code,'server/scripts/managed-runtime.js'),'backend'],{env:{...process.env,AIRDROP_HOME:root,XDG_CONFIG_HOME:path.join(root,'xdg-config')},stdio:['ignore','pipe','pipe']});
 let log='';proc.stdout.on('data',data=>{log+=data;});proc.stderr.on('data',data=>{log+=data;});
 try{
  let ready=false;
  for(let i=0;i<100;i++){
   if(proc.exitCode!==null)throw new Error('Backend exited: '+log);
   try{const health=await fetch('http://127.0.0.1:6001/push/health');if(health.ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'Backend health timeout: '+log);
  const base='http://127.0.0.1:6001';
  assert.equal((await fetch(base+'/ui/')).status,200);
  assert.equal((await fetch(base+'/push/files/smoke.txt',{method:'PUT',body:'managed payload'})).status,201);
  assert.equal(await (await fetch(base+'/smoke.txt')).text(),'managed payload');
  const archive=await fetch(base+'/push/archive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:['smoke.txt']})});
  assert.equal(archive.status,200);
  const JSZip=require('jszip');const zip=await JSZip.loadAsync(Buffer.from(await archive.arrayBuffer()));
  assert.equal(await zip.file('smoke.txt').async('string'),'managed payload');
  const env=await fs.readFile(path.join(root,'config/server.env'),'utf8');
  assert.match(env,/VAPID_PRIVATE_KEY=.+/);
  console.log('Managed backend: UI, upload, download, ZIP and per-user identity passed');
 }finally{
  proc.kill('SIGTERM');
  if(proc.exitCode===null)await new Promise(resolve=>proc.once('exit',resolve));
  await fs.rm(root,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
