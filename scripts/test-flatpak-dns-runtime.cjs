'use strict';
// Exercise the current source probe in an installed, signed Flatpak runtime.
// The old installed controller supplies only the owned tunnel. Current source
// must prove real TLS and health in the bundled Node process before success.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {_electron:electron}=require('playwright-core');
const id='io.github.fluffydisk.airdrop-linux';
async function bounded(operation,label,timeout=15000){
 let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),timeout);})]);}finally{clearTimeout(timer);}
}
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-dns-runtime-'));let app;
 try{
  const executable=path.join(directory,'launch');
  await fs.writeFile(executable,'#!/bin/sh\nexec flatpak run --user --env=AIRDROP_HOME=/tmp/airdrop-dns-runtime-'+randomUUID()+' --env=AIRDROP_DISABLE_UPDATE_CHECK=1 --env=AIRDROP_DISABLE_TRAY=1 '+id+' "$@"\n',{mode:0o755});
  app=await electron.launch({executablePath:executable,chromiumSandbox:true,args:['--ozone-platform=x11'],timeout:60000});
  const page=await app.firstWindow();await page.waitForFunction(()=>document.getElementById('health').dataset.status==='ready',{}, {timeout:30000});
  // Prevent an older installed controller from using its obsolete native TLS
  // probe. Do not fake readiness: the real probe below is mandatory.
  await app.evaluate(({net})=>{globalThis.runtimeOriginalFetch=net.fetch;net.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url);if(url.hostname.endsWith('.trycloudflare.com')&&url.pathname==='/push/health')throw Object.assign(Error('Controlled old-controller refusal'),{code:'ERR_CONNECTION_REFUSED'});return globalThis.runtimeOriginalFetch(input,options);};});
  await bounded(page.evaluate(()=>window.airdrop.devices('mode',{mode:'internet'})),'Start owned tunnel');
  let state;const deadline=Date.now()+180000;
  do{state=await bounded(page.evaluate(()=>window.airdrop.devices('state')),'Read tunnel state');if(['checking','error'].includes(state.status))break;await new Promise(r=>setTimeout(r,1000));}while(Date.now()<deadline);
  assert.equal(state.status,'checking',state.message);
  const pending=await bounded(page.evaluate(()=>window.airdrop.devices('verify-with-phone')),'Expose pending verification address');
  const address=new URL(pending.verificationUrl),sources={};
  for(const name of ['public-connection-probe.js','public-probe-process.js','public-probe-worker.js','connection-health.js'])sources[name]=await fs.readFile(path.resolve('lib',name),'utf8');
  const result=await bounded(app.evaluate(async({app,net,session},options)=>{
   const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path'),os=process.getBuiltinModule('os');
   const stage=fs.mkdtempSync(path.join(os.tmpdir(),'airdrop-current-probe-'));
   for(const [name,source] of Object.entries(options.sources))fs.writeFileSync(path.join(stage,name),source,{mode:0o600});
   const requireProbe=process.getBuiltinModule('module').createRequire(path.join(stage,'entry.cjs'));
   const health=requireProbe('./connection-health'),{createPublicProbe}=requireProbe('./public-connection-probe'),{probeInProcess}=requireProbe('./public-probe-process');
   const execPath=path.resolve(app.getAppPath(),'../../../runtime/node');if(!fs.existsSync(execPath))throw Error('Bundled Node runtime is missing');
   const gateway={origin:options.origin,token:options.token,probe:async()=>{throw new health.HealthError('DNS');}};
   const probe=createPublicProbe({request:(...args)=>net.fetch(...args),resolveProxy:url=>session.defaultSession.resolveProxy(url),probeResolved:args=>probeInProcess(args,{execPath})});
   try{await probe(gateway);return {passed:true,transport:gateway.probeTransport,dnsFallback:gateway.dnsFallback};}
   catch(error){return {passed:false,code:error.code,transport:gateway.probeTransport,dnsFallback:gateway.dnsFallback};}
   finally{fs.rmSync(stage,{recursive:true,force:true});}
  },{sources,origin:address.origin,token:address.hash.slice(1)}),'Certificate-verified DNS recovery using the bundled Node worker',60000);
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.transport,'secure-dns');assert.equal(result.dnsFallback,'used');
  assert.ok(['ready','phone-verification'].includes((await bounded(page.evaluate(()=>window.airdrop.devices('state')),'Main-process responsiveness')).status));
  const headers={Authorization:'Bearer '+address.hash.slice(1)},name='runtime-dns-'+randomUUID()+'.txt';
  const request=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)});
  assert.equal((await request(address.origin+'/push/files/'+name,{method:'PUT',headers,body:'verified runtime TLS'})).status,201);
  assert.equal(await(await request(address.origin+'/'+name,{headers})).text(),'verified runtime TLS');
  console.log('PASS: current source used the signed Flatpak bundled Node worker to recover real public DNS, verify original-host TLS, remain responsive and transfer exact file bytes.');
 }finally{
  if(app)await bounded(app.evaluate(({net})=>{if(globalThis.runtimeOriginalFetch)net.fetch=globalThis.runtimeOriginalFetch;}),'Restore transport',2000).catch(()=>{});
  if(app)await bounded(app.close(),'Quit test application',5000).catch(()=>promisify(execFile)('flatpak',['kill',id],{timeout:10000}).catch(()=>{}));
  await fs.rm(directory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
