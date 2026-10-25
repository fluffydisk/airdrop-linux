'use strict';
// Real unauthenticated control-plane test. No auth key, browser automation or
// simulated responses: this is deliberately NOT an authenticated tailnet test.
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
 const helper=process.argv[2];if(!helper)throw Error('Pass the compiled tsnet helper');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-tsnet-bootstrap-'));
 const proc=spawn(helper,['--state-dir',directory,'--hostname','airdrop-bootstrap-test'],{stdio:['pipe','pipe','pipe']});
 let buffer='',last='',timer;
 try{
  proc.stdin.on('error',()=>{});proc.stderr.on('data',()=>{});
  proc.stdin.write(JSON.stringify({target:'http://127.0.0.1:61234',token:crypto.randomBytes(32).toString('hex')})+'\n');
  await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error('No browser authentication URL from the real control plane within 75 seconds')),75000);
   proc.once('error',reject);proc.once('exit',()=>reject(Error('Helper exited before receiving a login URL')));
   proc.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{
    const event=JSON.parse(line);const record={state:event.state,hasAuthURL:!!event.authURL,hasSharingURL:!!event.origin,ready:event.ready};
    if(JSON.stringify(record)!==last){last=JSON.stringify(record);console.log(last);}
    if(event.ready||event.origin)return reject(Error('An unauthenticated node advertised a sharing address'));
    if(event.authURL){const url=new URL(event.authURL);if(url.protocol!=='https:'||url.hostname!=='login.tailscale.com')return reject(Error('Unexpected authentication origin'));resolve();}
   }catch(error){reject(error);}}});
  });
  console.log('VERIFIED: real Tailscale browser authentication URL received; URL intentionally redacted. No authenticated device/HTTPS transfer claimed.');
 }finally{
  clearTimeout(timer);proc.stdin.end();proc.kill('SIGTERM');
  await new Promise(resolve=>{if(proc.exitCode!==null||proc.signalCode)return resolve();const kill=setTimeout(()=>{proc.kill('SIGKILL');resolve();},5000);proc.once('exit',()=>{clearTimeout(kill);resolve();});});
  await fs.rm(directory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
