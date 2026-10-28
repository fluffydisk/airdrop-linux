'use strict';
const fs = require('node:fs/promises');
const {spawn} = require('node:child_process');
const URL = 'https://fluffydisk.github.io/airdrop-linux/flatpak-channel.json';
const APP = 'io.github.fluffydisk.airdrop-linux';
const KEY = '6513D70958397F60D3787A0CB93F4FC1E97CF3AE';
// HTTPS metadata is notification-only. The Flatpak update portal selects the
// installed origin and verifies repository/commit signatures during installation.
async function check({fetcher=fetch,read=fs.readFile}={}) {
  const installed=JSON.parse(await read('/app/share/airdrop-linux/distribution.json','utf8'));
  const response=await fetcher(URL,{signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});
  if(!response.ok)throw Error('Could not check for updates. Try again when online.');
  const body=await response.text();if(body.length>65536)throw Error('Invalid update response');
  const latest=JSON.parse(body);
  if(latest.app_id!==APP||latest.arch!=='x86_64'||latest.branch!=='stable'||latest.fingerprint!==KEY||!/^\d+\.\d+\.\d+$/.test(latest.version)||!Number.isSafeInteger(latest.revision)||latest.revision<1||!/^[a-f0-9]{40}$/.test(latest.source_commit))throw Error('Unexpected update channel. No application changes were made.');
  const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
  const available=compare(latest.version,installed.version)>0||(latest.version===installed.version&&latest.revision>installed.revision);
  return {status:available?'available':'current',current:installed.version,version:latest.version,message:available?'An Airdrop update is available.':'Airdrop is up to date.'};
}
function install(publish,{spawnProcess=spawn}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawnProcess('/app/bin/airdrop-update-portal',[],{stdio:['ignore','pipe','pipe']});
    let buffer='',terminal=false;
    const timer=setTimeout(()=>{child.kill();reject(Error('Update timed out. Check your connection and try again.'));},20*60*1000);
    child.stderr.on('data',()=>{});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.stdout.on('data',data=>{
      buffer+=data;if(buffer.length>65536){child.kill();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const [status,value]=line.split(' ');
        if(status==='progress')publish({status:'installing',message:`Updating Airdrop… ${Math.max(0,Math.min(100,Number(value)||0))}%`});
        if(status==='done'){terminal=true;publish({status:'updated',message:'Update installed. Quit and reopen Airdrop to use it.'});}
        if(status==='empty'){terminal=true;publish({status:'current',message:'No update to install. Try Check for updates again later.'});}
      }
    });
    child.on('close',code=>{clearTimeout(timer);if(code===0&&terminal)resolve();else reject(Error('Flatpak could not install the update. It may have been cancelled or require your system software manager.'));});
  });
}
function singleFlight(operation) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(operation).finally(() => { pending = undefined; });
    return pending;
  };
}
module.exports={check,install,singleFlight};
