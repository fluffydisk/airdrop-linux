'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {BackgroundPolicy}=require('../desktop/background-policy');
test('background stays off until opted in and disabling ends permission wait',async()=>{
 let calls=0, signal;
 const policy=new BackgroundPolicy({source:'flatpak',request:async options=>{calls++;signal=options.signal;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(false),{once:true}));}});
 assert.equal(await policy.set(false),false);assert.equal(calls,0);
 const pending=policy.set(true);assert.equal(policy.pending,true);assert.equal(policy.active,false);
 assert.equal(await policy.set(false),false);assert.equal(signal.aborted,true);await pending;assert.equal(policy.active,false);
});
test('Flatpak grant, denial and native close behavior follow the user setting',async()=>{
 for(const granted of [false,true]){
  const policy=new BackgroundPolicy({source:'flatpak',request:async()=>granted});
  assert.equal(await policy.set(true),granted);assert.equal(policy.snapshot().active,granted);
  await policy.set(false);assert.equal(policy.active,false);
 }
 const native=new BackgroundPolicy({source:'apt'});assert.equal(native.active,false);assert.equal(await native.set(true),true);native.stop();assert.equal(native.active,false);
 assert.equal(await new BackgroundPolicy({source:'snap'}).set(true),false);
 assert.equal(await new BackgroundPolicy({source:'snap',snapEnabled:true}).set(true),true);
});
