'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {ShareGateway,lanAddresses}=require('./core/lib/device-share');
const QRCode=require('qrcode');
class Devices{
 constructor({directory,helper,backend}={}){this.directory=directory;this.helper=helper;this.backend=backend;this.generation=0;this.state={mode:'local',status:'local',message:'Local workspace only. Choose how to connect another device.',url:'',qr:''};this.queue=Promise.resolve();}
 async initialize(){try{this.preferences=JSON.parse(await fs.readFile(path.join(this.directory,'devices.json'),'utf8'));}catch{this.preferences={mode:'local',configured:false};}if(this.preferences.mode==='tailscale')this.action('tailscale').catch(()=>{});}
 async save(mode){this.preferences={mode,configured:true};await fs.mkdir(this.directory,{recursive:true,mode:0o700});await fs.writeFile(path.join(this.directory,'devices.json'),JSON.stringify(this.preferences),{mode:0o600});}
 async snapshot(){return {...this.state,configured:!!this.preferences?.configured,interfaces:lanAddresses()};}
 action(mode,address){const result=this.queue.then(()=>this.change(mode,address));this.queue=result.catch(()=>{});return result;}
 async change(mode,address){
  if(!['local','lan','tailscale'].includes(mode))throw Error('Unknown connection mode');
  await this.stop();await this.save(mode);
  this.state={mode,status:'starting',message:'Starting connection…',url:'',qr:''};
  if(mode==='local'){this.state.status='local';this.state.message='Local workspace only. Sharing links have been revoked.';return this.snapshot();}
  this.gateway=new ShareGateway({backend:this.backend,secure:mode==='tailscale'});
  try{
   if(mode==='lan'){
    const available=lanAddresses();const selected=address||available[0]?.address;
    if(!available.some(i=>i.address===selected))throw Error('No matching private LAN interface is available. Connect to Wi-Fi or Ethernet first.');
    await this.gateway.listen(selected);
    // The wizard can be used before the local backend has finished starting.
    for(let attempt=0;;attempt++){try{await this.gateway.probe();break;}catch(error){if(attempt===7)throw error;await new Promise(resolve=>setTimeout(resolve,500));}}
    await this.ready(this.gateway.url(),'Same Wi-Fi/LAN required. HTTP is not encrypted: use a trusted network. Anyone with this link can access the workspace.');
    this.monitor=setInterval(()=>{if(!lanAddresses().some(i=>i.address===selected)){this.state.url='';this.state.qr='';this.state.status='disconnected';this.state.message='The selected LAN interface disconnected. Start LAN sharing again.';this.gateway?.close().catch(()=>{});}},2000);
   }else{
    const target=await this.gateway.listen();
    if(!this.helper)throw Error('This installation does not include the embedded Tailscale helper.');
    await fs.access(this.helper);
    this.proc=spawn(this.helper,['--state-dir',path.join(this.directory,'tsnet'),'--hostname','airdrop-'+os.hostname().replace(/[^a-zA-Z0-9-]/g,'-').slice(0,40)],{stdio:['pipe','pipe','pipe']});
    this.proc.stdin.on('error',()=>{});
    this.proc.stdin.write(JSON.stringify({target:target.target,token:this.gateway.token})+'\n');
    this.proc.stderr.on('data',()=>{});let buffer='';
    this.proc.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>65536){this.proc.kill();return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{this.receive(JSON.parse(line)).catch(()=>{});}catch{}}});
    this.proc.on('error',()=>{this.state={mode:'tailscale',status:'error',message:'Embedded Tailscale could not start. Choose local or LAN mode.',url:'',qr:''};});
    this.proc.on('exit',()=>{if(this.state.mode==='tailscale'){this.generation++;this.state.status='disconnected';this.state.url='';this.state.qr='';this.state.message='Tailscale stopped. Reconnect or use LAN/local mode.';const gateway=this.gateway;this.gateway=null;gateway?.close().catch(()=>{});}});
   }
  }catch(error){await this.stop();this.state={mode,status:'error',message:error.message,url:'',qr:''};}
  return this.snapshot();
 }
 async receive(event){
  if(!this.gateway||this.state.mode!=='tailscale')return;
  if(event.origin)this.gateway.setOrigin(event.origin);
  let authURL='';try{const url=new URL(event.authURL);if(url.protocol==='https:'&&url.hostname==='login.tailscale.com')authURL=url.href;}catch{}
  if(event.ready&&event.origin){await this.ready(this.gateway.url(),event.message);return;}
  this.state={mode:'tailscale',status:event.state,message:event.message||'Connecting…',authURL,url:'',qr:''};
 }
 async ready(url,message){const generation=this.generation;if(this.state.url===url&&this.state.qr){this.state.message=message;return;}const qr=await QRCode.toDataURL(url,{width:256,errorCorrectionLevel:'M',margin:2});if(this.generation!==generation||!this.gateway)return;this.state={mode:this.state.mode,status:'ready',message,url,qr};}
 async stop(){clearInterval(this.monitor);this.monitor=null;
  this.generation++;this.state.url='';this.state.qr='';
  const gateway=this.gateway;this.gateway=null;if(gateway)await gateway.close();
  const proc=this.proc;this.proc=null;
  if(proc){proc.stdout.removeAllListeners('data');proc.removeAllListeners('exit');proc.stdin.end();proc.kill('SIGTERM');await new Promise(resolve=>{if(proc.exitCode!==null||proc.signalCode)return resolve();const timer=setTimeout(()=>{proc.kill('SIGKILL');resolve();},5000);proc.once('exit',()=>{clearTimeout(timer);resolve();});});}
  this.state.url='';this.state.qr='';
 }
}
module.exports={Devices};
