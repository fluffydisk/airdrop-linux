'use strict';
// Release-only acceptance with an isolated empty workspace and real public service.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const express=require('express'),{chromium,devices:profiles}=require('playwright-core');
const {createServer}=require('../push-server');
const {Devices}=require('../lib/devices'),{InternetConnection}=require('../lib/internet-connection');
const {assets}=require('../packaging/internet-helper.json');
test('real account-free internet tunnel pairs mobile browsers and transfers files', {timeout:180000,skip:process.env.AIRDROP_TEST_LIVE_INTERNET!=='1'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-live-internet-')),share=path.join(root,'files');await fs.mkdir(share);
 const service=createServer({watchDir:share,stateDir:path.join(root,'push'),watch:false});
 const app=express();app.use('/push',service.app);app.use('/ui',express.static(path.resolve('ui')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 const connection=new Devices({directory:path.join(root,'connections'),backend:'http://127.0.0.1:'+server.address().port,
  createInternetClient:options=>new InternetConnection({...options,directory:path.join(root,'runtime'),asset:assets[process.arch]})});
 t.after(async()=>{await browser?.close();await connection.stop();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 await connection.initialize();await connection.queue;await connection.action('internet');
 let state;
 for(let i=0;i<130;i++){state=await connection.snapshot();if(['ready','phone-verification','error'].includes(state.status))break;await new Promise(r=>setTimeout(r,1000));}
 assert.ok(['ready','phone-verification'].includes(state.status),state.message);
 const pairingUrl=state.status==='ready'?state.url:state.verificationUrl;
 assert.ok(new URL(pairingUrl).hostname.endsWith('.trycloudflare.com'));
 assert.equal(state.preferences.hasAccessKey,false);
 const origin=new URL(pairingUrl).origin,token=new URL(pairingUrl).hash.slice(1);
 assert.equal((await fetch(origin+'/push/health')).status,401);
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,chromiumSandbox:true});
 for(const [name,profile] of [['iphone',profiles['iPhone 13']],['android',profiles['Pixel 5']]]){
  const context=await browser.newContext({...profile,acceptDownloads:true});const page=await context.newPage();
  try{
   await page.goto(pairingUrl);await page.waitForURL('**/ui/');await page.getByText('Connected to your computer',{exact:true}).waitFor();
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
 }
 console.log('Verified real Cloudflare tunnel: authenticated public health probe, two mobile browser pairings, uploads and downloads. Physical phone/Safari testing is not claimed.');
});
