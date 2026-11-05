'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ShareGateway}=require('../lib/device-share');
test('public probe distinguishes HTTP, unexpected health, DNS and TLS without retaining private error text',async()=>{
 const gateway=new ShareGateway({secure:true});gateway.setOrigin('https://health.trycloudflare.com');
 await assert.rejects(gateway.probe({request:async()=>new Response('upstream unavailable',{status:503})}),e=>e.code==='HTTP'&&e.httpStatus===503&&e.scope==='public');
 await assert.rejects(gateway.probe({request:async()=>Response.json({push:true,share:false})}),e=>e.code==='CONTENT');
 for(const [code,expected] of [['ENOTFOUND','DNS'],['ERR_CERT_AUTHORITY_INVALID','TLS'],['ETIMEDOUT','TIMEOUT'],['ECONNREFUSED','REFUSED']]){
  await assert.rejects(gateway.probe({request:async()=>{throw Object.assign(Error('private pairing token and URL'),{code});}}),e=>e.code===expected&&!e.message.includes('private pairing'));
 }
});
