'use strict';
// Actual uninstall/reinstall cycle; never delete user data or use the default workspace.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const id='io.github.fluffydisk.airdrop-linux',repo=process.argv[2];
assert.ok(repo,'Pass the built repository');
const root='/var/data/airdrop-reference-persistence-'+randomUUID();
const token='persistent-'+randomUUID();
function node(code){return execFileSync('flatpak',['run','--user','--env=AIRDROP_HOME='+root,
 '--command=/app/lib/airdrop-linux/runtime/node',id,'-e',code,token],{encoding:'utf8'}).trim();}
const before=node('const fs=require("node:fs"),path=require("node:path");const root=process.env.AIRDROP_HOME;fs.mkdirSync(root+"/files",{recursive:true});fs.writeFileSync(root+"/files/persistence.txt",process.argv[1],{flag:"wx",mode:0o600});console.log(root);');
execFileSync('flatpak',['uninstall','--user','--noninteractive',id],{stdio:'inherit'});
assert.throws(()=>execFileSync('flatpak',['info','--user',id],{stdio:'pipe'}),'Uninstall must remove the application');
execFileSync('flatpak',['install','--user','--noninteractive',repo,id],{stdio:'inherit'});
assert.equal(node('const fs=require("node:fs"),assert=require("node:assert/strict");assert.equal(fs.readFileSync(process.env.AIRDROP_HOME+"/files/persistence.txt","utf8"),process.argv[1]);console.log(process.env.AIRDROP_HOME);'),before);
console.log('Real uninstall/reinstall preserved exact private workspace bytes; default and native user data were not touched');
