'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('progress distinguishes sign-in, certificate checks, admin approval, failure and success without invented percentages',()=>{
 const d=new JSDOM('',{runScripts:'outside-only'});try{
 d.window.eval(fs.readFileSync('desktop/connection-progress.js','utf8'));const describe=d.window.AirdropConnectionProgress.describe;
 const tls=describe({mode:'tailscale',status:'https-unavailable'},75);assert.equal(tls.spinning,true);assert.equal(tls.elapsed,75);assert.match(tls.hint,/Taking longer/);assert.match(tls.hint,/automatically/);
 const login=describe({mode:'tailscale',status:'NeedsLogin',authURL:'https://login.tailscale.com/test'});assert.equal(login.spinning,false);assert.match(login.hint,/Click Sign in/);
 const settings=describe({mode:'tailscale',status:'needs-https'});assert.equal(settings.spinning,false);assert.match(settings.hint,/MagicDNS/);
 assert.match(describe({mode:'tailscale',status:'NeedsMachineAuth'}).title,/approval/);
 assert.equal(describe({mode:'tailscale',status:'error',message:'Network failed'}).hint,'Network failed');
 assert.equal(describe({mode:'tailscale',status:'ready',url:'https://example.ts.net/pair/',qr:'data:fixture'}).ready,true);
 assert.equal(describe({mode:'tailscale',status:'ready',url:'',qr:''}).ready,false);
 }finally{d.window.close();}
});
