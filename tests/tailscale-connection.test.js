'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {TailscaleConnection}=require('../lib/tailscale-connection');
test('embedded Tailscale validates login/origin events, waits for verified HTTPS, keeps the parent pipe open and stops only its child',async t=>{
 let child,parameters;const states=[];
 const connection=new TailscaleConnection({helper:'/fixture/airdrop-tsnet',directory:'/fixture/state',target:'http://127.0.0.1:1234',token:'private-test-token',onState:s=>states.push(s),spawnProcess:(file,args)=>{
  parameters=args;child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;child.kill=signal=>{child.exitCode=0;child.emit('exit',0,signal);};return child;
 }});t.after(()=>connection.stop());connection.start();assert.equal(child.stdin.writableEnded,false);assert.ok(parameters.includes('--state-dir'));assert.ok(!parameters.includes('private-test-token'));
 child.stdout.write(JSON.stringify({state:'NeedsLogin',authURL:'https://login.tailscale.com.evil.example/a'})+'\n');assert.equal(states.at(-1).authURL,'');
 child.stdout.write(JSON.stringify({state:'NeedsLogin',authURL:'https://login.tailscale.com/a/fixture'})+'\n');assert.equal(states.at(-1).status,'needs-login');assert.ok(states.at(-1).authURL);
 child.stdout.write(JSON.stringify({state:'connected',origin:'https://airdrop.ts.net.evil.example',ready:true})+'\n');assert.equal(states.at(-1).verified,false);
 child.stdout.write(JSON.stringify({state:'checking-https',origin:'https://airdrop.example.ts.net'})+'\n');assert.equal(states.at(-1).verified,false);
 child.stdout.write(JSON.stringify({state:'connected',origin:'https://airdrop.example.ts.net',ready:true})+'\n');assert.equal(states.at(-1).verified,true);
 const count=states.length;await connection.stop();child.stdout.write('{}\n');assert.equal(states.length,count);assert.equal(child.exitCode,0);
});
