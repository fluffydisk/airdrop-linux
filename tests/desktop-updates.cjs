'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { _electron: electron } = require('playwright-core');
const executable = process.env.ELECTRON_PATH || require('../desktop/node_modules/electron');
test('Electron update screen: stable discovery, package ownership, offline recovery, preferences and responsive keyboard navigation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-update-screen-'));
  await fs.mkdir(path.join(root, 'files'));
  const receipt = path.join(root, 'distribution.json'); await fs.writeFile(receipt, '{"source":"apt"}');
  const launch = () => electron.launch({ executablePath: executable, chromiumSandbox: true,
    args: [...(process.env.ELECTRON_PATH ? [] : [path.resolve('desktop')]), '--ozone-platform=' + (process.env.AIRDROP_TEST_OZONE || 'x11')],
    env: {...process.env,AIRDROP_HOME:root,AIRDROP_INSTALL_MANIFEST:receipt,AIRDROP_DISABLE_TRAY:'1',AIRDROP_DISABLE_UPDATE_CHECK:'1'}, timeout:20000 });
  let app;
  t.after(async () => { await app?.close().catch(()=>{}); await fs.rm(root,{recursive:true,force:true}); });
  app = await launch(); let page = await app.firstWindow();
  await page.setViewportSize({width:1080,height:840});
  await page.locator('#wizardContinue').waitFor(); await page.locator('#wizardContinue').click();
  await page.locator('[data-view="settings"]').click();
  await page.waitForFunction(()=>document.getElementById('updateDistribution').textContent==='DEB / APT');
  await app.evaluate(({net})=>{net.fetch=async()=>({ok:true,status:200,json:async()=>({tag_name:'v99.0.0',body:'Test release notes <script>unsafe()</script>',assets:[]})});});
  await page.locator('#checkUpdate').click();
  await page.waitForFunction(()=>document.getElementById('updateState').textContent.includes('99.0.0'));
  assert.equal(await page.locator('#installUpdate').isVisible(),false);
  assert.equal(await page.locator('#updateNotes script').count(),0);
  assert.match(await page.locator('#updateInstructions').textContent(),/apt.*package manager/s);
  await page.locator('#copyUpdateInstructions').click();
  assert.match(await app.evaluate(({clipboard})=>clipboard.readText()),/sudo apt update/);
  await page.locator('#automaticUpdates').uncheck();
  await page.waitForFunction(()=>!document.getElementById('automaticUpdates').checked);
  // The IPC call must finish writing before restart.
  await page.waitForFunction(async()=>!(await window.airdrop.update('state')).automatic);
  await app.evaluate(({net})=>{net.fetch=async()=>{throw Error('Offline test: reconnect and retry');};});
  await page.locator('#checkUpdate').click();
  await page.waitForFunction(()=>document.getElementById('updateState').dataset.status==='error');
  assert.match(await page.locator('#updateState').textContent(),/Offline test/);
  assert.equal(await page.locator('#checkUpdate').isEnabled(),true);
  for(const theme of ['light','dark']){
    await page.locator('[data-theme-choice="'+theme+'"]').click();
    for(const width of [620,1080,1440]){
      await page.setViewportSize({width,height:840});
      for(const view of ['transfer','files','clipboard','settings']){
        await page.locator('[data-view="'+view+'"]').click();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view+' '+width+' '+theme);
        assert.equal(await page.locator('#view-'+view+' h1').evaluate(el=>el===document.activeElement),true);
      }
    }
  }
  assert.equal(await page.evaluate(()=>typeof require),'undefined');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox),true);
  await app.close(); app = await launch(); page = await app.firstWindow();
  await page.locator('#wizardContinue').waitFor(); await page.locator('#wizardContinue').click();
  await page.locator('[data-view="settings"]').click();
  await page.waitForFunction(async()=>!(await window.airdrop.update('state')).automatic);
  assert.equal(await page.locator('#automaticUpdates').isChecked(),false);
});
