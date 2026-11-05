'use strict';
// Exercise the current source probe in an installed, signed Flatpak runtime.
// The owned test tunnel and health response are real; only ordinary DNS fails.
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
  await bounded(page.evaluate(()=>window.airdrop.devices('mode',{mode:'internet'})),'Start owned tunnel');
  let state;const deadline=Date.now()+180000;
  do{state=await bounded(page.evaluate(()=>window.airdrop.devices('state')),'Read tunnel state');if(['ready','error'].includes(state.status))break;await new Promise(r=>setTimeout(r,1000));}while(Date.now()<deadline);
  assert.equal(state.status,'ready',state.message);
  const address=new URL(state.url),source=await fs.readFile(path.resolve('lib/public-connection-probe.js'),'utf8');
  const result=await bounded(app.evaluate(async({app,net,session},options)=>{
   const mainRequire=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/main.js');
   const health=mainRequire('./core/lib/connection-health'),module={exports:{}};
   const requireProbe=name=>name==='./connection-health'?health:process.getBuiltinModule(name.replace(/^node:/,''));
   Function('require','module','exports',options.source)(requireProbe,module,module.exports);
   const gateway={origin:options.origin,token:options.token,probe:async()=>{throw new health.HealthError('DNS');}};
   const probe=module.exports.createPublicProbe({request:(...args)=>net.fetch(...args),resolveProxy:url=>session.defaultSession.resolveProxy(url)});
   try{await probe(gateway);return {passed:true,transport:gateway.probeTransport,dnsFallback:gateway.dnsFallback};}
   catch(error){return {passed:false,code:error.code,transport:gateway.probeTransport,dnsFallback:gateway.dnsFallback};}
  },{source,origin:address.origin,token:address.hash.slice(1)}),'Certificate-verified DNS recovery inside installed Electron',60000);
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.transport,'secure-dns');assert.equal(result.dnsFallback,'used');
  assert.equal((await bounded(page.evaluate(()=>window.airdrop.devices('state')),'Main-process responsiveness')).status,'ready');
  const headers={Authorization:'Bearer '+address.hash.slice(1)},name='runtime-dns-'+randomUUID()+'.txt';
  const request=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)});
  assert.equal((await request(address.origin+'/push/files/'+name,{method:'PUT',headers,body:'verified runtime TLS'})).status,201);
  assert.equal(await(await request(address.origin+'/'+name,{headers})).text(),'verified runtime TLS');
  console.log('PASS: current source in the signed Flatpak Electron runtime recovered real public DNS, verified original-host TLS, remained responsive and transferred exact file bytes.');
 }finally{
  if(app)await bounded(app.close(),'Quit test application',5000).catch(()=>promisify(execFile)('flatpak',['kill',id],{timeout:10000}).catch(()=>{}));
  await fs.rm(directory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
