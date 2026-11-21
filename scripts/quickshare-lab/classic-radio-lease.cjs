'use strict';
// Offline lease validation/rollback policy. No default bus connection or radio
// mutation. Caller supplies private functional state, never diagnostic text.
const KEYS=Object.freeze(['alias','connectable','discoverable','timeout']);
const sameKeys=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
function properties(x){
 return sameKeys(x,KEYS)&&typeof x.alias==='string'&&Buffer.byteLength(x.alias)<=248&&!/[\x00-\x1f\x7f]/.test(x.alias)&&typeof x.connectable==='boolean'&&typeof x.discoverable==='boolean'&&Number.isInteger(x.timeout)&&x.timeout>=0&&x.timeout<=0xffffffff;
}
function validEncodedAlias(value){
 if(typeof value!=='string'||value.length>200||!/^[-_A-Za-z0-9]+$/.test(value))return false;
 const b=Buffer.from(value,'base64url');
 if(b.toString('base64url')!==value||b.length<34||b[0]!==0x23||!b.subarray(1,5).every(x=>(x>=48&&x<=57)||(x>=65&&x<=90)||(x>=97&&x<=122))||!b.subarray(5,8).equals(Buffer.from([0xfc,0x9f,0x5e]))||b.subarray(8,15).some(x=>x!==0)||b[15]>131||b.length!==16+b[15])return false;
 const info=b.subarray(16);
 if(info[0]!==6||info.length<18||info.length!==18+info[17])return false;
 const name=info.subarray(18),text=name.toString('utf8');
 return name.length<=80&&Buffer.from(text).equals(name)&&!/[\x00-\x1f\x7f]/.test(text);
}
function validate(plan){
 if(!sameKeys(plan,['schema','adapter','ownerPid','ownerStartTick','original','expected'])||plan.schema!==1||!/^hci(?:0|[1-9]\d{0,2})$/.test(plan.adapter)||Number(plan.adapter.slice(3))>255||!Number.isInteger(plan.ownerPid)||plan.ownerPid<2||plan.ownerPid>0x7fffffff||typeof plan.ownerStartTick!=='string'||!/^\d{1,20}$/.test(plan.ownerStartTick)||!properties(plan.original)||!properties(plan.expected)||plan.original.discoverable||!plan.expected.discoverable||!plan.expected.connectable||plan.expected.timeout!==90||!validEncodedAlias(plan.expected.alias)||plan.original.alias===plan.expected.alias)throw Error('Invalid private Classic lease');
 return plan;
}
const equal=(a,b)=>KEYS.every(k=>a[k]===b[k]);
async function restore(input,io){
 const plan=validate(input),result={status:'pending',fullyRestored:false,restoredKeys:[],externalKeys:[],failedKeys:[]};
 let current;
 const read=async()=>{const x=await io.get();if(!properties(x))throw Error('Invalid adapter state');return x;};
 try{current=await read();}catch{return {...result,status:'read-failed'};}
 if(equal(current,plan.original))return {...result,status:'already-restored',fullyRestored:true};
 if(current.alias!==plan.expected.alias)return {...result,status:'ownership-conflict'};
 // Preserve the unique alias ownership marker until other restoration succeeds,
 // allowing a later bounded retry after an individual bus/property failure.
 for(const key of ['discoverable','timeout','connectable']){
  try{
   current=await read();
   if(current.alias!==plan.expected.alias)return {...result,status:'ownership-conflict'};
   if(current[key]===plan.original[key])continue;
   if(current[key]!==plan.expected[key]){result.externalKeys.push(key);continue;}
   await io.set(key,plan.original[key]);
   if((await read())[key]!==plan.original[key])throw Error('Readback mismatch');
   result.restoredKeys.push(key);
  }catch{result.failedKeys.push(key);}
 }
 if(result.failedKeys.length)return {...result,status:'incomplete'};
 try{
  current=await read();
  if(current.alias!==plan.expected.alias)return {...result,status:'ownership-conflict'};
  await io.set('alias',plan.original.alias);
  current=await read();
  if(current.alias!==plan.original.alias)throw Error('Readback mismatch');
  result.restoredKeys.push('alias');result.fullyRestored=equal(current,plan.original);
  result.status=result.fullyRestored?'restored':'external-property-change';
 }catch{result.failedKeys.push('alias');result.status='incomplete';}
 return result;
}
module.exports={validate,restore,validEncodedAlias};
