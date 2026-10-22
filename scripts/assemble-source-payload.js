#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync:run}=require('node:child_process');
const {verifySourceRuntimes,verifyOfflineCache}=require('./source-runtime-inputs');
const {stage}=require('./build-packages');
const root=path.resolve(__dirname,'..');

async function assemble(runtimeDirectory,offlineCache,output) {
 runtimeDirectory=path.resolve(runtimeDirectory);offlineCache=path.resolve(offlineCache);output=path.resolve(output);
 // Every install/build command, including npm, must be network isolated.
 run('python3',['-c','import socket; assert [name for _,name in socket.if_nameindex()] == ["lo"], "Source assembly requires an isolated network namespace"']);
 const inputs=await verifySourceRuntimes(runtimeDirectory);
 const electronVersion=run(inputs.electron.binary,['-p','process.versions.electron'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'}).trim();
 if(electronVersion!==inputs.electron.record.version)throw new Error('Source-built Electron version mismatch on the consumer architecture');
 await verifyOfflineCache(offlineCache);
 try{await fs.lstat(output);throw new Error('Source payload output must be new');}catch(error){if(error.code!=='ENOENT')throw error;}
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-source-assembly-'));
 try{
  const desktop=path.join(work,'desktop');await fs.cp(inputs.electron.root,desktop,{recursive:true});
  await fs.rename(path.join(desktop,'electron'),path.join(desktop,'Airdrop'));await fs.chmod(path.join(desktop,'Airdrop'),0o755);
  await fs.rm(path.join(desktop,'resources/default_app.asar'),{force:true});
  const app=path.join(desktop,'resources/app');await fs.mkdir(app,{recursive:true});
  // Application JS/HTML/CSS and locked production dependencies, never a
  // downloaded electron-packager desktop or its prebuilt Electron binary.
  for(const name of ['main.js','preload.js','renderer.js','index.html','style.css','clipboard.js','background.js','package.json','package-lock.json'])
   await fs.copyFile(path.join(root,'desktop',name),path.join(app,name));
  run(process.execPath,[path.join(root,'scripts/prepare-desktop.js'),path.join(app,'core')],{stdio:'inherit'});
  run('npm',['ci','--omit=dev','--ignore-scripts','--offline','--no-audit','--no-fund','--cache',path.join(offlineCache,'npm-cache'),'--registry=http://127.0.0.1:9'],{cwd:app,stdio:'inherit'});
  await stage(output,{source:'flatpak',desktop,sourceRuntimes:runtimeDirectory,offlineCache});
 }finally{await fs.rm(work,{recursive:true,force:true});}
}
if(require.main===module){
 if(process.argv.length!==5)throw new Error('Usage: assemble-source-payload.js RUNTIME_DIRECTORY OFFLINE_NPM_CACHE NEW_OUTPUT');
 assemble(...process.argv.slice(2)).catch(error=>{console.error(error);process.exitCode=1;});
}
module.exports={assemble};
