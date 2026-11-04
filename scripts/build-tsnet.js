'use strict';
// Build the optional, unprivileged Tailscale provider from pinned Go modules.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync:run}=require('node:child_process');
async function toolchain(){
 const pin=require('../packaging/go-toolchain.json')[process.arch];
 if(!pin)throw Error('Unsupported Tailscale provider architecture');
 const cache=path.resolve(__dirname,'../.cache/go-toolchain',process.arch),archive=cache+'.tar.gz';
 await fs.mkdir(path.dirname(cache),{recursive:true});
 try{await fs.access(path.join(cache,'go/bin/go'));}catch{
  run('curl',['--fail','--location','--retry','3','--proto','=https',pin.url,'--output',archive],{stdio:'inherit'});
  if(crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex')!==pin.sha256)throw Error('Go toolchain verification failed');
  await fs.mkdir(cache,{recursive:true});run('tar',['-xzf',archive,'-C',cache]);
 }
 return path.join(cache,'go/bin/go');
}
async function build({arch=process.arch,target=path.resolve(__dirname,'../desktop/core/bin/airdrop-tsnet')}={}){
 if(!['x64','arm64'].includes(arch))throw Error('Unsupported Tailscale provider architecture');
 const go=await toolchain();await fs.mkdir(path.dirname(target),{recursive:true});
 const env={...process.env,GOTOOLCHAIN:'local',CGO_ENABLED:'0',GOOS:'linux',GOARCH:arch==='x64'?'amd64':'arm64'};
 const cwd=path.resolve(__dirname,'../network/tsnet');
 run(go,['mod','download'],{cwd,env,stdio:'inherit'});run(go,['mod','verify'],{cwd,env,stdio:'inherit'});
 run(go,['build','-mod=readonly','-buildvcs=false','-trimpath','-ldflags=-s -w -X tailscale.com/version.longStamp=1.104.2-airdrop -X tailscale.com/version.shortStamp=1.104.2','-o',target,'.'],{cwd,env,stdio:'inherit'});
 const licenses=path.resolve(path.dirname(target),'../licenses');await fs.mkdir(path.join(licenses,'go'),{recursive:true});
 await fs.copyFile(path.resolve(go,'../../LICENSE'),path.join(licenses,'go/LICENSE'));
 const modules=run(go,['list','-m','-f','{{.Path}}|{{.Dir}}','all'],{cwd,env,encoding:'utf8'});
 for(const row of modules.trim().split('\n')){
  const [name,directory]=row.split('|');if(!directory)continue;
  const files=(await fs.readdir(directory,{withFileTypes:true})).filter(f=>f.isFile()&&/^(license|copying|notice|patents)/i.test(f.name));
  const destination=path.join(licenses,'tsnet',name.replace(/[^a-zA-Z0-9_.-]/g,'_'));await fs.mkdir(destination,{recursive:true});
  for(const file of files)await fs.copyFile(path.join(directory,file.name),path.join(destination,file.name));
 }
 await fs.chmod(target,0o755);return target;
}
module.exports={build,toolchain};
if(require.main===module)(process.argv.includes('--toolchain')?toolchain().then(p=>console.log(p)):build()).catch(e=>{console.error(e.message);process.exitCode=1;});
