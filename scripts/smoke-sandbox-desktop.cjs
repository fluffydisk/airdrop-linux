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
  if(await page.locator('#connectionWizard').count() && await page.locator('#connectionWizard').isVisible() && process.env.AIRDROP_TEST_DEVICES==='1'){
   await page.locator('#connectionWizard').waitFor({state:'visible'});
   console.log('flatpak: real first-launch device wizard is visible');
  }
  if(await page.locator('#connectionWizard').count()) {
   if(await page.locator('#connectionWizard').isVisible()) {
    await page.evaluate(()=>document.getElementById('wizardContinue').click()); // Explicit test-only dismissal for independent local checks; not authenticated onboarding.
   }
  }
  if(process.env.AIRDROP_TEST_DEVICES==='1' && !wayland){
   await page.locator('[data-view="settings"]').click();
   await page.locator('#connectionSettings').evaluate(el=>el.open=true);
   await page.locator('.lan-options').evaluate(el=>el.open=true);
   if(process.env.AIRDROP_TEST_LAN_ADDRESS)await page.locator('#lanInterface').selectOption(process.env.AIRDROP_TEST_LAN_ADDRESS);
   await page.locator('#connectLan').click();
   await page.waitForFunction(()=>document.getElementById('deviceStatus').dataset.status==='ready');
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
   if(process.env.AIRDROP_TEST_LAN_CLIENT){
    const {spawn}=require('node:child_process');
    const env={...process.env};for(const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[name];
    const client=spawn('docker',['--host=unix:///var/run/docker.sock','exec','-i',process.env.AIRDROP_TEST_LAN_CLIENT,'python3','/workspace/airdrop-linux/scripts/test-lan-client.py'],{env,stdio:['pipe','pipe','pipe']});
    client.stdin.end(state.url+'\n');let output='',errors='';client.stdout.on('data',data=>output+=data);client.stderr.on('data',data=>errors+=data);
    assert.equal(await new Promise((resolve,reject)=>{client.once('error',reject);client.once('exit',resolve);}),0,errors);
    console.log(output.trim());
   }
   // Exercise the real fragment -> pairing script -> cookie -> web UI flow in
   // another sandboxed Chromium window. This remains one worker, not a phone.
   const pairedWindow=app.waitForEvent('window');
   await app.evaluate(async({BrowserWindow,session},options)=>{
    const clientSession=session.fromPartition('airdrop-paired-test-'+Date.now());
    // Optional managed-cloud test accommodation: retain its configured proxy
    // for every external destination, except this exact owned LAN endpoint.
    // This affects only this disposable test window, never the product.
    if(options.localException)await clientSession.setProxy({mode:'fixed_servers',proxyRules:options.proxy,proxyBypassRules:new URL(options.address).host});
    clientSession.setPermissionRequestHandler((contents,permission,callback)=>callback(false));
    globalThis.pairedTestWindow=new BrowserWindow({show:true,webPreferences:{session:clientSession,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    globalThis.pairedTestWindow.loadURL(options.address);
   },{address:state.url,localException:process.env.AIRDROP_TEST_BYPASS_OWNED_LAN==='1',proxy:process.env.HTTPS_PROXY||process.env.HTTP_PROXY||''});
   const pairedPage=await pairedWindow;
   pairedPage.on('requestfailed',request=>console.log('Pairing browser request failure: '+JSON.stringify({path:new URL(request.url()).pathname,error:request.failure()?.errorText})));
   try{
    await pairedPage.waitForURL(url.origin+'/ui/');
    assert.equal(await pairedPage.evaluate(()=>location.hash),'');
    assert.equal(await pairedPage.evaluate(()=>typeof require),'undefined');
    await pairedPage.locator('#clipPaste').click();
    await pairedPage.locator('#clipManual').waitFor({state:'visible'});
    const shared='Paired browser clipboard '+Date.now();
    await pairedPage.locator('#clipText').fill(shared);
    await pairedPage.locator('#clipSendText').click();
    await pairedPage.waitForFunction(()=>document.getElementById('clipSub').textContent==='Text sent');
    assert.equal(await(await fetch('http://127.0.0.1:6001/.clipboard.txt')).text(),shared);
    await pairedPage.locator('#clipText').fill('');await pairedPage.locator('#clipCopy').click();
    await pairedPage.waitForFunction(value=>document.getElementById('clipText').value===value,shared);
    console.log('flatpak: real browser pairing redirect, session cookie, web UI and manual LAN clipboard passed (same worker)');
   }catch(error){console.log('Pairing browser diagnostics: '+JSON.stringify(await pairedPage.evaluate(()=>({path:location.pathname,title:document.title,text:document.body.innerText.slice(0,400)}))));throw error;}
   finally{await pairedPage.close();}
   await page.evaluate(()=>window.airdrop.devices('mode',{mode:'local'}));
   assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).url,'');
   console.log('flatpak: real LAN pairing, decoded QR, authenticated file/ZIP exchange and disconnect passed (same worker; not two physical devices)');
   // The public acceptance workflow also verifies historical r2 bundles.
   // Its legacy bootstrap flag selects the corresponding installed UI:
   // v1.6+ must expose the complete replacement wizard instead of VPN login.
   const legacyLogin=await page.locator('#connectTailnet').count();
   if(process.env.AIRDROP_TEST_INAPP_SETUP==='1' || (process.env.AIRDROP_TEST_TAILSCALE_BOOTSTRAP==='1' && !legacyLogin)){
    assert.equal(await page.locator('#connectTailnet').count(),0);
    assert.equal(await page.locator('#setupDevices').count(),1);
    assert.equal(await page.locator('#wizardSteps li').count(),3);
    assert.deepEqual(await page.locator('#wizardProvider option').evaluateAll(nodes=>nodes.map(n=>n.value).slice(0,3)),['internet','tailscale','lan']);
    assert.equal(await page.locator('#wizardProviderConnect').count(),1);
    assert.equal(await page.locator('#wizardProvider option[value="tailscale"]').isDisabled(),false,'the optional Tailscale provider must be included in the installed package');
    assert.equal(await page.locator('#autoConnectPreference').isChecked(),true);
    const backgroundState=await page.evaluate(()=>window.airdrop.devices('state'));
    await page.waitForFunction(expected=>document.getElementById('backgroundPreference').checked===expected,backgroundState.preferences.background);
    assert.equal(await page.locator('#advancedConnection').evaluate(el=>el.open),false);
    console.log('flatpak: installed app has the three-step in-app connection wizard, Wi-Fi/free internet choices and editable auto-connect/background preferences; Tailscale login control is absent');
    if(process.env.AIRDROP_TEST_LIVE_INTERNET==='1'){
     await page.evaluate(()=>window.airdrop.devices('mode',{mode:'internet'}));
     let publicState;
     for(let i=0;i<240;i++){
      publicState=await page.evaluate(()=>window.airdrop.devices('state'));
      if(['ready','error'].includes(publicState.status))break;
      await new Promise(resolve=>setTimeout(resolve,1000));
     }
     assert.equal(publicState.status,'ready',publicState.message);
     const publicURL=new URL(publicState.url),publicOrigin=publicURL.origin;
     assert.ok(publicURL.hostname.endsWith('.trycloudflare.com'));
     assert.equal((await fetch(publicOrigin+'/push/health')).status,401);
     const pairing=await fetch(publicOrigin+'/pair/',{method:'POST',headers:{Origin:publicOrigin},body:JSON.stringify({token:publicURL.hash.slice(1)})});
     assert.equal(pairing.status,204);const publicHeaders={Cookie:pairing.headers.get('set-cookie').split(';')[0]};
     assert.equal((await fetch(publicOrigin+'/push/health',{headers:publicHeaders})).status,200);
     const publicFile='flatpak-public-'+Date.now()+'.txt';
     assert.equal((await fetch(publicOrigin+'/push/files/'+publicFile,{method:'PUT',headers:publicHeaders,body:'real Flatpak public sharing'})).status,201);
     assert.equal(await(await fetch(publicOrigin+'/'+publicFile,{headers:publicHeaders})).text(),'real Flatpak public sharing');
     // Model a desktop-only resolver/proxy failure while the real public
     // tunnel and the paired remote client remain reachable. No response from
     // the public service or the actual backend is mocked.
     await app.evaluate(({net})=>{globalThis.publicCheckFetch=net.fetch;net.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url);if((url.hostname.endsWith('.trycloudflare.com')&&url.pathname==='/push/health')||['dns.google','cloudflare-dns.com'].includes(url.hostname))throw Object.assign(Error('Controlled desktop resolver failure'),{code:'ERR_NAME_NOT_RESOLVED'});return globalThis.publicCheckFetch(input,options);};});
     try{
      await page.locator('#deviceVerifyWithPhone').waitFor({state:'visible',timeout:25000});await page.locator('#deviceVerifyWithPhone').click();
      await page.locator('#wizardPhoneVerification').waitFor({state:'visible'});
      const waiting=await page.evaluate(()=>window.airdrop.devices('state'));assert.equal(waiting.status,'phone-verification');assert.equal(waiting.url,'');assert.equal(waiting.qr,'');
      assert.equal((await fetch(publicOrigin+'/push/health',{headers:publicHeaders})).status,200);
      await page.locator('#wizardBackground').waitFor({state:'visible'});assert.equal((await page.evaluate(()=>window.airdrop.devices('state'))).verifiedBy,'phone');
      const phoneFile='phone-'+publicFile;
      assert.equal((await fetch(publicOrigin+'/push/files/'+phoneFile,{method:'PUT',headers:publicHeaders,body:'phone-verified public sharing'})).status,201);
      assert.equal(await(await fetch(publicOrigin+'/'+phoneFile,{headers:publicHeaders})).text(),'phone-verified public sharing');
      await page.locator('#wizardBackgroundNo').click();await page.locator('#wizardPairing').waitFor({state:'visible'});await page.locator('#wizardContinue').click();
      console.log('flatpak: real Cloudflare paired-client health and upload/download confirmed phone verification despite a controlled desktop-only DNS failure; no physical phone claim');
     }finally{await app.evaluate(({net})=>{net.fetch=globalThis.publicCheckFetch;delete globalThis.publicCheckFetch;});}
     await page.evaluate(()=>window.airdrop.devices('mode',{mode:'local'}));
     console.log('flatpak: actual in-sandbox internet component download, registered Cloudflare tunnel, Electron HTTPS verification, authenticated public pairing and file upload/download passed');
     // A fresh real tunnel proves app-scoped DNS recovery independently of
     // phone verification. Only the normal desktop hostname lookup fails;
     // secure DNS and the certificate-verified HTTPS connection are real.
     await app.evaluate(({net})=>{globalThis.dnsCheckFetch=net.fetch;net.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url);if(url.hostname.endsWith('.trycloudflare.com')&&url.pathname==='/push/health'){globalThis.dnsCheckOrigin=url.origin;throw Object.assign(Error('Controlled ordinary DNS failure'),{code:'ERR_NAME_NOT_RESOLVED'});}return globalThis.dnsCheckFetch(input,options);};});
     try{
      await page.evaluate(()=>window.airdrop.devices('mode',{mode:'internet'}));let recovered;
      for(let i=0;i<240;i++){recovered=await page.evaluate(()=>window.airdrop.devices('state'));if(['ready','error'].includes(recovered.status))break;await new Promise(r=>setTimeout(r,1000));}
      if(recovered.status!=='ready'){
       const network=await app.evaluate(async({session,net})=>{
        const origin=globalThis.dnsCheckOrigin;
        const proxyKeys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].filter(key=>!!process.env[key]);
        const proxy=await session.defaultSession.resolveProxy(origin).then(value=>value.trim().toUpperCase()==='DIRECT'?'direct':'configured',()=> 'unavailable');
        const resolvers=await Promise.all(['https://cloudflare-dns.com/dns-query','https://dns.google/resolve'].map(async endpoint=>{
         const url=new URL(endpoint);url.searchParams.set('name',new URL(origin).hostname);url.searchParams.set('type','A');
         try{const response=await net.fetch(url.href,{headers:{Accept:'application/dns-json'},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});const data=await response.json();return {status:response.status,dnsStatus:data.Status,answers:data.Answer?.length||0};}catch(error){return {error:error.code||error.name};}
        }));return {proxyKeys,proxy,resolvers};
       });
       console.log('flatpak: DNS recovery failure diagnostics '+JSON.stringify({checks:recovered.diagnostics,network}));
      }
      assert.equal(recovered.status,'ready',recovered.message+' '+JSON.stringify(recovered.diagnostics));assert.equal(recovered.diagnostics.public.transport,'secure-dns');
      const recoveredURL=new URL(recovered.url),headers={Authorization:'Bearer '+recoveredURL.hash.slice(1)},name='dns-recovery-'+Date.now()+'.txt';
      assert.equal((await fetch(recoveredURL.origin+'/push/health',{headers})).status,200);
      assert.equal((await fetch(recoveredURL.origin+'/push/files/'+name,{method:'PUT',headers,body:'secure DNS recovery payload'})).status,201);
      assert.equal(await(await fetch(recoveredURL.origin+'/'+name,{headers})).text(),'secure DNS recovery payload');
      console.log('flatpak: real DNS-over-HTTPS recovery, original-host TLS certificate validation and public file upload/download passed after a controlled ordinary DNS failure');
     }finally{await app.evaluate(({net})=>{net.fetch=globalThis.dnsCheckFetch;delete globalThis.dnsCheckFetch;delete globalThis.dnsCheckOrigin;});await page.evaluate(()=>window.airdrop.devices('mode',{mode:'local'}));}
     await page.evaluate(()=>window.airdrop.devices('mode',{mode:'tailscale'}));
     let loginState;
     for(let i=0;i<80;i++){
      loginState=await page.evaluate(()=>window.airdrop.devices('state'));
      if(loginState.authURL||loginState.status==='error')break;
      await new Promise(resolve=>setTimeout(resolve,1000));
     }
     assert.ok(loginState.authURL,loginState.message);assert.equal(new URL(loginState.authURL).hostname,'login.tailscale.com');
     assert.equal(loginState.url,'');assert.equal(loginState.qr,'');
     const signingIn=app.waitForEvent('window');await page.evaluate(()=>window.airdrop.devices('provider-login'));const loginPage=await signingIn;
     const loginWindow=await app.browserWindow(loginPage);
     const loginPreferences=await loginWindow.evaluate(w=>w.webContents.getLastWebPreferences());await loginWindow.dispose();
     assert.equal(loginPreferences.sandbox,true);assert.equal(loginPreferences.contextIsolation,true);assert.equal(loginPreferences.nodeIntegration,false);assert.ok(!loginPreferences.preload);
     await loginPage.close();await page.evaluate(()=>window.airdrop.devices('mode',{mode:'local'}));
     console.log('flatpak: actual embedded Tailscale control-plane sign-in link and isolated in-app sign-in window passed; no authenticated tailnet or physical phone transfer claimed');
    }
   }
   if(process.env.AIRDROP_TEST_TAILSCALE_BOOTSTRAP==='1' && legacyLogin){
    await page.locator('#connectTailnet').click();
    // Poll a synchronous DOM condition. A promise is truthy before an async
    // IPC predicate resolves, so it must not be used as the polling predicate.
    await page.locator('#deviceLogin').waitFor({state:'visible',timeout:75000});
    const tailnet=await page.evaluate(()=>window.airdrop.devices('state'));
    assert.equal(new URL(tailnet.authURL).hostname,'login.tailscale.com');
    assert.equal(new URL(tailnet.authURL).protocol,'https:');
    assert.equal(tailnet.url,'');assert.equal(tailnet.qr,'');
    await page.locator('#deviceLogin').waitFor({state:'visible'});
    await page.evaluate(()=>window.airdrop.devices('mode',{mode:'local'}));
    console.log('flatpak: installed Electron controller started the real bundled tsnet helper and received a real browser login URL (redacted); no authenticated tailnet/HTTPS transfer claimed');
   }
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
  if(channel==='flatpak' && !wayland && await page.evaluate(()=>typeof window.airdrop.drag==='function')) {
   const name='portal-export-'+Date.now()+'.txt', payload='Native document portal copy '+Date.now();
   assert.equal((await fetch('http://127.0.0.1:6001/push/files/'+name,{method:'PUT',body:payload})).status,201);
   await app.evaluate(({BrowserWindow})=>{
    const contents=BrowserWindow.getAllWindows()[0].webContents;
    globalThis.originalNativeDrag=contents.startDrag;
    globalThis.exportedDrag=[];
    contents.startDrag=item=>{globalThis.exportedDrag=item.files;};
   });
   try {
    await page.evaluate(name=>window.airdrop.drag([name]),name);
    const exported=await app.evaluate(async()=>{
     for(let i=0;i<100;i++){if(globalThis.exportedDrag.length)return globalThis.exportedDrag;await new Promise(resolve=>setTimeout(resolve,100));}
     throw new Error('Document portal did not provide an exported drag path');
    });
    assert.equal(exported.length,1);assert.ok(exported[0].includes('/doc/'));
    // Read the exported document from outside Flatpak as another host process.
    assert.equal(await fs.readFile(exported[0],'utf8'),payload);
    console.log('flatpak: actual Documents portal exported an inherited validated FD; a host process read identical bytes; native drag delivery was intercepted, not a physical external-app drop');
   } finally {
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].webContents.startDrag=globalThis.originalNativeDrag;});
   }
  }
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
     await page.locator('details').filter({has:page.locator('#url')}).evaluate(el=>el.open=true);
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
    await page.evaluate(()=>window.airdrop.devices('preferences',{background:true}));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    assert.equal((await fetch('http://127.0.0.1:6001/push/health')).status,200);
   }
  }
  const update=await page.evaluate(()=>window.airdrop.update('check'));
  assert.equal(update.distribution,channel);
  if(channel==='flatpak'){
   const hasChannel=await app.evaluate(()=>process.getBuiltinModule('fs').existsSync('/app/share/airdrop-linux/distribution.json'));
   assert.ok((hasChannel?['current','available']:['error']).includes(update.status),update.message);
  }else assert.equal(update.status,'managed');
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
