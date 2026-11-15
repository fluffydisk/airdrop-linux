'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {transferConsent}=require('../desktop/transfer-consent');
test('authentic Quick Share comparison code is in primary native text and decline stays the default',()=>{
  const request={type:'receive',transport:'quick-share',code:'0123',name:'Android',files:[{name:'lab-small.txt'}],total:49};
  const options=transferConsent(request,{lab:true});
  assert.ok(options.message.includes('Verification code: 0123'));
  assert.match(options.message,/Decline if the codes differ/);
  assert.equal(options.buttons[0],'Codes match — accept files');
  assert.equal(options.defaultId,1);assert.equal(options.cancelId,1);
  assert.equal(options.detail.includes('0123'),false);
  for(const code of [undefined,'123','12345','1234\nsecret'])assert.throws(()=>transferConsent({...request,code}),/unavailable/);
  assert.equal(request.code,'0123');
});
