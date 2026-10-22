'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {getPaths}=require('../lib/paths');

test('desktop, AppStream and repository identity match Flathub code-hosting rules',async()=>{
 const id='io.github.fluffydisk.airdrop-linux';
 const parts=id.split('.');
 assert.equal(parts.length,4);
 assert.ok(parts.slice(0,-1).every(part=>/^[a-z_][a-z0-9_]*$/.test(part)));
 assert.match(parts.at(-1),/^[A-Za-z_][A-Za-z0-9_-]*$/);
 const xml=new JSDOM(await fs.readFile(`packaging/${id}.metainfo.xml`,'utf8'),{contentType:'application/xml'}).window.document;
 assert.equal(xml.querySelector('component > id').textContent,id);
 assert.equal(xml.querySelector('launchable[type="desktop-id"]').textContent,id+'.desktop');
 assert.equal(xml.querySelector('url[type="homepage"]').textContent,`https://github.com/${parts[2]}/${parts[3]}`);
 const desktop=await fs.readFile(`packaging/${id}.desktop`,'utf8');
 assert.match(desktop,new RegExp('^Icon='+id.replaceAll('.','\\.')+'$','m'));
 assert.match(desktop,new RegExp('^StartupWMClass='+id.replaceAll('.','\\.')+'$','m'));
});

test('new Flatpak identity selects independent data without adopting native or old sandbox data',()=>{
 const home='/home/airdrop-test';
 const sandbox=id=>getPaths({home,dataHome:path.join(home,'.var/app',id,'data')});
 const old=sandbox('io.github.fluffydisk.Airdrop');
 const current=sandbox('io.github.fluffydisk.airdrop-linux');
 const native=getPaths({home,dataHome:path.join(home,'.local/share')});
 for(const name of ['root','files','env','desktopData','backups']) {
  assert.notEqual(current[name],old[name]);
  assert.notEqual(current[name],native[name]);
 }
});
