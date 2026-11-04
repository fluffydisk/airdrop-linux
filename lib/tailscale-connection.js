'use strict';
const path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
// A private tsnet process: no host VPN installation, route changes or daemon.
class TailscaleConnection{
 constructor({helper,directory,target,token,onState=()=>{},spawnProcess=spawn}={}){
  Object.assign(this,{helper,directory,target,token,onState,spawnProcess});this.stopped=true;
 }
 start(){
  this.stopped=false;
  const child=this.proc=this.spawnProcess(this.helper,['--state-dir',path.join(this.directory,'tsnet'),'--hostname','airdrop-'+os.hostname().replace(/[^a-zA-Z0-9-]/g,'-').slice(0,40)],{stdio:['pipe','pipe','pipe']});
  this.loginTimer=setTimeout(()=>{if(!this.stopped){this.failed=true;this.onState({status:'error',message:'Tailscale did not return a sign-in link. Check internet access or choose Airdrop or Wi-Fi.'});child.kill('SIGTERM');}},90000);
  child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify({target:this.target,token:this.token})+'\n');
  // Keep the parent pipe open; EOF asks tsnet to stop after a parent crash.
  let buffer='';
  child.stdout.on('data',chunk=>{
   if(this.stopped)return;
   buffer+=chunk;if(buffer.length>65536){this.onState({status:'error',message:'Tailscale returned an invalid response. Reconnect or choose another provider.'});child.kill('SIGTERM');return;}
   let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let event;try{event=JSON.parse(line);}catch{continue;}
    let authURL='',origin='';
    try{const u=new URL(event.authURL);if(u.protocol==='https:'&&u.hostname==='login.tailscale.com'&&!u.username&&!u.password)authURL=u.href;}catch{}
    if(authURL||event.ready||event.state==='NeedsMachineAuth'||event.state==='needs-https')clearTimeout(this.loginTimer);
    try{const u=new URL(event.origin);if(u.protocol==='https:'&&/^[a-z0-9.-]+\.ts\.net$/.test(u.hostname)&&u.origin===event.origin)origin=u.origin;}catch{}
    const status=event.ready&&origin?'checking':({'NeedsLogin':'needs-login','NeedsMachineAuth':'needs-approval','checking-https':'checking','connected':'checking','https-unavailable':'checking'}[event.state]||event.state);
    this.onState({status,message:event.message||'Connecting Tailscale…',authURL,origin,verified:!!(event.ready&&origin)});
   }
  });
  child.stderr.on('data',()=>{});
  child.on('error',()=>{clearTimeout(this.loginTimer);this.failed=true;if(!this.stopped)this.onState({status:'error',message:'The embedded Tailscale provider could not start. Choose Airdrop or Wi-Fi, or reinstall this package.'});});
  child.on('exit',()=>{clearTimeout(this.loginTimer);if(!this.stopped&&!this.failed)this.onState({status:'error',message:'Tailscale stopped. Reconnect or choose another provider.'});});
 }
 async stop(){
  this.stopped=true;clearTimeout(this.loginTimer);const child=this.proc;this.proc=null;
  if(!child||child.exitCode!==null||child.signalCode)return;
  child.stdin.end();
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
 }
}
module.exports={TailscaleConnection};
