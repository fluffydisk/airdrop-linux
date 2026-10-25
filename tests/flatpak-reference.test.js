'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
async function fixture(t,source,extra={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'flatpak-inputs-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'app.yml'),'app-id: io.github.fluffydisk.airdrop-linux\nmodules:\n  - name: app\n    sources: '+source+'\n');
 for(const [name,text] of Object.entries(extra))await fs.writeFile(path.join(root,name),text);
 return root;
}
function inspect(root,stage){
 return execFileSync(process.env.PYTHON||'/usr/bin/python3',['-c',
  'import sys,json;sys.path.insert(0,sys.argv[1]);from flatpak_reference_inputs import inspect_manifest,stage_manifest;data,receipt=(stage_manifest(sys.argv[2],sys.argv[3]) if len(sys.argv)>3 else inspect_manifest(sys.argv[2]));print(json.dumps(receipt))',
  path.resolve('scripts'),path.join(root,'app.yml'),...(stage?[stage]:[])],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
}
test('independent recipe staging copies only declared inputs and architecture policy',async t=>{
 const root=await fixture(t,'[deps.json]',{'deps.json':'[{"type":"patch","path":"fix.patch"}]','fix.patch':'reviewed patch','flathub.json':'{"only-arches":["x86_64"]}','unrelated-secret':'must not be copied'});
 const target=path.join(root,'staged');const result=JSON.parse(inspect(root,target));
 assert.equal(result.expanded_sources,1);assert.deepEqual(result.only_arches,['x86_64']);
 assert.equal(await fs.readFile(path.join(target,'fix.patch'),'utf8'),'reviewed patch');
 await assert.rejects(fs.access(path.join(target,'unrelated-secret')));
 await fs.writeFile(path.join(root,'flathub.json'),'{"only-arches":true}');
 assert.throws(()=>inspect(root),/only-arches must be a nonempty list/);
});
test('recipe inputs cannot escape through relative paths or symlinks',async t=>{
 const root=await fixture(t,'[{type: patch, path: ../outside.patch}]');
 assert.throws(()=>inspect(root),/escapes/);
 await fs.writeFile(path.join(root,'app.yml'),'modules: [{name: app, sources: [{type: patch, path: link.patch}]}]');
 await fs.writeFile(path.join(root,'actual.patch'),'test');await fs.symlink('actual.patch',path.join(root,'link.patch'));
 assert.throws(()=>inspect(root),/Symlink/);
});
test('recursive source includes fail without recursion or incomplete staging',async t=>{
 const root=await fixture(t,'[deps.json]',{'deps.json':'["deps.json"]'});assert.throws(()=>inspect(root),/Recursive/);
});
test('unhashed or mutable remote inputs fail structural verification',async t=>{
 const root=await fixture(t,'[{type: archive, url: "https://example.com/source.tar.gz"}]');assert.throws(()=>inspect(root),/checksum/);
});
