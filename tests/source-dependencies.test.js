'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {prepareSourceDependencies}=require('../scripts/source-dependencies');

test('source dependencies exclude unused Bare binaries and reject an unexpected native addon',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-source-deps-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of ['bare-fs/prebuilds/linux-x64/addon.bare','jszip/dist/jszip.min.js','bare-fs/binding.c','other/lib.js']){
  const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'source');
 }
 await prepareSourceDependencies(root);
 await assert.rejects(fs.stat(path.join(root,'bare-fs/prebuilds')), {code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(root,'bare-fs/binding.c'),'utf8'),'source');
 assert.equal(await fs.readFile(path.join(root,'other/lib.js'),'utf8'),'source');
 await fs.writeFile(path.join(root,'other/new-addon.node'),Buffer.from([127,69,76,70]));
 await assert.rejects(prepareSourceDependencies(root),/Unexpected prebuilt npm native dependency: other\/new-addon.node/);
 await fs.rename(path.join(root,'other/new-addon.node'),path.join(root,'other/unnamed-binary'));
 await assert.rejects(prepareSourceDependencies(root),/Unexpected prebuilt npm native dependency: other\/unnamed-binary/);
});
