'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {listen,request}=require('../lib/backend-control');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-control-'));
 await fs.mkdir(path.join(root,'state'),{mode:0o700});
 t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}
test('private Snap backend control reports identity and stops only its own server',async t=>{
 const root=await fixture(t);let stopped=false;
 const server=await listen(root,'1.5.0',()=>{stopped=true;server.close();});
 t.after(()=>server.close());
 assert.equal((await fs.stat(path.join(root,'state/backend.sock'))).mode&0o777,0o600);
 assert.deepEqual(await request(root),{source:'snap',root,version:'1.5.0'});
 assert.equal(stopped,false);
 const other=await fixture(t);
 await fs.link(path.join(root,'state/backend.sock'),path.join(other,'state/backend.sock'));
 await assert.rejects(request(other,'stop'));
 assert.equal(stopped,false);
 await assert.rejects(listen(root,'1.5.0',()=>{}),/already in use/);
 await request(root,'stop');
 for(let i=0;i<20&&!stopped;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(stopped,true);
});
test('backend control preserves regular files and refuses linked or public directories',async t=>{
 const root=await fixture(t),file=path.join(root,'state/backend.sock');
 await fs.writeFile(file,'unrelated');
 await assert.rejects(listen(root,'1.5.0',()=>{}),/not owned/);
 assert.equal(await fs.readFile(file,'utf8'),'unrelated');
 await fs.unlink(file);await fs.chmod(path.join(root,'state'),0o755);
 await assert.rejects(listen(root,'1.5.0',()=>{}),/private/);
 await fs.chmod(path.join(root,'state'),0o700);
 const linked=root+'-link';await fs.symlink(root,linked);t.after(()=>fs.unlink(linked));
 await assert.rejects(listen(linked,'1.5.0',()=>{}),/Unsafe/);
});
