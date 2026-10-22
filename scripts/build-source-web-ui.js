'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createWriteStream}=require('node:fs');
const {pipeline}=require('node:stream/promises');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');

async function buildSourceWebUI(entry,tools,destination) {
 const browserify=require(require.resolve('browserify',{paths:[tools]}));
 await fs.mkdir(destination,{recursive:true});
 const output=path.join(destination,'jszip.min.js');
 // Keep the legacy asset URL, but regenerate readable browser code directly
 // from JSZip's lib/ entry. Its npm browser field otherwise redirects to dist/.
 // A custom (absent) browser field keeps browser-resolve's built-in shims
 // while ignoring JSZip's standard browser redirect to the prebuilt dist/.
 const bundle=browserify(entry,{standalone:'JSZip',browserField:'__airdrop_source_browser__',debug:false});
 const files=new Set();bundle.on('file',file=>files.add(file));
 await pipeline(bundle.bundle(),createWriteStream(output));
 const packages=new Map(),sources=[];
 for(const file of [...files].sort()) {
  if(/[\\/]jszip[\\/]dist[\\/]/.test(file))throw new Error('Web bundle consumed prebuilt JSZip distribution');
  let folder=path.dirname(file),metadata;
  while(folder!==path.dirname(folder)) {
   try{metadata=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));break;}
   catch(error){if(error.code!=='ENOENT')throw error;folder=path.dirname(folder);}
  }
  if(!metadata?.name || !metadata.version)throw new Error('Unknown browser bundle source package');
  packages.set(folder,metadata);
  sources.push({package:metadata.name,version:metadata.version,file:path.relative(folder,file),sha256:hash(await fs.readFile(file))});
 }
 // Also retain the licenses for the bundler's runtime wrapper templates.
 for(const name of ['browserify','browser-pack','umd']) {
  const packageJSON=require.resolve(name+'/package.json',{paths:[tools]});
  packages.set(path.dirname(packageJSON),JSON.parse(await fs.readFile(packageJSON,'utf8')));
 }
 for(const [folder,metadata] of packages) {
  const label=(metadata.name+'-'+metadata.version).replace(/[^A-Za-z0-9._-]/g,'_');
  for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
   if(entry.isFile() && /^(?:licen[sc]e|copying|notice)(?:[._-]|$)/i.test(entry.name)) {
    const target=path.join(destination,'licenses',label,entry.name);
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(folder,entry.name),target);
   }
  }
 }
 await fs.writeFile(path.join(destination,'source-bundle.json'),JSON.stringify({
  entry:'jszip/lib/index.js',sources,bundleSha256:hash(await fs.readFile(output)),
  sourceToolsLockSha256:hash(await fs.readFile(path.join(__dirname,'../packaging/source-tools/package-lock.json')))
 },null,2)+'\n');
 return output;
}
module.exports={buildSourceWebUI};
