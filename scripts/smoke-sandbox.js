#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const JSZip=require('jszip');
const channel=process.argv[2];
const id='io.github.fluffydisk.Airdrop';
const base='http://127.0.0.1:6001';
(async()=>{
 if(!['flatpak','snap'].includes(channel))throw new Error('Usage: smoke-sandbox.js flatpak|snap');
 let proc,log='',started=false;
 try {
  if(channel==='flatpak'){
   proc=spawn('flatpak',['run','--command=/app/lib/airdrop-linux/runtime/node',id,'/app/lib/airdrop-linux/server/scripts/managed-runtime.js','backend'],{stdio:['ignore','pipe','pipe']});
   proc.stdout.on('data',chunk=>{log+=chunk;});proc.stderr.on('data',chunk=>{log+=chunk;});
   proc.on('error',error=>{log+=error.message;});started=true;
  }else{await run('sudo',['snap','start','--users=all','airdrop-linux.backend']);started=true;}
  let ready=false;
  for(let i=0;i<100;i++){
   if(proc && (proc.exitCode!==null || proc.signalCode))throw new Error('Sandbox backend exited: '+log);
   try{const response=await fetch(base+'/push/health');const health=await response.json();if(response.ok&&health.push&&health.share){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(ready,'Sandbox backend readiness timeout: '+log);
  assert.equal((await fetch(base+'/ui/')).status,200);
  const name=`sandbox-smoke-${Date.now()}.txt`;
  const uploaded=await fetch(base+'/push/files/'+name,{method:'PUT',body:'sandbox payload'});assert.equal(uploaded.status,201);
  assert.equal(await(await fetch(base+'/'+name)).text(),'sandbox payload');
  const response=await fetch(base+'/push/archive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[name]})});
  assert.equal(response.status,200);
  const zip=await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));assert.equal(await zip.file(name).async('string'),'sandbox payload');
  console.log(channel+': real sandbox UI/API upload, dufs download and ZIP contents passed');
 }finally{
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
