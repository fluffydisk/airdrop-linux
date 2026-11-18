'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {watch}=require('../scripts/quickshare-lab/classic-radio-watch.cjs');
const alias='I0FCMTL8n14AAAAAAAAAFwYAAQIDBAUGBwgJCgsMDQ4PBUxpbnV4';
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-classic-'));await fs.chmod(dir,0o700);t.after(()=>fs.rm(dir,{recursive:true,force:true}));const plan={schema:1,adapter:'hci1',ownerPid:123,ownerStartTick:'456',original:{alias:'PRIVATE-ORIGINAL',connectable:false,discoverable:false,timeout:180},expected:{alias,connectable:true,discoverable:true,timeout:90}};const file=path.join(dir,'classic-lease.json');await fs.writeFile(file,JSON.stringify(plan),{mode:0o600});const io={state:structuredClone(plan.original),calls:[],async get(){return structuredClone(this.state);},async set(k,v){this.calls.push(k);this.state[k]=v;}};return{dir,file,plan,io};}
async function ready(dir){for(let n=0;n<100;n++){try{await fs.access(path.join(dir,'classic-lease.ready'));return;}catch{await new Promise(r=>setTimeout(r,5));}}throw Error('watcher not ready');}
test('independent watcher acknowledges first, restores after owner stop and exports no private functional values',async t=>{
 const {dir,file,plan,io}=await setup(t);const work=watch(file,{ioFactory:()=>io,ownerAlive:async()=>true,leaseMs:1000,readyMs:100,pollMs:5});await ready(dir);assert.deepEqual(io.calls,[]);
 io.state=structuredClone(plan.expected);await fs.writeFile(path.join(dir,'classic-lease.stop'),'stop',{mode:0o600});const result=await work;assert.equal(result.reason,'owner-stop');assert.equal(result.fullyRestored,true);assert.deepEqual(io.state,plan.original);
 const report=await fs.readFile(path.join(dir,'classic-lease.result'),'utf8');assert.doesNotMatch(report,/PRIVATE-ORIGINAL|I0FC|"alias"\s*:/);assert.equal((await fs.stat(path.join(dir,'classic-lease.ready'))).mode&0o777,0o600);assert.equal((await fs.stat(path.join(dir,'classic-lease.result'))).mode&0o777,0o600);
});
test('watcher restores on bounded expiry and on simulated owner crash without killing other processes',async t=>{
 for(const crash of [false,true]){const {dir,file,plan,io}=await setup(t);let gone=false;const work=watch(file,{ioFactory:()=>io,ownerAlive:async()=>!gone,leaseMs:50,readyMs:100,pollMs:5});await ready(dir);io.state=structuredClone(plan.expected);gone=crash;const x=await work;assert.equal(x.reason,crash?'owner-exited':'time-bound');assert.equal(x.fullyRestored,true);assert.deepEqual(io.state,plan.original);}
});
test('watcher refuses symlink/public checkpoints and preserves an externally changed alias',async t=>{
 const {dir,file,plan,io}=await setup(t);await fs.chmod(dir,0o755);let factoryCalls=0;await assert.rejects(watch(file,{ioFactory:()=>{factoryCalls++;return io;}}),/Private owned/);assert.equal(factoryCalls,0);await fs.chmod(dir,0o700);
 const other=path.join(dir,'other');await fs.rename(file,other);await fs.symlink(other,file);await assert.rejects(watch(file,{readyMs:10}),/Private lease unavailable/);await fs.unlink(file);await fs.rename(other,file);
 const work=watch(file,{ioFactory:()=>io,ownerAlive:async()=>true,leaseMs:1000,readyMs:100,pollMs:5});await ready(dir);io.state={...plan.expected,alias:'USER-NEW'};await fs.writeFile(path.join(dir,'classic-lease.stop'),'stop',{mode:0o600});assert.equal((await work).status,'ownership-conflict');assert.deepEqual(io.calls,[]);
});
test('watcher ends an enabled scope on an external alias change without waiting for expiry or overwriting it',async t=>{
 const {dir,file,plan,io}=await setup(t);let checked=0;const get=io.get;io.get=async function(){checked++;return get.call(this);};
 const work=watch(file,{ioFactory:()=>io,ownerAlive:async()=>true,leaseMs:3000,readyMs:100,pollMs:5,ownershipCheckMs:10});await ready(dir);io.state=structuredClone(plan.expected);
 for(let n=0;n<200&&!checked;n++)await new Promise(r=>setTimeout(r,10));assert.ok(checked>0);
 io.state.alias='USER-NEW';const x=await work;assert.equal(x.reason,'configuration-changed');assert.equal(x.status,'ownership-conflict');assert.equal(io.state.alias,'USER-NEW');assert.deepEqual(io.calls,[]);
});
