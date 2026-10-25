'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {_electron:electron}=require('playwright-core');
(async()=>{
 const channel=process.argv[2];
 if(!['flatpak','snap'].includes(channel))throw new Error('Usage: smoke-sandbox-desktop.cjs flatpak|snap');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-sandbox-ui-'));
 let app;
 try{
  let executable='/snap/bin/airdrop-linux';
  if(channel==='flatpak'){
   executable=path.join(temp,'flatpak-airdrop');
   await fs.writeFile(executable,'#!/bin/sh\nif [ -n "${AIRDROP_TEST_HOME-}" ]; then\n exec flatpak run --user --env=AIRDROP_HOME="$AIRDROP_TEST_HOME" io.github.fluffydisk.airdrop-linux "$@"\nfi\nexec flatpak run --user io.github.fluffydisk.airdrop-linux "$@"\n',{mode:0o755});
  }
  const wayland=process.env.AIRDROP_TEST_WAYLAND==='1';
  const launchEnv={...process.env,AIRDROP_DISABLE_TRAY:'1'};
  if(wayland)delete launchEnv.DISPLAY;
  const args=wayland?['--ozone-platform=wayland','--disable-gpu','--enable-logging=stderr']:['--ozone-platform=x11'];
  app=await electron.launch({executablePath:executable,chromiumSandbox:true,args,env:launchEnv,timeout:60000});
  const page=await app.firstWindow();
  await page.waitForFunction(()=>document.getElementById('health').dataset.status==='ready',{},{timeout:30000});
  if(process.env.AIRDROP_TEST_DEVICES==='1' && !(await page.evaluate(()=>window.airdrop.devices('state'))).configured){
   await page.locator('#connectionWizard').waitFor({state:'visible'});
   console.log('flatpak: real first-launch device wizard is visible');
  }
  if(await page.locator('#connectionWizard').count()) {
   if(await page.locator('#connectionWizard').isVisible())await page.evaluate(()=>document.getElementById('wizardLocal').click());
  }
  if(process.env.AIRDROP_TEST_DEVICES==='1' && !wayland){
   await page.locator('[data-view="connect"]').click();
   await page.locator('#connectLan').click();
   await page.waitForFunction(async()=>(await window.airdrop.devices('state')).status==='ready');
   const state=await page.evaluate(()=>window.airdrop.devices('state'));
   assert.equal(state.status,'ready',state.message);
   assert.ok(!state.url.includes('127.0.0.1'));
   await page.waitForFunction(url=>document.getElementById('deviceAddress').value===url,state.url);
   await page.locator('#copyDeviceAddress').click();
   assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),state.url);
   const {PNG}=require('pngjs'),decode=require('jsqr');
   const image=PNG.sync.read(Buffer.from(state.qr.split(',')[1],'base64'));
   assert.equal(decode(new Uint8ClampedArray(image.data),image.width,image.height).data,state.url);
   const url=new URL(state.url),token=url.hash.slice(1);
   const pair=await fetch(url.origin+'/pair/',{method:'POST',headers:{Origin:url.origin},body:JSON.stringify({token})});
   assert.equal(pair.status,204);const headers={Cookie:pair.headers.get('set-cookie').split(';')[0]};
   assert.equal((await fetch(url.origin+'/push/health',{headers})).status,200);
   assert.equal((await fetch(url.origin+'/ui/',{headers})).status,200);
   assert.equal((await fetch(url.origin+'/push/health')).status,401);
   const name='paired-flatpak-'+Date.now()+'.txt';
   assert.equal((await fetch(url.origin+'/push/files/'+name,{method:'PUT',headers,body:'paired device payload'})).status,201);
   assert.equal(await(await fetch(url.origin+'/'+name,{headers})).text(),'paired device payload');
   const archive=await fetch(url.origin+'/push/archive',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({files:[name]})});
   const JSZip=require('jszip');assert.equal(await(await JSZip.loadAsync(Buffer.from(await archive.arrayBuffer()))).file(name).async('string'),'paired device payload');
   await page.evaluate(()=>window.airdrop.devices('mode',{mode:'local'}));
   assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).url,'');
   console.log('flatpak: real LAN pairing, decoded QR, authenticated file/ZIP exchange and disconnect passed (same worker; not two physical devices)');
  }
  if(process.env.AIRDROP_TEST_SCREENSHOT)await page.screenshot({path:process.env.AIRDROP_TEST_SCREENSHOT,fullPage:true});
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox),true);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().contextIsolation),true);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().nodeIntegration),false);
  assert.equal(await page.evaluate(()=>typeof require),'undefined');
  assert.equal(await app.evaluate(({app})=>app.commandLine.hasSwitch('no-sandbox')),false);
  const versions=await app.evaluate(({app})=>({app:app.getVersion(),electron:process.versions.electron,chromium:process.versions.chrome,embeddedNode:process.versions.node,arch:process.arch}));
  if(process.env.AIRDROP_TEST_ELECTRON_VERSION)assert.equal(versions.electron,process.env.AIRDROP_TEST_ELECTRON_VERSION,'Running Electron must match the selected reference runtime');
  console.log('Runtime versions: '+JSON.stringify(versions));
  assert.equal(await app.evaluate(({app})=>app.commandLine.getSwitchValue('class')),'io.github.fluffydisk.airdrop-linux');
  if(channel==='flatpak')assert.equal(await app.evaluate(()=>process.env.FLATPAK_ID),'io.github.fluffydisk.airdrop-linux');
  if(wayland) {
   assert.equal(await app.evaluate(()=>process.env.DISPLAY),undefined);
   assert.ok(await app.evaluate(()=>process.env.WAYLAND_DISPLAY));
   // A headless compositor has no physical input seat. Real Wayland clipboard
   // ownership and file/background portal consent need an interactive session.
  } else {
   const clipboardText='Airdrop sandbox clipboard '+Date.now();
   await page.evaluate(text=>window.airdrop.copyClipboard(text),clipboardText);
   assert.equal(await page.evaluate(()=>window.airdrop.readClipboard()),clipboardText);
   if(process.env.AIRDROP_TEST_CONNECTION==='1') {
    assert.match(await page.locator('#health').textContent(),/Local workspace ready/);
    await page.evaluate(text=>window.airdrop.shareClipboard(text),clipboardText);
    assert.equal(await page.evaluate(()=>window.airdrop.loadClipboard()),clipboardText);
    assert.equal(await(await fetch('http://127.0.0.1:6001/.clipboard.txt')).text(),clipboardText);
    // Controlled transport responses test IPC/UI behavior, not real Tailscale.
    await app.evaluate(async ({app,net})=>{
     const fs=process.getBuiltinModule('fs').promises,path=process.getBuiltinModule('path');
     const file=path.join(app.getPath('userData'),'settings.json');
     globalThis.connectionFixture={file,saved:await fs.readFile(file).catch(()=>null),fetch:net.fetch};
     await fs.rm(file,{force:true});
    });
    try {
     assert.equal((await page.evaluate(()=>window.airdrop.checkConnection())).status,'not-configured');
     await page.locator('[data-view="settings"]').click();
     await page.locator('#url').fill('https://reference-test.example.ts.net/');
     await page.locator('#saveUrl').click();
     await page.waitForFunction(()=>document.getElementById('settingsResult').textContent.includes('Connection has not been checked'));
     await app.evaluate(({net})=>{net.fetch=async()=>Response.json({push:true,share:true});});
     await page.locator('#checkConnection').click();
     await page.waitForFunction(()=>document.getElementById('connectionResult').textContent.includes('another device is not verified'));
     await app.evaluate(({net})=>{net.fetch=async()=>{throw new Error('Controlled TLS failure');};});
     await page.locator('#checkConnection').click();
     await page.waitForFunction(()=>document.getElementById('connectionResult').textContent.includes('could not be reached securely'));
     assert.equal((await fetch('http://127.0.0.1:6001/push/health')).status,200);
     assert.equal(await page.evaluate(()=>window.airdrop.loadClipboard()),clipboardText);
     await app.evaluate(({dialog,shell})=>{
      globalThis.connectionFixture.dialog=dialog.showMessageBox;globalThis.connectionFixture.open=shell.openExternal;
      globalThis.connectionOpens=[];globalThis.connectionChoice=2;
      dialog.showMessageBox=async (...args)=>{const options=args.at(-1);if(!options.buttons.includes('Open local web app'))throw new Error('Missing local fallback');return {response:globalThis.connectionChoice};};
      shell.openExternal=async url=>{globalThis.connectionOpens.push(url);};
     });
     await page.evaluate(()=>window.airdrop.pwa());
     assert.deepEqual(await app.evaluate(()=>globalThis.connectionOpens),[]);
     await app.evaluate(()=>{globalThis.connectionChoice=0;});
     await page.evaluate(()=>window.airdrop.pwa());
     assert.deepEqual(await app.evaluate(()=>globalThis.connectionOpens),['http://127.0.0.1:6001/ui/']);
     console.log('flatpak: real shared clipboard/HTTP contents passed; controlled connection UI, failure isolation and local fallback passed (not a real Tailscale test)');
    } finally {
     await app.evaluate(async ({net,dialog,shell})=>{
      const fixture=globalThis.connectionFixture,fs=process.getBuiltinModule('fs').promises;net.fetch=fixture.fetch;
      if(fixture.dialog)dialog.showMessageBox=fixture.dialog;
      if(fixture.open)shell.openExternal=fixture.open;
      if(fixture.saved)await fs.writeFile(fixture.file,fixture.saved,{mode:0o600});else await fs.rm(fixture.file,{force:true});
      delete globalThis.connectionFixture;
     });
    }
   }
  }
  if(channel==='snap') {
   const background=process.argv[3]==='background';
   assert.equal(await app.evaluate(()=>process.env.AIRDROP_SNAP_BACKGROUND),background?'1':'0');
   if(background) {
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    assert.equal((await fetch('http://127.0.0.1:6001/push/health')).status,200);
   }
  }
  const update=await page.evaluate(()=>window.airdrop.update('check'));
  assert.equal(update.distribution,channel);assert.equal(update.status,'managed');
  if(channel==='snap' && process.argv[3]!=='background') {
   const closed=app.waitForEvent('close',{timeout:15000});
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()).catch(error=>{if(!/closed/i.test(error.message))throw error;});
   await closed;app=null;
  } else {await app.close();app=null;}
  for(let i=0;i<50;i++){
   const running=await fetch('http://127.0.0.1:6001/push/health').then(()=>true,()=>false);
   if(!running){console.log(channel+': sandboxed desktop ready, managed updates and quit lifecycle passed');return;}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('Quit did not stop the bundled backend');
 }finally{if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
