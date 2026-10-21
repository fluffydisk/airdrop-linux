'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {normalizePayload}=require('../scripts/build-packages');

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
