'use strict';
const {fork}=require('node:child_process'),path=require('node:path');
const {HealthError}=require('./connection-health');
// Keep native TLS and certificate-store work out of Electron's main process.
// Pairing capabilities travel only over the private parent/child IPC channel.
function probeInProcess(options,{execPath=process.execPath,env=process.env,worker=path.join(__dirname,'public-probe-worker.js'),forkProcess=fork,timeout=7000}={}){
 return new Promise((resolve,reject)=>{
  let child,finished=false;
  const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);if(child?.connected)child.disconnect();if(child&&child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');error?reject(error):resolve();};
  const timer=setTimeout(()=>finish(new HealthError('TIMEOUT')),timeout);
  try{
   child=forkProcess(worker,[],{execPath,execArgv:[],env,stdio:['ignore','ignore','ignore','ipc']});
   child.once('error',()=>finish(new HealthError('NETWORK')));child.once('exit',()=>finish(new HealthError('NETWORK')));
   child.once('message',message=>{
    if(message?.ok===true)return finish();
    const codes=['DNS','TLS','TIMEOUT','REFUSED','NETWORK','HTTP','CONTENT'];
    const code=codes.includes(message?.code)?message.code:'NETWORK';
    finish(new HealthError(code,'public',code==='HTTP'&&Number.isInteger(message?.httpStatus)?message.httpStatus:undefined));
   });
   child.send(options,error=>{if(error)finish(new HealthError('NETWORK'));});
  }catch{finish(new HealthError('NETWORK'));}
 });
}
module.exports={probeInProcess};
