'use strict';
const http=require('node:http'),crypto=require('node:crypto'),os=require('node:os');
function privateIPv4(address){return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);}
function lanAddresses(interfaces=os.networkInterfaces()){
 return Object.entries(interfaces).flatMap(([name,entries])=>entries.filter(e=>e.family==='IPv4'&&!e.internal&&privateIPv4(e.address)).map(e=>({name,address:e.address})))
  .sort((a,b)=>Number(!/^(wl|en|eth)/.test(a.name))-Number(!/^(wl|en|eth)/.test(b.name))||a.name.localeCompare(b.name));
}
const pairingScript=`'use strict';(async()=>{const token=location.hash.slice(1);history.replaceState(null,'','/pair/');const message=document.getElementById('message');if(!token){message.textContent='Scan a fresh QR code from Airdrop on your computer.';return;}try{const response=await fetch('/pair/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw Error();location.replace('/ui/');}catch{message.textContent='This link expired or could not connect. Scan a new QR code.';}})();`;
class ShareGateway{
 constructor({backend='http://127.0.0.1:6001',secure=false}={}){
  const target=new URL(backend);if(target.protocol!=='http:'||target.hostname!=='127.0.0.1')throw Error('Backend must stay on loopback');
  this.backend=target;this.secure=secure;this.token=crypto.randomBytes(32).toString('base64url');this.cookie='airdrop_'+crypto.randomBytes(8).toString('hex');this.sockets=new Set();
 }
 setOrigin(origin){const url=new URL(origin);if(this.secure&&(url.protocol!=='https:'||!url.hostname.endsWith('.ts.net')||url.port||url.username||url.password))throw Error('Invalid tailnet origin');this.origin=url.origin;}
 authenticated(req){
  let candidate=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
  if(!candidate){const cookie=(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(this.cookie+'='));candidate=cookie?.slice(this.cookie.length+1)||'';}
  const a=Buffer.from(candidate),b=Buffer.from(this.token);return a.length===b.length&&crypto.timingSafeEqual(a,b);
 }
 async listen(address='127.0.0.1'){
  this.server=http.createServer((req,res)=>this.handle(req,res));this.server.requestTimeout=300000;this.server.headersTimeout=15000;
  this.server.on('connection',socket=>{this.sockets.add(socket);socket.on('close',()=>this.sockets.delete(socket));});
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,address,resolve);});
  const port=this.server.address().port;
  if(!this.secure)this.setOrigin('http://'+address+':'+port);
  return {address,port,target:'http://127.0.0.1:'+port};
 }
 async handle(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  if(!this.origin||req.headers.host!==new URL(this.origin).host){res.writeHead(421);res.end('Unknown sharing address');return;}
  const path=req.url.split('?')[0];
  if(path==='/pair/'&&req.method==='GET'){
   res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';connect-src 'self';base-uri 'none';frame-ancestors 'none'");
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Connect to Airdrop</title><h1>Airdrop</h1><p id="message">Connecting securely to the workspace…</p><script src="/pair/pair.js"></script>');return;
  }
  if(path==='/pair/pair.js'&&req.method==='GET'){res.setHeader('Content-Type','text/javascript');res.end(pairingScript);return;}
  if(path==='/pair/'&&req.method==='POST'){
   if(req.headers.origin!==this.origin){res.writeHead(403);res.end();return;}
   let body='';try{for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>512){res.writeHead(413);res.end();return;}}}catch{return;}
   let token;try{token=JSON.parse(body).token;}catch{}
   if(typeof token!=='string'||!this.authenticated({headers:{authorization:'Bearer '+token}})){res.writeHead(403);res.end();return;}
   res.setHeader('Set-Cookie',this.cookie+'='+this.token+'; HttpOnly; SameSite=Strict; Path=/'+(this.secure?'; Secure':''));res.writeHead(204);res.end();return;
  }
  if(!this.authenticated(req)){res.writeHead(401);res.end('Scan a fresh QR code from the desktop to connect.');return;}
  if(['CONNECT','TRACE'].includes(req.method)||(req.headers.origin&&req.headers.origin!==this.origin)){res.writeHead(403);res.end();return;}
  const headers={...req.headers,host:new URL(this.origin).host};
  for(const key of Object.keys(headers))if(['cookie','authorization','connection','proxy-authorization','forwarded'].includes(key)||key.startsWith('x-forwarded-'))delete headers[key];
  const upstream=http.request({hostname:this.backend.hostname,port:this.backend.port,path:req.url,method:req.method,headers},incoming=>{
   const responseHeaders={...incoming.headers,'cache-control':'no-store','referrer-policy':'no-referrer'};delete responseHeaders['set-cookie'];delete responseHeaders.connection;
   res.writeHead(incoming.statusCode,responseHeaders);incoming.on('error',()=>res.destroy());incoming.pipe(res);res.on('close',()=>incoming.destroy());
  });
  upstream.on('error',()=>{if(!res.headersSent){res.writeHead(503);res.end('Local workspace is not ready');}else res.destroy();});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 }
 async probe(){
  const response=await fetch(this.origin+'/push/health',{headers:{Authorization:'Bearer '+this.token},signal:AbortSignal.timeout(5000),redirect:'error'});
  const health=await response.json();if(!response.ok||health.push!==true||health.share!==true)throw Error('The sharing endpoint did not pass its health check');
 }
 url(){if(!this.origin)throw Error('Sharing origin not verified');return this.origin+'/pair/#'+this.token;}
 async close(){for(const socket of this.sockets)socket.destroy();if(this.server)await new Promise(resolve=>this.server.close(resolve));this.server=null;this.token=crypto.randomBytes(32).toString('base64url');}
}
module.exports={ShareGateway,lanAddresses,privateIPv4};
