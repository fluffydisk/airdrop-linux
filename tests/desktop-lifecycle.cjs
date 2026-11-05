'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron:electron}=require('playwright-core'),express=require('express');
const http=require('node:http');
const {createServer}=require('../push-server');
const {lanAddresses}=require('../lib/device-share');
const executable=process.env.ELECTRON_PATH||require('../desktop/node_modules/electron');
async function fixture(t,source){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-connection-ui-')),share=path.join(root,'files');await fs.mkdir(share);let app;
 const service=createServer({watchDir:share,stateDir:path.join(root,'push'),watch:false});const backend=express();backend.use('/push',service.app);
 const server=backend.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 if(source)await fs.writeFile(path.join(root,'distribution.json'),JSON.stringify({source}));
 t.after(async()=>{await app?.close().catch(()=>{});service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 return {root,async launch(){app=await electron.launch({executablePath:executable,chromiumSandbox:true,args:[path.resolve('desktop'),'--ozone-platform='+(process.env.AIRDROP_TEST_OZONE||'headless')],env:{...process.env,AIRDROP_HOME:root,AIRDROP_SHARE_DIR:share,AIRDROP_API_PORT:String(server.address().port),AIRDROP_DESKTOP_USER_DATA:path.join(root,'desktop'),AIRDROP_DISABLE_TRAY:'1',AIRDROP_DISABLE_UPDATE_CHECK:'1',...(source?{AIRDROP_INSTALL_MANIFEST:path.join(root,'distribution.json')}:{})},timeout:20000});return {app,page:await app.firstWindow()};}};
}
test('Electron first-run wizard connects first, asks background next, then shows phone pairing and persists the choice', {timeout:60000},async t=>{
 if(!lanAddresses().length){t.skip('No private LAN interface');return;}
 const f=await fixture(t);let {app,page}=await f.launch();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.locator('#wizardProvider').waitFor({state:'visible'});assert.equal(await page.locator('#wizardProvider').inputValue(),'internet');
 await page.waitForFunction(()=>document.getElementById('backgroundHint').textContent.includes('stays active'));
 assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).preferences.background,true);
 assert.equal(await page.locator('#relayUrl').isVisible(),false);assert.equal(await page.locator('#wizardBackground').isVisible(),false);assert.equal(await page.locator('#wizardPairing').isVisible(),false);
 await page.locator('#wizardProvider').selectOption('lan');await page.locator('#wizardProviderConnect').click();await page.locator('#wizardBackground').waitFor({state:'visible'});
 assert.match(await page.locator('#wizardBackground').textContent(),/change this anytime in Settings/);
 assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).setupComplete,false);
 const beforeClose=await page.evaluate(()=>window.airdrop.devices('state'));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).url,beforeClose.url);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await fs.mkdir('.test-artifacts',{recursive:true});await page.setViewportSize({width:1080,height:840});await page.screenshot({path:'.test-artifacts/wizard-background.png'});
 await page.locator('#wizardBackgroundNo').click();await page.locator('#wizardPairing').waitFor({state:'visible'});
 let state=await page.evaluate(()=>window.airdrop.devices('state'));assert.equal(state.setupComplete,true);assert.equal(state.preferences.background,false);assert.equal(state.status,'ready');
 assert.match(await page.locator('#wizardNetworkHint').textContent(),/same trusted Wi-Fi/);
 await page.screenshot({path:'.test-artifacts/wizard-pairing.png'});
 await page.locator('#wizardContinue').click();await page.locator('#sharingStatus').click();
 await page.locator('#backgroundPreference').check();await page.waitForFunction(()=>document.getElementById('backgroundHint').textContent.includes('stays active'));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await page.locator('#backgroundPreference').uncheck();await page.waitForFunction(()=>document.getElementById('backgroundHint').textContent.includes('stops when you close'));
 const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;
 ({app,page}=await f.launch());await page.waitForFunction(()=>document.getElementById('sharingStatus').textContent==='Connected');
 // A reconnect overlay can appear while the saved connection starts; dismiss it.
 if(await page.locator('#connectionWizard').isVisible())await page.locator('#wizardContinue').click();
 state=await page.evaluate(()=>window.airdrop.devices('state'));assert.equal(state.mode,'lan');assert.equal(state.setupComplete,true);assert.equal(state.preferences.background,false);assert.equal(state.preferences.autoConnect,true);
 await page.locator('#sharingStatus').click();await page.locator('#autoConnectPreference').uncheck();await page.waitForFunction(()=>document.getElementById('connectionPreferencesResult').textContent==='Connection preferences saved.');
 await page.locator('#setupDevices').click();await page.locator('#wizardPairing').waitFor({state:'visible'});
 assert.deepEqual(errors,[]);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox),true);
});
test('Electron Flatpak default background and wizard retry both honor OS denial and keep settings off', {timeout:30000},async t=>{
 if(!lanAddresses().length){t.skip('No private LAN interface');return;}
 const f=await fixture(t,'flatpak'),{app,page}=await f.launch();
 await page.locator('#wizardProvider').selectOption('lan');await page.locator('#wizardProviderConnect').click();await page.locator('#wizardBackground').waitFor({state:'visible'});
 assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).background.active,false);
 await page.locator('#wizardBackgroundYes').click();await page.locator('#wizardPairing').waitFor({state:'visible'});
 assert.match(await page.locator('#wizardBackgroundSummary').textContent(),/not granted/);
 const state=await page.evaluate(()=>window.airdrop.devices('state'));assert.equal(state.preferences.background,false);assert.equal(state.background.active,false);assert.equal(state.setupComplete,true);
 const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;
});
test('Electron automatically shows phone verification after desktop DNS failure and advances only after real paired health', {timeout:30000},async t=>{
 const f=await fixture(t),{app,page}=await f.launch();
 await page.locator('#wizardProvider').waitFor({state:'visible'});
 // Controlled provider/DNS responses isolate this UI test from public-service
 // availability. Pairing and backend health below use the real local gateway.
 await app.evaluate(({app,net})=>{
  const requireApp=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/main.js');
  const Internet=requireApp('./core/lib/internet-connection').InternetConnection;
  Internet.prototype.start=function(){globalThis.phoneGateway={target:this.target,host:this.proxyHost};this.onState({status:'checking',origin:'https://controlled.trycloudflare.com',message:'Controlled registered tunnel'});};Internet.prototype.stop=async()=>{};
  const Devices=requireApp('./core/lib/devices').Devices,check=Devices.prototype.check;
  Devices.prototype.check=function(...args){this.verificationAttempts=4;this.verificationDelay=0;return check.apply(this,args);};
  const fetch=net.fetch;net.fetch=async(input,options)=>{const hostname=new URL(String(input)).hostname;if(hostname==='controlled.trycloudflare.com'||['cloudflare-dns.com','dns.google'].includes(hostname))throw Object.assign(Error('Controlled DNS failure with private text'),{code:'ERR_NAME_NOT_RESOLVED'});return fetch(input,options);};
 });
 await page.locator('#wizardProviderConnect').click();await page.locator('#wizardPhoneVerification').waitFor({state:'visible'});
 await page.locator('#wizardDiagnostics').evaluate(el=>el.open=true);await page.locator('#wizardCopyDiagnostics').click();
 const report=JSON.parse(await app.evaluate(({clipboard})=>clipboard.readText()));assert.equal(report.checks.local.status,'passed');assert.equal(report.checks.public.code,'DNS');assert.ok(!JSON.stringify(report).includes('private text'));assert.ok(!JSON.stringify(report).includes('trycloudflare.com'));
 const candidate=await page.evaluate(()=>window.airdrop.devices('state'));assert.equal(candidate.status,'phone-verification');assert.equal(candidate.url,'');assert.equal(await page.locator('#wizardBackground').isVisible(),false);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 const transport=await app.evaluate(()=>globalThis.phoneGateway),origin=new URL(candidate.verificationUrl).origin;
 function request(route,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{const req=http.request(new URL(route,transport.target),{method,headers:{Host:transport.host,...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.end(body);});}
 const paired=await request('/pair/',{method:'POST',headers:{Origin:origin},body:JSON.stringify({token:new URL(candidate.verificationUrl).hash.slice(1)})});assert.equal(paired.status,204);
 assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).status,'phone-verification');
 assert.equal((await request('/push/health',{headers:{Cookie:paired.headers['set-cookie'][0].split(';')[0]}})).status,200);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await page.locator('#wizardBackground').waitFor({state:'visible'});assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).verifiedBy,'phone');
 await page.locator('#wizardBackgroundNo').click();await page.locator('#wizardPairing').waitFor({state:'visible'});
 assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).setupComplete,true);
});
