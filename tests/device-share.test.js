'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ShareGateway,lanAddresses}=require('../lib/device-share');
const {Devices}=require('../lib/devices');
const jsQR=require('jsqr'),{PNG}=require('pngjs');
async function backend(t){
 const server=http.createServer((req,res)=>{
  if(req.url==='/push/health'){res.setHeader('Content-Type','application/json');res.end('{"push":true,"share":true}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,cookie:req.headers.cookie||'',authorization:req.headers.authorization||''}));
 });server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
 return 'http://127.0.0.1:'+server.address().port;
}
test('LAN discovery excludes loopback, public and host Tailscale addresses',()=>{
 const i={eth0:[{family:'IPv4',address:'192.168.1.2',internal:false}],lo:[{family:'IPv4',address:'127.0.0.1',internal:true}],tailscale0:[{family:'IPv4',address:'100.64.0.1',internal:false}],public:[{family:'IPv4',address:'8.8.8.8',internal:false}]};
 assert.deepEqual(lanAddresses(i),[{name:'eth0',address:'192.168.1.2'}]);
});
test('pairing protects the actual proxy; foreign origins, wrong host and stale tokens fail',async t=>{
 const gateway=new ShareGateway({backend:await backend(t)});await gateway.listen();t.after(()=>gateway.close());
 const origin=gateway.origin,token=new URL(gateway.url()).hash.slice(1);
 assert.equal((await fetch(origin+'/private-file')).status,401);
 assert.equal((await fetch(origin+'/pair/',{method:'POST',headers:{Origin:'http://evil.example'},body:JSON.stringify({token})})).status,403);
 assert.equal((await fetch(origin+'/pair/',{method:'POST',headers:{Origin:origin},body:JSON.stringify({token:'wrong'})})).status,403);
 const pair=await fetch(origin+'/pair/',{method:'POST',headers:{Origin:origin},body:JSON.stringify({token})});assert.equal(pair.status,204);
 const cookie=pair.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const result=await(await fetch(origin+'/file.txt',{headers:{Cookie:cookie.split(';')[0]}})).json();
 assert.equal(result.path,'/file.txt');assert.equal(result.cookie,'');assert.equal(result.authorization,'');
 assert.equal((await fetch(origin+'/file.txt',{method:'DELETE',headers:{Cookie:cookie.split(';')[0],Origin:'http://evil.example'}})).status,403);
 const wrongHost=await new Promise((resolve,reject)=>{const req=http.get(origin+'/private-file',{headers:{Host:'evil.example',Cookie:cookie.split(';')[0]}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
 assert.equal(wrongHost,421);
 await gateway.close();await assert.rejects(fetch(origin+'/private-file'));
});
test('tailnet origin requires real HTTPS .ts.net identity before a gateway can advertise',()=>{
 const gateway=new ShareGateway({secure:true});assert.throws(()=>gateway.url());
 for(const origin of ['http://host.ts.net','https://example.com','https://user@host.ts.net'])assert.throws(()=>gateway.setOrigin(origin));
});
test('controlled helper states do not advertise a DNS name before HTTPS is verified',async()=>{
 const devices=new Devices({directory:'/unused'});devices.state.mode='tailscale';devices.gateway=new ShareGateway({secure:true});
 await devices.receive({state:'NeedsLogin',authURL:'https://evil.example/login'});assert.equal(devices.state.authURL,'');assert.equal(devices.state.url,'');
 await devices.receive({state:'needs-https',origin:'https://node.tail.ts.net',message:'Certificate approval needed'});assert.equal(devices.state.qr,'');assert.equal(devices.state.url,'');
 await devices.receive({state:'https-unavailable',origin:'https://node.tail.ts.net'});assert.equal(devices.state.url,'');
 await devices.stop();
});
test('controller never advertises loopback or an unavailable helper',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-devices-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const devices=new Devices({directory,backend:await backend(t)});await devices.initialize();t.after(()=>devices.stop());
 assert.equal((await devices.snapshot()).configured,false);
 const bad=await devices.action('lan','127.0.0.1');assert.equal(bad.status,'error');assert.equal(bad.url,'');assert.equal(bad.qr,'');
 const missing=await devices.action('tailscale');assert.equal(missing.status,'error');assert.equal(missing.url,'');
 assert.equal((await devices.action('local')).status,'local');
});
test('real LAN interface self-probe produces a decodable QR and revokes sharing on disconnect',async t=>{
 const address=lanAddresses()[0]?.address;if(!address){t.skip('No private LAN interface on this worker');return;}
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-lan-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const devices=new Devices({directory,backend:await backend(t)});await devices.initialize();t.after(()=>devices.stop());
 const state=await devices.action('lan',address);assert.equal(state.status,'ready',state.message);
 assert.equal(new URL(state.url).hostname,address);assert.notEqual(address,'127.0.0.1');
 const image=PNG.sync.read(Buffer.from(state.qr.split(',')[1],'base64'));
 const decoded=jsQR(new Uint8ClampedArray(image.data),image.width,image.height);assert.equal(decoded.data,state.url);
 const origin=new URL(state.url).origin;
 const response=await fetch(origin+'/pair/',{method:'POST',headers:{Origin:origin},body:JSON.stringify({token:new URL(decoded.data).hash.slice(1)})});assert.equal(response.status,204);
 assert.equal((await fetch(origin+'/push/health',{headers:{Cookie:response.headers.get('set-cookie').split(';')[0]}})).status,200);
 await devices.action('local');assert.equal((await devices.snapshot()).url,'');await assert.rejects(fetch(origin+'/push/health'));
});
