'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron:electron}=require('playwright-core'),express=require('express');
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
 assert.equal(await page.locator('#relayUrl').isVisible(),false);assert.equal(await page.locator('#wizardBackground').isVisible(),false);assert.equal(await page.locator('#wizardPairing').isVisible(),false);
 await page.locator('#wizardProvider').selectOption('lan');await page.locator('#wizardProviderConnect').click();await page.locator('#wizardBackground').waitFor({state:'visible'});
 assert.match(await page.locator('#wizardBackground').textContent(),/change this anytime in Settings/);
 assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).setupComplete,false);
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
test('Electron Flatpak requests background access after connection and opt-in; denial is explained and settings stay off', {timeout:30000},async t=>{
 if(!lanAddresses().length){t.skip('No private LAN interface');return;}
 const f=await fixture(t,'flatpak'),{app,page}=await f.launch();
 await page.locator('#wizardProvider').selectOption('lan');await page.locator('#wizardProviderConnect').click();await page.locator('#wizardBackground').waitFor({state:'visible'});
 assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).background.active,false);
 await page.locator('#wizardBackgroundYes').click();await page.locator('#wizardPairing').waitFor({state:'visible'});
 assert.match(await page.locator('#wizardBackgroundSummary').textContent(),/not granted/);
 const state=await page.evaluate(()=>window.airdrop.devices('state'));assert.equal(state.preferences.background,false);assert.equal(state.background.active,false);assert.equal(state.setupComplete,true);
 const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;
});
