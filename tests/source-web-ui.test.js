'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const JSZip=require('jszip');
const {buildSourceWebUI}=require('../scripts/build-source-web-ui');

test('browser ZIP library is rebuilt from lib sources and produces a valid Unicode archive',async t=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-source-web-'));
 t.after(()=>fs.rm(out,{recursive:true,force:true}));
 const bundle=await buildSourceWebUI(require.resolve('jszip/lib/index.js'),path.join(__dirname,'../packaging/source-tools'),out);
 const context={setTimeout,clearTimeout,Promise,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,Blob};
 context.window=context;context.self=context;
 vm.runInNewContext(await fs.readFile(bundle,'utf8'),context);
 const browserZip=new context.JSZip();browserZip.file('Türkçe.txt','Merhaba 👋');
 const bytes=await browserZip.generateAsync({type:'uint8array',compression:'DEFLATE'});
 const result=await JSZip.loadAsync(Buffer.from(bytes));
 assert.equal(await result.file('Türkçe.txt').async('string'),'Merhaba 👋');
 const record=JSON.parse(await fs.readFile(path.join(out,'source-bundle.json'),'utf8'));
 assert.ok(record.sources.some(source=>source.package==='jszip' && source.file==='lib/index.js'));
 assert.ok(!record.sources.some(source=>source.package==='jszip' && source.file.startsWith('dist/')));
 assert.match(record.bundleSha256,/^[a-f0-9]{64}$/);
 assert.ok((await fs.readdir(path.join(out,'licenses'))).some(name=>name.startsWith('jszip-')));
});
