'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ShareGateway}=require('../lib/device-share');
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'guest-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let proxied=0;
 const backend=http.createServer((req,res)=>{proxied++;res.end('PRIVATE WORKSPACE');});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));t.after(()=>{backend.closeAllConnections();backend.close();});
 const gateway=new ShareGateway({backend:'http://127.0.0.1:'+backend.address().port,guestRoot:root});
 await gateway.listen();t.after(()=>gateway.close());
 await fs.writeFile(path.join(root,'secret.txt'),'PRIVATE');await fs.writeFile(path.join(root,'chosen.txt'),'SELECTED');
 const session=await gateway.guest.start([path.join(root,'chosen.txt')]);
 const origin=gateway.origin,headers={Authorization:'Bearer '+session.token,Origin:origin};
 return {root,gateway,session,origin,headers,proxied:()=>proxied};
}
test('guest sees only explicit files; guest credentials never unlock workspace or pairing',async t=>{
 const {origin,headers,session,proxied}=await setup(t);
 const paired=await fetch(origin+'/guest/session',{method:'POST',headers});assert.equal(paired.status,200);
 const cookie=paired.headers.get('set-cookie').split(';')[0];
 const info=await paired.json();assert.deepEqual(info.files.map(f=>f.name),['chosen.txt']);assert.equal(JSON.stringify(info).includes('secret'),false);
 assert.match(paired.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\/guest\//);
 const download=await fetch(origin+'/guest/download/'+session.files[0].id,{headers:{Cookie:cookie}});assert.equal(await download.text(),'SELECTED');
 for(const endpoint of ['/secret.txt','/ui/','/push/health','/push/explorer/','/.clipboard.txt','/push/explorer/trash','/push/explorer/download?path=secret.txt']){
  assert.equal((await fetch(origin+endpoint,{headers})).status,401,endpoint);
  assert.equal((await fetch(origin+endpoint,{headers:{Cookie:cookie}})).status,401,endpoint+' cookie');
 }
 for(const endpoint of ['/guest/download/secret.txt','/guest/download/%2e%2e%2fsecret.txt','/guest/push/explorer/','/guest/upload?name=test'])assert.equal((await fetch(origin+endpoint,{headers})).status,404);
 assert.equal((await fetch(origin+'/pair/',{method:'POST',headers,body:JSON.stringify({token:session.token})})).status,403);
 assert.equal(proxied(),0);
});
test('uploads are isolated and cannot overwrite or traverse; origin and size are enforced',async t=>{
 const {origin,headers,root,proxied}=await setup(t);
 for(let i=0;i<2;i++)assert.equal((await fetch(origin+'/guest/upload?name=secret.txt',{method:'PUT',headers,body:'NEW'})).status,201);
 assert.equal(await fs.readFile(path.join(root,'secret.txt'),'utf8'),'PRIVATE');
 const inbox=(await fs.readdir(root)).find(n=>n.startsWith('Guest uploads-'));
 assert.deepEqual((await fs.readdir(path.join(root,inbox))).sort(),['secret (1).txt','secret.txt']);
 for(const name of ['../secret.txt','.clipboard.txt','a/b','a\\b'])assert.equal((await fetch(origin+'/guest/upload?name='+encodeURIComponent(name),{method:'PUT',headers,body:'bad'})).status,400);
 assert.equal((await fetch(origin+'/guest/upload?name=x',{method:'PUT',headers:{...headers,Origin:'https://evil.example'},body:'bad'})).status,403);
 assert.equal((await fetch(origin+'/guest/upload?name=x',{method:'PUT',headers:{Authorization:headers.Authorization},body:'bad'})).status,403);
 assert.equal((await fetch(origin+'/guest/session',{method:'DELETE',headers})).status,404);
 assert.equal(proxied(),0);
});
test('stopping, rotating and expiring revoke downloads and uploads',async t=>{
 const {gateway,origin,headers}=await setup(t);
 await gateway.guest.start([]);
 assert.equal((await fetch(origin+'/guest/session',{method:'POST',headers})).status,403);
 const current=gateway.guest.session;const nextHeaders={Authorization:'Bearer '+current.token,Origin:origin};
 current.expires=Date.now()-1;
 assert.equal((await fetch(origin+'/guest/upload?name=x',{method:'PUT',headers:nextHeaders,body:'bad'})).status,403);
 await gateway.guest.close();assert.equal((await fetch(origin+'/guest/session',{method:'POST',headers:nextHeaders})).status,403);
});
test('symlinks cannot be selected for guest downloads',async t=>{
 const {gateway,root}=await setup(t);
 await fs.symlink(path.join(root,'secret.txt'),path.join(root,'link.txt'));
 await assert.rejects(gateway.guest.start([path.join(root,'link.txt')]));
});
test('guest upload count, byte budget and concurrent request limits are enforced',async t=>{
 const {gateway,origin,headers}=await setup(t);const s=gateway.guest.session;
 for(const [key,value] of [['count',100],['bytes',1024*1024*1024],['active',2]]){
  s[key]=value;
  assert.equal((await fetch(origin+'/guest/upload?name=x',{method:'PUT',headers,body:'bad'})).status,429);
  s[key]=0;
 }
 const response=await new Promise((resolve,reject)=>{
  const req=http.request(origin+'/guest/upload?name=x',{method:'PUT',headers:{...headers,'Content-Length':100*1024*1024+1}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();
 });assert.equal(response,413);
});
test('controller creates a guest-only QR and disconnect revokes the guest session',async t=>{
 const {gateway,root,origin}=await setup(t);
 const {Devices}=require('../lib/devices'),jsQR=require('jsqr'),{PNG}=require('pngjs');
 const controller=new Devices({directory:root,guestRoot:root});controller.gateway=gateway;controller.state={status:'ready'};
 const session=await controller.startGuest([]),png=PNG.sync.read(Buffer.from(session.qr.split(',')[1],'base64'));
 assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,session.url);
 assert.ok(session.url.startsWith(origin+'/guest/#'));assert.notEqual(session.url,gateway.url());
 const headers={Authorization:'Bearer '+session.url.split('#')[1],Origin:origin};
 assert.equal((await fetch(origin+'/guest/session',{method:'POST',headers})).status,200);
 await controller.stopGuest();assert.equal((await fetch(origin+'/guest/session',{method:'POST',headers})).status,403);
});
