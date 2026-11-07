'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright-core');
(async()=>{
 const root=process.env.AIRDROP_UPGRADE_ROOT,version=process.env.AIRDROP_EXPECT_VERSION;
 assert.ok(root && version);
 await fs.mkdir(path.join(root,'files'),{recursive:true});
 const file=path.join(root,'files/retained-upgrade.txt');
 const exists=await fs.access(file).then(()=>true,()=>false);
 if(!exists){await fs.writeFile(file,'existing user data');await fs.writeFile(path.join(root,'files/.clipboard.txt'),'existing shared clipboard');}
 const app=await electron.launch({executablePath:'/usr/lib/airdrop-linux/desktop/Airdrop',chromiumSandbox:true,args:['--ozone-platform=x11'],env:{...process.env,AIRDROP_HOME:root,AIRDROP_INSTALL_MANIFEST:'/usr/lib/airdrop-linux/distribution.json',AIRDROP_DISABLE_TRAY:'1',AIRDROP_DISABLE_UPDATE_CHECK:'1'},timeout:20000});
 try {
  const page=await app.firstWindow();
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox),true);
  assert.equal(await page.evaluate(()=>window.airdrop.loadClipboard()),'existing shared clipboard');
  if(exists) assert.equal(await page.evaluate(()=>localStorage.getItem('airdrop-theme')),'dark');
  else await page.evaluate(()=>localStorage.setItem('airdrop-theme','dark'));
  assert.equal(await fs.readFile(file,'utf8'),'existing user data');
  console.log('Installed desktop',version,'retains files, shared clipboard and theme; sandbox enabled');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
