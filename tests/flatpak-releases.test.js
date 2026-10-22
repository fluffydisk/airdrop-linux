'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {selectFlatpakRelease}=require('../scripts/download-flatpak-assets');
const release=(tag,names)=>({tag_name:tag,draft:false,prerelease:false,assets:names.map(name=>({name}))});
const names=['airdrop-linux-1.5.0-x86_64.flatpak','airdrop-linux-1.5.0-aarch64.flatpak','FLATPAK-SHA256SUMS'];
test('a native-only release preserves the last complete Flatpak release',()=>{
 assert.equal(selectFlatpakRelease([release('v1.6.0',['app.deb']),release('v1.5.0',names)]).tag,'v1.5.0');
});
test('a partial newer Flatpak publication cannot silently downgrade the remote',()=>{
 assert.throws(()=>selectFlatpakRelease([release('v1.6.0',['airdrop-linux-1.6.0-x86_64.flatpak']),release('v1.5.0',names)]),/Incomplete Flatpak release/);
});
test('draft and prerelease Flatpaks cannot become the stable remote',()=>{
 const draft={...release('v1.6.0',[]),draft:true};
 const prerelease={...release('v1.6.0',[]),prerelease:true};
 assert.equal(selectFlatpakRelease([draft,prerelease,release('v1.5.0',names)]).tag,'v1.5.0');
 assert.equal(selectFlatpakRelease([release('v1.4.0',['app.deb'])]),null);
});
