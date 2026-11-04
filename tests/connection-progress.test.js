'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('connection progress shows setup, connection, verification, reconnect, failure and actual readiness',()=>{
 const d=new JSDOM('',{runScripts:'outside-only'});try{
 d.window.eval(fs.readFileSync('desktop/connection-progress.js','utf8'));const describe=d.window.AirdropConnectionProgress.describe;
 const verifying=describe({mode:'private',status:'checking'},75);assert.equal(verifying.spinning,true);assert.equal(verifying.elapsed,75);assert.match(verifying.hint,/Taking longer/);assert.equal(verifying.step,2);
 const setup=describe({mode:'private',status:'setup-required',message:'Configure relay'});assert.equal(setup.spinning,false);assert.match(setup.hint,/Connect over Wi-Fi/);
 assert.match(describe({mode:'private',status:'reconnecting',message:'Retrying'}).title,/Reconnecting/);
 assert.equal(describe({mode:'private',status:'error',message:'Network failed'}).hint,'Network failed');
 assert.equal(describe({mode:'private',status:'ready',url:'https://workspace.example.com/pair/',qr:'data:fixture'}).ready,true);
 assert.equal(describe({mode:'private',status:'ready',url:'',qr:''}).ready,false);
 assert.equal(describe({mode:'local',status:'local'}).active,false);
 }finally{d.window.close();}
});
