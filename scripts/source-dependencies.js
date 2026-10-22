'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

async function prepareSourceDependencies(modules) {
 // tar-stream's conditional Bare imports are unused by Node/Electron. Retain
 // their JS/source/licenses, but never ship their downloaded native addons.
 for(const name of ['bare-fs','bare-path','bare-url'])
  await fs.rm(path.join(modules,name,'prebuilds'),{recursive:true,force:true});
 for(const name of ['jszip','pako'])
  await fs.rm(path.join(modules,name,'dist'),{recursive:true,force:true});
 async function inspect(directory) {
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
   const file=path.join(directory,entry.name);
   if(entry.isDirectory()){await inspect(file);continue;}
   if(!entry.isFile())continue; // npm's CLI symlinks are removed by payload normalization.
   const handle=await fs.open(file);const header=Buffer.alloc(4);
   try{await handle.read(header,0,4,0);}finally{await handle.close();}
   if(/\.(node|bare|so|dll|dylib)$/.test(entry.name) || header.equals(Buffer.from([127,69,76,70])))
    throw new Error('Unexpected prebuilt npm native dependency: '+path.relative(modules,file));
  }
 }
 await inspect(modules);
}
module.exports={prepareSourceDependencies};
