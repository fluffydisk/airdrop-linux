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
