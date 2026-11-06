'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium,devices}=require('playwright-core');
const {ShareGateway}=require('../lib/device-share');
test('mobile guest screen sends files and downloads only explicit selections', {timeout:45000}, async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'guest-browser-'));
 const gateway=new ShareGateway({guestRoot:root});await gateway.listen();let browser;
 t.after(async()=>{await browser?.close();await gateway.close();await fs.rm(root,{recursive:true,force:true});});
 await fs.writeFile(path.join(root,'private.txt'),'SECRET');await fs.writeFile(path.join(root,'selected ü.txt'),'SELECTED');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,chromiumSandbox:true});
 for(const profile of [devices['iPhone 13'],devices['Pixel 5']]){
  const session=await gateway.guest.start([path.join(root,'selected ü.txt')]);
  const context=await browser.newContext({...profile,acceptDownloads:true});const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(gateway.origin+'/guest/#'+session.token);
  await page.locator('#content').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>location.hash),'');
  assert.equal(await page.locator('#files a').count(),1);
  assert.equal(await page.locator('body').textContent().then(s=>s.includes('private.txt')),false);
  const downloading=page.waitForEvent('download');await page.locator('#files a').click();const download=await downloading;
  assert.equal(await fs.readFile(await download.path(),'utf8'),'SELECTED');
  await page.locator('#upload').setInputFiles({name:'photo.jpg',mimeType:'image/jpeg',buffer:Buffer.from('PHOTO')});
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Files received by the computer.');
  assert.equal(await fs.readFile(path.join(gateway.guest.session.inbox,'photo.jpg'),'utf8'),'PHOTO');
  const escaped=await context.request.get(gateway.origin+'/push/explorer/');assert.equal(escaped.status(),401);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  await fs.mkdir('.test-artifacts',{recursive:true});await page.screenshot({path:'.test-artifacts/guest-'+'chromium-mobile-'+profile.viewport.width+'.png',fullPage:true});
  await gateway.guest.close();await page.reload();await page.getByText('This guest session is unavailable. Ask for a new QR code.').waitFor();
  await context.close();
 }
});
