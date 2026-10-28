'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const {JSDOM} = require('jsdom');
const {openFolder, dragFiles} = require('../desktop/file-integration');
const explorer = require('../lib/explorer');
const {parseClipboardFiles,readClipboardFiles} = require('../desktop/clipboard');
const {Devices} = require('../lib/devices');
const {ShareGateway} = require('../lib/device-share');

test('folder integration uses a portal helper inside Flatpak and reports native failures', async () => {
  let call;
  await openFolder('/var/data/files ü', {flatpak:true,execute:async(...args)=>{call=args;}});
  assert.equal(call[0],'/app/bin/airdrop-open-directory');assert.deepEqual(call[1],['/var/data/files ü']);
  await assert.rejects(openFolder('/safe',{flatpak:false,shell:{openPath:async()=> 'No file manager'}}),/No file manager/);
});
test('native drag validates every file and rejects links, traversal, folders and oversized selections', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-drag-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'ü.txt'),'drag payload');await fs.mkdir(path.join(root,'folder'));await fs.symlink('/etc/passwd',path.join(root,'outside'));
  let dragged;await dragFiles(root,['ü.txt'],explorer,files=>{dragged=files;});assert.deepEqual(dragged,[path.join(root,'ü.txt')]);
  for(const files of [[],['../etc/passwd'],['outside'],['folder'],['ü.txt','outside'],Array(101).fill('ü.txt')])await assert.rejects(dragFiles(root,files,explorer,()=>assert.fail('Unsafe drag')));
});
test('clipboard files are format-qualified local URIs; cut never deletes originals', async () => {
  assert.deepEqual(parseClipboardFiles('cut\nfile:///tmp/a%20b.txt\n'),['/tmp/a b.txt']);
  for(const value of ['https://example.com/f','file://evil.test/a','file:///tmp/a#token','file:///tmp/a?x=1'])assert.throws(()=>parseClipboardFiles(value));
  assert.equal(await readClipboardFiles({read:async()=>[{types:['text/plain'],getType:async()=>new Blob(['file:///etc/passwd'])}]}),null);
  assert.deepEqual(await readClipboardFiles({read:async()=>[{types:['text/uri-list'],getType:async()=>new Blob(['file:///tmp/a'])}]}),['/tmp/a']);
  assert.deepEqual(await readClipboardFiles({read:async()=>[{types:['electron application/osclipboard;format="text/uri-list"'],getType:async()=>new Blob(['file:///tmp/raw'])}]}),['/tmp/raw']);
  assert.deepEqual(await readClipboardFiles({read:async()=>[{types:['application/vnd.portal.filetransfer'],getType:async()=>new Blob(['controlled-key\0'])}]},{retrieveFiles:async key=>{assert.equal(key,'controlled-key');return ['/run/user/1000/doc/test/file'];}}),['/run/user/1000/doc/test/file']);
});
async function desktop(t){
 const dom=new JSDOM(await fs.readFile('desktop/index.html','utf8'),{runScripts:'outside-only',url:'https://local.test'});t.after(()=>dom.window.close());
 const w=dom.window;let state={mode:'local',status:'local',message:'Not connected',onboarded:false,interfaces:[]};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.navigate=()=>{};w.airdrop={devices:async action=>{if(action==='state')return state;},quit:async()=>{}};
 return {w,set:s=>{state={...state,...s};},get:id=>w.document.getElementById(id),tick:()=>new Promise(r=>setTimeout(r,1550))};
}
test('startup stays usable while Tailscale waits; Settings owns the only live address',async t=>{
 const {w,set,get,tick}=await desktop(t);w.eval(await fs.readFile('desktop/connection-progress.js','utf8'));w.eval(await fs.readFile('desktop/devices-ui.js','utf8'));await new Promise(r=>setImmediate(r));
 assert.equal(get('connectionWizard').open,true);assert.equal(get('wizardContinue').disabled,false);assert.equal(get('view-transfer').hidden,false);
 set({mode:'tailscale',status:'checking-https',message:'Checking HTTPS',url:'',qr:''});await tick();assert.equal(get('wizardSpinner').hidden,false);assert.match(get('wizardStatus').textContent,/Checking secure/);assert.equal(get('connectTailnet').disabled,true);assert.equal(get('deviceLink').hidden,true);
 set({mode:'tailscale',status:'ready',url:'https://device.tail.ts.net/pair/#secret',qr:'data:image/png;base64,fixture'});await tick();assert.equal(get('deviceAddress').value,'https://device.tail.ts.net/pair/#secret');
 set({status:'disconnected',url:'',qr:''});await tick();assert.equal(get('deviceLink').hidden,true);assert.equal(get('connectTailnet').disabled,false);get('wizardContinue').click();assert.equal(get('connectionWizard').open,false);assert.equal(w.localStorage.getItem('airdrop-welcome-seen'),'true');
});
test('only ready Tailscale persists onboarding; mode changes retain it and private state',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-onboarding-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const d=new Devices({directory:dir});await d.initialize();await d.action('local');assert.equal((await d.snapshot()).onboarded,false);
 d.state.mode='tailscale';d.gateway=new ShareGateway({secure:true});d.gateway.setOrigin('https://fixture.tail.ts.net');
 // Controlled helper readiness, not a real authenticated tailnet.
 await d.ready(d.gateway.url(),'Controlled readiness');assert.equal((await d.snapshot()).onboarded,true);
 await d.action('local');assert.equal(JSON.parse(await fs.readFile(path.join(dir,'devices.json'))).onboarded,true);
 await d.stop();
});
test('file sorting is stable, persists and native drag exports selected files only',async t=>{
 const dom=new JSDOM('<div id="files"></div>',{runScripts:'outside-only',url:'https://local.test'});t.after(()=>dom.window.close());const w=dom.window;
 const files=[{name:'z.txt',path:'z.txt',type:'file',size:3,modified:100},{name:'a.txt',path:'a.txt',type:'file',size:10,modified:200},{name:'Folder',path:'Folder',type:'directory'}];let dragged;
 w.eval(await fs.readFile('ui/explorer.js','utf8'));w.AirdropExplorer.mount(w.document.getElementById('files'),{list:async()=>files,drag:p=>{dragged=p;}});await new Promise(r=>setImmediate(r));
 const order=()=>Array.from(w.document.querySelectorAll('.explorer-item'),row=>row.dataset.path);assert.deepEqual(order(),['Folder','a.txt','z.txt']);
 const select=w.document.querySelector('select');select.value='date-asc';select.dispatchEvent(new w.Event('change'));assert.deepEqual(order(),['Folder','z.txt','a.txt']);assert.equal(w.localStorage.getItem('airdrop-file-sort'),'date-asc');
 select.value='size-desc';select.dispatchEvent(new w.Event('change'));assert.deepEqual(order(),['Folder','a.txt','z.txt']);
 const row=w.document.querySelector('[data-path="a.txt"]');assert.equal(row.draggable,true);row.dispatchEvent(new w.Event('dragstart',{cancelable:true}));assert.deepEqual(Array.from(dragged),['a.txt']);assert.equal(w.document.querySelector('[data-path="Folder"]').draggable,false);
});

test('appearance, density, startup, file order and ZIP preferences persist; reset does not erase other state', async t => {
 const dom=new JSDOM(await fs.readFile('desktop/index.html','utf8'),{runScripts:'outside-only',url:'https://local.test'});t.after(()=>dom.window.close());const w=dom.window;
 w.localStorage.setItem('unrelated-state','keep');w.airdrop={onStatus(){},status:async()=>({label:'Ready',status:'ready'}),settings:async()=>({}),explore:async()=>[],onShowFiles(){},onUpdate(){},update:async()=>({status:'current',current:'1.5.0'})};
 w.eval(await fs.readFile('ui/explorer.js','utf8'));w.eval(await fs.readFile('desktop/renderer.js','utf8'));
 for(const [id,value,key] of [['accentPreference','purple','airdrop-accent'],['densityPreference','compact','airdrop-density'],['startPreference','files','airdrop-start-view'],['sortPreference','date-desc','airdrop-file-sort']]){
  const element=w.document.getElementById(id);element.value=value;element.dispatchEvent(new w.Event('change'));assert.equal(w.localStorage.getItem(key),value);
 }
 assert.equal(w.document.documentElement.dataset.accent,'purple');assert.equal(w.document.querySelector('#fileExplorer select').value,'date-desc');
 const zip=w.document.getElementById('zipPreference');zip.checked=true;zip.dispatchEvent(new w.Event('change'));assert.equal(w.document.getElementById('zip').checked,true);
 w.document.getElementById('resetPreferences').click();assert.equal(w.document.documentElement.dataset.accent,'blue');assert.equal(w.localStorage.getItem('unrelated-state'),'keep');assert.equal(w.document.getElementById('zip').checked,false);
});

test('repeated Connect preserves a running helper and its pending authentication',async()=>{
 const d=new Devices({directory:'/unused'});d.state={mode:'tailscale',status:'checking-https'};d.proc={exitCode:null,signalCode:null};d.stop=()=>assert.fail('Must not restart helper');assert.equal((await d.action('tailscale')).status,'checking-https');
});
