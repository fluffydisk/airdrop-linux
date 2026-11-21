'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate,restore,validEncodedAlias}=require('../scripts/quickshare-lab/classic-radio-lease.cjs');
const alias='I0FCMTL8n14AAAAAAAAAFwYAAQIDBAUGBwgJCgsMDQ4PBUxpbnV4';
const plan=()=>({schema:1,adapter:'hci1',ownerPid:123,ownerStartTick:'456',original:{alias:'PRIVATE-ORIGINAL',connectable:false,discoverable:false,timeout:180},expected:{alias,connectable:true,discoverable:true,timeout:90}});
function bus(state){return{state:structuredClone(state),calls:[],async get(){return structuredClone(this.state);},async set(k,v){this.calls.push(k);this.state[k]=v;}};}
test('Classic lease rollback restores bounded radio properties before releasing alias ownership and is idempotent',async()=>{
 const p=plan(),io=bus(p.expected),x=await restore(p,io);
 assert.equal(x.fullyRestored,true);assert.equal(x.status,'restored');assert.deepEqual(io.calls,['discoverable','timeout','connectable','alias']);assert.deepEqual(io.state,p.original);
 assert.equal((await restore(p,io)).status,'already-restored');assert.equal(io.calls.length,4);assert.doesNotMatch(JSON.stringify(x),/PRIVATE-ORIGINAL|I0FC/);
});
test('Classic rollback never overwrites another owner alias or external timeout choice',async()=>{
 const p=plan(),other=bus({...p.expected,alias:'USER-NEW'});assert.equal((await restore(p,other)).status,'ownership-conflict');assert.deepEqual(other.calls,[]);
 const changed=bus({...p.expected,timeout:60}),x=await restore(p,changed);assert.equal(changed.state.timeout,60);assert.equal(x.status,'external-property-change');assert.equal(x.fullyRestored,false);assert.equal(changed.state.alias,p.original.alias);
});
test('partial rollback keeps ownership for retry, surfaces failed readback and never leaks bus error text',async()=>{
 const p=plan(),io=bus(p.expected),set=io.set;
 io.set=async function(k,v){if(k==='timeout')throw Error('PRIVATE-ERROR');return set.call(this,k,v);};
 const x=await restore(p,io);assert.equal(x.status,'incomplete');assert.equal(x.fullyRestored,false);assert.equal(io.state.alias,p.expected.alias);assert.deepEqual(x.failedKeys,['timeout']);assert.doesNotMatch(JSON.stringify(x),/PRIVATE/);
 io.set=set;assert.equal((await restore(p,io)).fullyRestored,true);
 const lies=bus(p.expected);lies.set=async()=>{};assert.equal((await restore(p,lies)).status,'incomplete');assert.equal(lies.state.alias,p.expected.alias);
});
test('Classic lease rejects malformed protocol, ambiguous ownership and unsafe adapter inputs without I/O',()=>{
 assert.equal(validEncodedAlias(alias),true);assert.equal(validEncodedAlias(alias+'='),false);assert.equal(validEncodedAlias('PRIVATE'),false);
 const nonAscii=Buffer.from(alias,'base64url');nonAscii[1]=0xc1;assert.equal(validEncodedAlias(nonAscii.toString('base64url')),false);
 for(const modify of [p=>p.adapter='../hci1',p=>p.adapter='hci256',p=>p.original.discoverable=true,p=>p.expected.timeout=0,p=>p.expected.alias='not-a-Nearby-name',p=>p.ownerPid=1,p=>p.ownerStartTick='bad',p=>p.secret='PRIVATE']){const p=plan();modify(p);assert.throws(()=>validate(p),/Invalid private Classic lease/);}
});
test('Classic inquiry is an explicit inbound lab option and cannot silently enable BLE radio experiments',()=>{
 const {parse}=require('../scripts/quickshare-android-lab.cjs');
 assert.equal(parse(['--prepare'])['classic-inquiry'],undefined);
 const args=['--prepare','--ble-native','--receive-only','--classic','--classic-inquiry'];assert.equal(parse(args)['classic-inquiry'],true);
 for(const a of [['--prepare','--classic-inquiry'],[...args,'--ble-fastinit'],[...args,'--small-sdu'],['--start','--classic-inquiry']])assert.throws(()=>parse(a));
 const {sanitizeBluetooth}=require('../lib/sharing/quickshare');const r=sanitizeBluetooth({classicDiscoverable:true,bleAdvertising:false,stage:'classic-inquiry-ready',mode:'classic-inquiry',originalAlias:'PRIVATE',classicLease:{keys:'SECRET'}});
 assert.equal(r.classicDiscoverable,true);assert.equal(r.bleAdvertising,false);assert.equal(r.stage,'classic-inquiry-ready');assert.equal(r.mode,'classic-inquiry');assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SECRET|classicLease|originalAlias/);
 assert.equal(Object.hasOwn(sanitizeBluetooth({}),'classicDiscoverable'),false);
});
