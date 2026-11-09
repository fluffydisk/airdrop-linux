'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');

async function verifiedHelper({ directory, asset, request = fetch, signal, progress = () => {} }) {
  if (!asset || !/^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\//.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Internet sharing is unavailable on this system. Use Wi-Fi sharing instead.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, 'cloudflared-' + asset.sha256);
  try {
    const stat = await fs.lstat(target);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size === asset.size && crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') === asset.sha256) { await fs.chmod(target,0o700);return target; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await request(asset.url, { signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw Error(`The connection component could not be downloaded (HTTP ${response.status}). Check internet access to GitHub, then retry or choose another provider.`);
  const temporary = target + '.' + crypto.randomBytes(8).toString('hex') + '.part';
  const file = await fs.open(temporary, 'wx', 0o600), hash = crypto.createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted(); size += chunk.byteLength;
      if (size > asset.size) throw Error('Connection component verification failed.');
      hash.update(chunk); await file.writeFile(chunk); progress(size, asset.size);
    }
    if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw Error('Connection component verification failed. Please try again.');
    await file.close(); await fs.chmod(temporary, 0o700); await fs.rename(temporary, target);
    return target;
  } catch (error) { await file.close().catch(() => {}); await fs.rm(temporary, { force: true }); throw error; }
}

// Optional, account-free internet sharing through Cloudflare Quick Tunnels.
// Wi-Fi sharing remains independent of this service.
class InternetConnection {
  constructor({ directory, asset, target, proxyHost, onState = () => {}, request, spawnProcess = spawn, maxRestarts = 4, retryDelay = 1000, startupTimeout = 90000, random = Math.random } = {}) {
    const local = new URL(target);
    if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1') throw Error('Internet sharing must target the local sharing gateway.');
    this.directory = directory; this.asset = asset; this.target = target; this.proxyHost = proxyHost;
    this.onState = onState; this.request = request; this.spawnProcess = spawnProcess; this.stopped = true;
    this.maxRestarts=maxRestarts;this.retryDelay=retryDelay;this.startupTimeout=startupTimeout;this.random=random;this.session=0;
  }
  emit(state) { if(!this.stopped)this.onState({...state,session:this.session}); }
  start() {
    if(this.running)return this.stopped?this.task.then(()=>this.start()):this.task;
    if(!this.stopped)return this.task;
    this.running=true;this.stopped=false;this.controller=new AbortController();
    this.task=this.run().catch(error=>{
      if(!this.stopped)this.emit({status:'error',message:error.message.includes('component')?error.message:'Airdrop could not prepare internet sharing. Retry or choose Same Wi-Fi.'});
    }).finally(()=>{this.running=false;});
    return this.task;
  }
  async run() {
    this.emit({status:'downloading',message:'Preparing free internet sharing inside Airdrop…'});
    const helper=await verifiedHelper({directory:this.directory,asset:this.asset,request:this.request,signal:this.controller.signal,
      progress:(size,total)=>this.emit({status:'downloading',message:`Preparing connection: ${Math.floor(size/total*100)}% downloaded`})});
    if(this.stopped)return;
    const config=path.join(this.directory,'quick-tunnel.yml');await fs.writeFile(config,'{}\n',{mode:0o600});
    for(let attempt=0;!this.stopped;attempt++){
      if(attempt){
        if(attempt>this.maxRestarts){this.emit({status:'error',message:'Internet sharing could not recover. The previous QR has expired. Retry or choose Same Wi-Fi.'});return;}
        this.emit({status:'reconnecting',message:`The previous QR has expired. Creating a new connection (${attempt}/${this.maxRestarts})…`});
        await new Promise(resolve=>{this.wake=resolve;this.backoff=setTimeout(resolve,Math.min(30000,this.retryDelay*2**(attempt-1))*(0.75+this.random()*0.5));});
        clearTimeout(this.backoff);this.wake=null;
        if(this.stopped)return;
      }
      this.session++;
      this.emit({status:'connecting',message:'Creating a new temporary internet connection…'});
      await this.tunnel(helper,config);
    }
  }
  tunnel(helper,config) {
    return new Promise(resolve=>{
      let origin='',announced=false,done=false;
      const connections=new Set();
      const child=this.spawnProcess(helper,['tunnel','--config',config,'--no-autoupdate','--protocol','http2','--output','json','--metrics','127.0.0.1:0','--url',this.target,'--http-host-header',this.proxyHost],{stdio:['ignore','pipe','pipe']});
      this.proc=child;
      const finish=()=>{if(done)return;done=true;clearTimeout(this.timer);clearTimeout(this.killTimer);this.proc=null;this.restartChild=null;resolve();};
      // Invalidate synchronously before waiting for process termination. A new
      // child is never launched until this one has actually exited.
      const restart=()=>{
        if(done||this.restartPending)return;
        this.restartPending=true;
        if(!this.stopped)this.emit({status:'reconnecting',message:'Connection interrupted. This QR has expired; reconnecting automatically…'});
        clearTimeout(this.timer);
        this.killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
        child.kill('SIGTERM');
      };
      this.restartPending=false;this.restartChild=restart;
      this.timer=setTimeout(restart,this.startupTimeout);
      for(const stream of [child.stdout,child.stderr]){
        let buffer='';
        stream.on('data',chunk=>{
          if(done||this.stopped||this.restartPending)return;
          buffer=(buffer+chunk).slice(-65536);let index;
          while((index=buffer.indexOf('\n'))>=0){
            const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
            let record;try{record=JSON.parse(line);}catch{}
            const match=/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s|"\\]|$)/.exec(line);
            if(match&&!origin)origin=match[0];
            if(/Unregistered tunnel connection|Connection terminated/.test(line)){
              connections.delete(record?.connIndex??0);
              if(announced&&!connections.size){restart();return;}
            }
            if(/Registered tunnel connection/.test(line))connections.add(record?.connIndex??0);
            if(connections.size&&origin&&!announced){
              announced=true;clearTimeout(this.timer);
              this.emit({status:'checking',origin,message:'Verifying the new public sharing address…'});
            }
          }
        });
      }
      child.once('error',()=>{if(!this.stopped)this.emit({status:'reconnecting',message:'The internet connection process failed. Reconnecting…'});finish();});
      child.once('exit',()=>{if(!this.stopped&&!this.restartPending)this.emit({status:'reconnecting',message:'The internet connection stopped. This QR has expired; reconnecting…'});finish();});
    });
  }
  reconnect() { this.restartChild?.(); }
  async stop() {
    if(this.stopped)return this.task;
    this.stopped=true;this.controller?.abort();clearTimeout(this.backoff);this.wake?.();
    this.restartChild?.();
    await this.task;
    clearTimeout(this.timer);clearTimeout(this.killTimer);
  }
}
module.exports = { InternetConnection, verifiedHelper };
