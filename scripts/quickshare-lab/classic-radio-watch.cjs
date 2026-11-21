'use strict';
// Default-off, independently supervised rollback for one private laboratory
// lease. Merely importing this file neither connects to BlueZ nor changes it.
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {validate,restore}=require('./classic-radio-lease.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function bus(args,address){return new Promise((resolve,reject)=>execFile('busctl',[...(address?['--address='+address]:['--system']),'--json=short','--allow-interactive-authorization=no',...args],{timeout:1000,maxBuffer:65536,killSignal:'SIGKILL',encoding:'utf8'},(e,out)=>e?reject(Error('Adapter bus operation unavailable')):resolve(out)));}
function adapterIo(adapter,{address}={}){
 if(!/^hci\d{1,3}$/.test(adapter))throw Error('Invalid adapter');
 const target='/org/bluez/'+adapter,iface='org.bluez.Adapter1';
 const props={alias:['Alias','s'],connectable:['Connectable','b'],discoverable:['Discoverable','b'],timeout:['DiscoverableTimeout','u']};
 return {
  async get(){const d=JSON.parse(await bus(['call','org.bluez',target,'org.freedesktop.DBus.Properties','GetAll','s',iface],address)).data?.[0];if(!d)throw Error('Adapter properties unavailable');return Object.fromEntries(Object.entries(props).map(([k,[p]])=>[k,d[p]?.data]));},
  async set(key,value){if(!Object.hasOwn(props,key))throw Error('Invalid adapter property');const [p,t]=props[key];await bus(['set-property','org.bluez',target,iface,p,t,String(value)],address);},
 };
}
async function ownedParent(file){
 if(!path.isAbsolute(file)||path.basename(file)!=='classic-lease.json')throw Error('Invalid private lease path');
 const dir=path.dirname(file),s=await fs.lstat(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0||await fs.realpath(dir)!==dir)throw Error('Private owned lease directory required');
}
async function ownedRead(file){
 const h=await fs.open(file,sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW);
 try{const s=await h.stat();if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>4096)throw Error('Private owned lease file required');return await h.readFile('utf8');}finally{await h.close();}
}
async function alive(p){
 try{
  const text=await fs.readFile('/proc/'+p.ownerPid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+1).trim().split(/\s+/),start=fields[19];
  const s=await fs.stat('/proc/'+p.ownerPid);
  return s.uid===process.getuid()&&start===p.ownerStartTick&&!['Z','X'].includes(fields[0]);
 }catch{return false;}
}
async function watch(file,{ioFactory=adapterIo,ownerAlive=alive,leaseMs=90000,readyMs=10000,pollMs=200,ownershipCheckMs=2000}={}){
 if(!Number.isInteger(leaseMs)||leaseMs<1||leaseMs>90000||!Number.isInteger(readyMs)||readyMs<1||readyMs>10000||!Number.isInteger(pollMs)||pollMs<1||pollMs>1000||!Number.isInteger(ownershipCheckMs)||ownershipCheckMs<1||ownershipCheckMs>5000)throw Error('Invalid bounded lease timing');
 await ownedParent(file);const prefix=file.slice(0,-5),stop=prefix+'.stop',resultFile=prefix+'.result';
 const finish=async result=>{const temp=resultFile+'.tmp-'+process.pid;await fs.writeFile(temp,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});await fs.rename(temp,resultFile);return result;};
 const mono=()=>process.hrtime.bigint(),begin=mono();let plan;
 while(Number(mono()-begin)/1e6<readyMs){
  try{plan=validate(JSON.parse(await ownedRead(file)));break;}catch(e){if(e.code&&e.code!=='ENOENT')throw Error('Private lease unavailable');}
  if(sync.existsSync(stop))return finish({status:'no-mutation-acknowledged',fullyRestored:true,reason:'stopped-before-plan'});
  await delay(pollMs);
 }
 if(!plan)throw Error('Private lease plan unavailable');
 // Acknowledge only after plan/ownership/liveness validation. This watcher
 // never enables discovery itself; native setup must still perform readback.
 if(!await ownerAlive(plan))throw Error('Lease owner unavailable');
 const io=ioFactory(plan.adapter);
 await fs.writeFile(prefix+'.ready','ready\n',{flag:'wx',mode:0o600});
 const armed=mono();let reason='time-bound',checked=armed,enabledObserved=false;
 while(Number(mono()-armed)/1e6<leaseMs){
  if(sync.existsSync(stop)){reason='owner-stop';break;}
  if(!await ownerAlive(plan)){reason='owner-exited';break;}
  if(Number(mono()-checked)/1e6>=ownershipCheckMs){
   checked=mono();
   try{
    const current=await io.get();
    const expected=Object.keys(plan.expected).every(k=>current[k]===plan.expected[k]);
    if(expected)enabledObserved=true;
    // Setup is a sequence, not an atomic transaction. Do not mistake the
    // original/intermediate values before first complete enablement for edits.
    if(enabledObserved&&!expected){reason='configuration-changed';break;}
   }catch{reason='configuration-unavailable';break;}
  }
  await delay(pollMs);
 }
 let result;
 for(let attempt=0;attempt<3;attempt++){
  try{result=await restore(plan,io);}catch{result={status:'rollback-unavailable',fullyRestored:false};}
  if(result.status!=='incomplete'&&result.status!=='read-failed')break;
  if(attempt<2)await delay(500);
 }
 result={...result,reason};
 // Atomic replacement does not follow an existing result-path symlink. No
 // original/expected property value or bus error text enters this summary.
 return finish(result);
}
if(require.main===module){
 if(process.argv.length!==3)process.exitCode=1;
 else watch(path.resolve(process.argv[2])).then(r=>{if(!r.fullyRestored)process.exitCode=1;},()=>{process.exitCode=1;});
}
module.exports={watch,adapterIo,ownedRead,ownedParent};
