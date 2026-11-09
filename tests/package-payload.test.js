'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {normalizePayload,deduplicatePayload}=require('../scripts/build-packages');

test('immutable payloads normalize private packager directories for an unprivileged installed user',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-payload-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const desktop=path.join(root,'desktop');await fs.mkdir(desktop,{mode:0o700});
 const launcher=path.join(desktop,'launcher');await fs.writeFile(launcher,'#!/bin/sh\nexit 0\n',{mode:0o700});
 const data=path.join(desktop,'settings.json');await fs.writeFile(data,'{}',{mode:0o600});
 const script=path.join(desktop,'server.js');await fs.writeFile(script,'#!/usr/bin/env node\nconsole.log("server");\n',{mode:0o700});
 await normalizePayload(root,process.arch);
 for(const directory of [root,desktop])assert.equal((await fs.stat(directory)).mode&0o777,0o755);
 assert.equal((await fs.stat(launcher)).mode&0o777,0o755);
 assert.equal((await fs.stat(data)).mode&0o777,0o644);
 assert.equal((await fs.stat(script)).mode&0o777,0o644);
 assert.equal(await fs.readFile(script,'utf8'),'console.log("server");\n');
});

test('immutable dependency duplicates share storage while preserving paths, content and executable modes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-deduplicate-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const server=path.join(root,'server'),desktop=path.join(root,'desktop');
 await fs.mkdir(server);await fs.mkdir(desktop);
 const first=path.join(server,'dependency.js'),second=path.join(desktop,'dependency.js');
 const executable=path.join(desktop,'launcher');
 for(const file of [first,second,executable])await fs.writeFile(file,'identical dependency content');
 await fs.chmod(first,0o644);await fs.chmod(second,0o644);await fs.chmod(executable,0o755);
 await deduplicatePayload(root);
 assert.equal((await fs.stat(first)).ino,(await fs.stat(second)).ino);
 assert.notEqual((await fs.stat(first)).ino,(await fs.stat(executable)).ino);
 for(const file of [first,second,executable])assert.equal(await fs.readFile(file,'utf8'),'identical dependency content');
 assert.equal((await fs.stat(second)).mode&0o777,0o644);
 assert.equal((await fs.stat(executable)).mode&0o777,0o755);
});
test('known type-only tsyringe placeholders remain no-op modules without hiding unexpected empty payload files', async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-type-only-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'node_modules/tsyringe/dist/esm2015/types');await fs.mkdir(dir,{recursive:true});
 const type=path.join(dir,'constructor.js');await fs.writeFile(type,'');
 const unexpected=path.join(root,'truncated.js');await fs.writeFile(unexpected,'');
 await normalizePayload(root,process.arch);
 const data=await fs.readFile(type,'utf8');assert.ok(data.length>0);
 const vm=require('node:vm');const context={};vm.runInNewContext(data,context);assert.deepEqual(context,{});
 assert.equal(await fs.readFile(unexpected,'utf8'),'','unexpected empty scripts remain visible to the package linter');
});
test('packaged dependency verification catches missing transitive modules instead of using checkout dependencies', async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-dependency-closure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({dependencies:{'example-package':'1.0.0'}}));
 const dir=path.join(root,'node_modules/example-package');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'index.js'),"module.exports=require('./archive-output-stream');\n");
 const {verify}=require('../scripts/verify-desktop-dependencies');
 await assert.rejects(verify(root),/Cannot find module/);
 await fs.writeFile(path.join(dir,'archive-output-stream.js'),'module.exports = {};\n');
 assert.equal(await verify(root),1);
});
