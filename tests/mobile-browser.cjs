'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const express=require('express'),{chromium,devices:profiles}=require('playwright-core');
const {createServer}=require('../push-server');
const {Devices}=require('../lib/devices'),{lanAddresses}=require('../lib/device-share');

test('iPhone and Android browser layouts pair without setup fields, upload and download real files', {timeout:60000},async t=>{
 const address=lanAddresses()[0]?.address;if(!address){t.skip('No private LAN interface');return;}
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-mobile-ui-')),share=path.join(root,'files');await fs.mkdir(share);
 const service=createServer({watchDir:share,stateDir:path.join(root,'push'),watch:false});
 const app=express();app.use('/push',service.app);app.use('/ui',express.static(path.resolve('ui')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const connection=new Devices({directory:path.join(root,'connections'),backend:'http://127.0.0.1:'+server.address().port});
 let browser,phase='starting local connection';
 t.after(async()=>{await browser?.close();await connection.stop();service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 await connection.initialize();await connection.queue;await connection.action('lan',address);await connection.checkTask;
 const state=await connection.snapshot();assert.equal(state.status,'ready',state.message);
 phase='launching browser';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,chromiumSandbox:true,timeout:20000});
 browser.on('disconnected',()=>console.log('Mobile browser disconnected during '+phase));
 for(const [name,profile] of [['iphone',profiles['iPhone 13']],['android',profiles['Pixel 5']]]){
  const context=await browser.newContext({...profile,acceptDownloads:true,...((process.env.HTTPS_PROXY||process.env.HTTP_PROXY)?{proxy:{server:process.env.HTTPS_PROXY||process.env.HTTP_PROXY,bypass:address}}:{})});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
  phase=name+' pairing';console.log('Mobile acceptance: '+phase);
  await page.goto(state.url);try { await page.waitForURL('**/ui/', {timeout:10000}); } catch(error) { console.log('Pairing diagnostics',JSON.stringify({path:new URL(page.url()).pathname,text:(await page.locator('body').textContent()).slice(0,500),errors}));throw error; }await page.getByText('Connected to your computer',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>location.hash),'');assert.ok((await connection.snapshot()).pairedAt>0);
  assert.equal(await page.locator('input[type=password]').count(),0);
  const filename=name+' photo ü.txt',payload='A real '+name+' browser transfer';
  phase=name+' upload';console.log('Mobile acceptance: '+phase);
  await page.locator('#fileInput').setInputFiles({name:filename,mimeType:'text/plain',buffer:Buffer.from(payload)});
  await page.waitForFunction(()=>document.getElementById('status').textContent==='1 uploaded');assert.equal(await fs.readFile(path.join(share,filename),'utf8'),payload);
  phase=name+' download';console.log('Mobile acceptance: '+phase);
  const row=page.locator('#fileListCard .explorer-item').filter({has:page.getByText(filename,{exact:true})});await row.locator('input[type=checkbox]').check();
  const responses=[];page.on('response',r=>{if(new URL(r.url()).pathname.includes('/download'))responses.push({status:r.status(),disposition:r.headers()['content-disposition']||''});});const downloading=page.waitForEvent('download',{timeout:8000});await page.locator('#fileListCard').getByRole('button',{name:'Download',exact:true}).click();let download;try{download=await downloading;}catch(error){console.log('Download diagnostics',JSON.stringify({responses,status:await page.locator('.explorer-status').textContent(),errors}));await page.screenshot({path:'/tmp/airdrop-mobile-download-failure.png',fullPage:true});throw error;}
  assert.equal(await fs.readFile(await download.path(),'utf8'),payload);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await fs.mkdir('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/mobile-'+name+'.png',fullPage:true});
  assert.deepEqual(errors,[]);await context.close();
 }
});
