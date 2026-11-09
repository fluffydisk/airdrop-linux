'use strict';
// Release-only acceptance with an isolated empty workspace and real public service.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const express=require('express'),{chromium,devices:profiles}=require('playwright-core');
const {createServer}=require('../push-server');
const {Devices}=require('../lib/devices'),{InternetConnection}=require('../lib/internet-connection');
const {assets}=require('../packaging/internet-helper.json');
test('real account-free internet tunnel pairs mobile browsers and transfers files', {timeout:360000,skip:process.env.AIRDROP_TEST_LIVE_INTERNET!=='1'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-live-internet-')),share=path.join(root,'files');await fs.mkdir(share);
 const service=createServer({watchDir:share,stateDir:path.join(root,'push'),watch:false});
 const app=express();app.use('/push',service.app);app.use('/ui',express.static(path.resolve('ui')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 const connection=new Devices({directory:path.join(root,'connections'),backend:'http://127.0.0.1:'+server.address().port,
  createInternetClient:options=>new InternetConnection({...options,directory:path.join(root,'runtime'),asset:assets[process.arch]})});
 t.after(async()=>{await browser?.close();await connection.stop();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 await connection.initialize();await connection.queue;await connection.action('internet');
 let dnsRetries=0;
 const dnsFailure=error=>/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/.test([error.code,error.cause?.code,error.message].join(' '));
 async function publicEntry(){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
   const current=await connection.snapshot();assert.notEqual(current.status,'error',current.message);
   if(['ready','phone-verification'].includes(current.status)){
    if(current.status==='phone-verification'){assert.equal(current.url,'');assert.equal(current.qr,'');}
    const url=current.status==='ready'?current.url:current.verificationUrl;
    try{
     const response=await fetch(new URL('/push/health',url),{signal:AbortSignal.timeout(5000)});
     assert.equal(response.status,401,'the actual public gateway must answer; a Cloudflare error page is not success');
     await response.body?.cancel();
     const latest=await connection.snapshot();
     if(url===(latest.status==='ready'?latest.url:latest.verificationUrl))return url;
    }catch(error){if(!dnsFailure(error))throw error;dnsRetries++;}
   }
   await new Promise(r=>setTimeout(r,1000));
  }
  throw Error('Independent public client could not resolve and reach the current tunnel within 60 seconds');
 }
 let state;
 for(let i=0;i<130;i++){state=await connection.snapshot();if(['ready','phone-verification','error'].includes(state.status))break;await new Promise(r=>setTimeout(r,1000));}
 assert.ok(['ready','phone-verification'].includes(state.status),state.message);
 let pairingUrl=await publicEntry();
 assert.ok(new URL(pairingUrl).hostname.endsWith('.trycloudflare.com'));
 assert.equal(state.preferences.hasAccessKey,false);
 let origin=new URL(pairingUrl).origin,token=new URL(pairingUrl).hash.slice(1);
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,chromiumSandbox:true});
 for(const [name,profile] of [['iphone',profiles['iPhone 13']],['android',profiles['Pixel 5']]]){
  const context=await browser.newContext({...profile,acceptDownloads:true});const page=await context.newPage();
  try{
   const deadline=Date.now()+45000;
   while(true){
    try{await page.goto(pairingUrl,{timeout:10000});break;}
    catch(error){
     if(!dnsFailure(error))throw error;
     dnsRetries++;
     if(Date.now()>=deadline)throw Error('Independent browser DNS did not recover within 45 seconds');
     await new Promise(r=>setTimeout(r,1000));
     pairingUrl=await publicEntry();origin=new URL(pairingUrl).origin;token=new URL(pairingUrl).hash.slice(1);
    }
   }
   await page.waitForURL('**/ui/');await page.getByText('Connected to your computer',{exact:true}).waitFor();
   assert.equal((await page.request.get(origin+'/push/health')).status(),200);
   for(let i=0;i<50&&(await connection.snapshot()).status!=='ready';i++)await new Promise(r=>setTimeout(r,100));
   assert.equal((await connection.snapshot()).status,'ready','Actual authenticated phone health must complete pending verification');
   assert.ok((await connection.snapshot()).pairedAt>0);
   const filename='live-'+name+'.txt',payload='Public-service acceptance '+name;
   await page.locator('#fileInput').setInputFiles({name:filename,mimeType:'text/plain',buffer:Buffer.from(payload)});
   await page.waitForFunction(()=>document.getElementById('status').textContent==='1 uploaded');assert.equal(await fs.readFile(path.join(share,filename),'utf8'),payload);
   const row=page.locator('#fileListCard .explorer-item').filter({has:page.getByText(filename,{exact:true})});await row.locator('input[type=checkbox]').check();
   const downloading=page.waitForEvent('download');await page.locator('#fileListCard').getByRole('button',{name:'Download',exact:true}).click();
   const download=await downloading;assert.equal(await fs.readFile(await download.path(),'utf8'),payload);
  }catch(error){throw Error(error.message.replaceAll(token,'<redacted>'));}
  finally{await context.close();}
  if(name==='iphone'){
   const oldUrl=pairingUrl,child=connection.client.proc;
   assert.ok(child,'a real cloudflared child must exist');child.kill('SIGTERM');
   for(let i=0;i<100&&(await connection.snapshot()).url;i++)await new Promise(r=>setTimeout(r,20));
   assert.equal((await connection.snapshot()).url,'','a terminated child must revoke the ready QR');
   for(let i=0;i<150;i++){state=await connection.snapshot();if(['ready','phone-verification','error'].includes(state.status))break;await new Promise(r=>setTimeout(r,1000));}
   assert.ok(['ready','phone-verification'].includes(state.status),state.message);
   pairingUrl=await publicEntry();assert.notEqual(new URL(pairingUrl).origin,new URL(oldUrl).origin,'recovery must obtain a fresh Quick Tunnel hostname');
   origin=new URL(pairingUrl).origin;token=new URL(pairingUrl).hash.slice(1);
  }
 }
 console.log('Independent clients encountered '+dnsRetries+' bounded DNS provisioning retries; all public authentication and exact file checks remained mandatory.');
 console.log('Verified real Cloudflare tunnel: authenticated public health probe, two mobile browser pairings, uploads and downloads across a real child termination and fresh-hostname recovery. Physical phone/Safari testing is not claimed.');
});
