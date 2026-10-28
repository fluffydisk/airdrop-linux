'use strict';
// Real X11 input between two processes on a disposable display. No physical
// desktop or authenticated tailnet is claimed. Run with a 1800x1000 Xvfb screen.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const http=require('node:http'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {_electron:electron,chromium}=require('playwright-core');
const execute=promisify(execFile);
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-native-drag-'));let app,browser;
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"push":true,"share":true}');});
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const name='native drop ü.txt',payload='Two-process drag payload '+Date.now();
 try{
  await fs.mkdir(path.join(root,'files'));await fs.writeFile(path.join(root,'files',name),payload);
  const executable=process.env.ELECTRON_PATH||require('../desktop/node_modules/electron');
  app=await electron.launch({executablePath:executable,chromiumSandbox:true,args:[...(process.env.ELECTRON_PATH?[]:[path.resolve('desktop')]),'--ozone-platform=x11'],env:{...process.env,AIRDROP_HOME:root,AIRDROP_DISABLE_TRAY:'1',AIRDROP_DISABLE_UPDATE_CHECK:'1',AIRDROP_FILE_PORT:String(server.address().port),AIRDROP_API_PORT:String(server.address().port)},timeout:30000});
  const source=await app.firstWindow();
  // Independent local functionality test, not a production onboarding bypass.
  if ((await source.evaluate(()=>window.airdrop.devices('state'))).setupRequired) { await source.locator('#connectionWizard').waitFor({state:'visible'}); await source.evaluate(()=>document.getElementById('connectionWizard').close()); }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:0,y:0,width:780,height:760}));
  await source.locator('[data-view="files"]').click();
  const row=source.locator('.explorer-item').filter({hasText:name});await row.scrollIntoViewIfNeeded();
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:false,chromiumSandbox:true,args:['--ozone-platform=x11','--window-position=850,0','--window-size=800,760']});
  const context=await browser.newContext({viewport:null});const target=await context.newPage();
  await target.setContent('<!doctype html><title>Airdrop native drop receiver</title><body style="margin:0;padding:50px;font:24px sans-serif;background:#dff0ff"><h1>Drop receiver</h1><p>Waiting for native file data</p><script>document.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect="copy";};document.ondrop=async e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)window.received={name:f.name,payload:await f.text()};};</script>');
  const point=await row.evaluate(el=>{const b=el.getBoundingClientRect();return {x:Math.round(screenX+b.x+b.width/2),y:Math.round(screenY+outerHeight-innerHeight+b.y+b.height/2)};});
  const destination=await target.evaluate(()=>({x:Math.round(screenX+innerWidth/2),y:Math.round(screenY+outerHeight-innerHeight+innerHeight/2)}));
  assert.ok(destination.x>800,'Use a wide Xvfb display so receiver does not cover the source');
  await execute(process.env.XDOTOOL_PATH||'xdotool',['mousemove','--sync',String(point.x),String(point.y),'mousedown','1','sleep','0.2','mousemove','--sync',String(point.x+30),String(point.y+10),'sleep','1','mousemove','--sync',String(destination.x),String(destination.y),'sleep','0.7','mouseup','1'],{timeout:15000});
  await target.waitForFunction(()=>!!window.received,null,{timeout:15000});
  assert.deepEqual(await target.evaluate(()=>window.received),{name,payload});
  assert.equal(await fs.readFile(path.join(root,'files',name),'utf8'),payload);
  console.log('PASS: actual X11 pointer drag from Airdrop to a separate Chromium process delivered the original Unicode filename and exact bytes; source file retained. Virtual display, not physical Omarchy/Wayland.');
 }finally{
  if(app)await app.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
