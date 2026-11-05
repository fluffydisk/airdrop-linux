'use strict';
const https=require('node:https'),tls=require('node:tls'),net=require('node:net');
const {HealthError,healthFailure,validHealth}=require('./connection-health');
const resolvers=['https://cloudflare-dns.com/dns-query','https://dns.google/resolve'];
function publicAddress(address){
 if(net.isIP(address)===6)return /^[23][0-9a-f]{3}:/i.test(address);
 if(net.isIP(address)!==4)return false;
 const [a,b]=address.split('.').map(Number);
 return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
// Connect to a resolved address while retaining the original Host, SNI and
// certificate identity. Only the wrapper below selects production addresses.
async function probeAddresses({origin,token,addresses,ca,timeout=5000}){
 const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw new HealthError('TLS');
 if(!ca&&tls.getCACertificates){try{const trusted=[...tls.getCACertificates('default'),...tls.getCACertificates('system')];if(trusted.length)ca=trusted;}catch{/* Retain the runtime's ordinary verified trust store. */}}
 try{await new Promise((resolve,reject)=>{
  const lookup=(hostname,options,done)=>options?.all?done(null,addresses):done(null,addresses[0].address,addresses[0].family);
  const request=https.get(new URL('/push/health',url),{lookup,autoSelectFamily:true,servername:url.hostname,rejectUnauthorized:true,ca,agent:false,signal:AbortSignal.timeout(timeout),headers:{Authorization:'Bearer '+token}},response=>{
   let body='';response.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>8192){reject(new HealthError('CONTENT'));request.destroy();}});
   response.on('error',reject);response.on('end',()=>{try{if(response.statusCode<200||response.statusCode>=300)throw new HealthError('HTTP','public',response.statusCode);let health;try{health=JSON.parse(body);}catch{throw new HealthError('CONTENT');}validHealth(response.statusCode,health);resolve();}catch(error){reject(error);}});
  });request.on('error',reject);
 });}catch(error){throw healthFailure(error);}
}
function createPublicProbe({request=fetch,resolveProxy=async()=>'',environment=process.env,probeResolved=probeAddresses}={}){
 const cache=new Map();
 async function resolve(hostname){
  const saved=cache.get(hostname);if(saved&&saved.expires>Date.now()){if(saved.addresses)return saved.addresses;throw new HealthError('DNS');}
  for(const resolver of resolvers){
   const answers=await Promise.allSettled(['A','AAAA'].map(async type=>{
    const url=new URL(resolver);url.searchParams.set('name',hostname);url.searchParams.set('type',type);
    const response=await request(url.href,{headers:{Accept:'application/dns-json'},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new HealthError('DNS');const data=await response.json();
    if(data.Status!==0||!Array.isArray(data.Answer))throw new HealthError('DNS');
    return data.Answer.filter(a=>[1,28].includes(a.type)&&publicAddress(a.data)).map(a=>({address:a.data,family:net.isIP(a.data)}));
   }));
   const addresses=answers.filter(a=>a.status==='fulfilled').flatMap(a=>a.value);
   if(addresses.length){cache.set(hostname,{addresses,expires:Date.now()+60000});return addresses;}
  }
  cache.set(hostname,{expires:Date.now()+60000});throw new HealthError('DNS');
 }
 return async gateway=>{
  gateway.probeTransport='system';gateway.dnsFallback='not-needed';
  try{return await gateway.probe({request});}catch(original){
   const error=healthFailure(original),url=new URL(gateway.origin);
   if(error.scope!=='public'||error.code!=='DNS'||url.protocol!=='https:'||url.port||!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url.origin))throw error;
   // A native socket must never replace a configured proxy route. DNS over
   // HTTPS requests themselves use the normal Electron network transport.
   if(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].some(key=>environment[key])){gateway.dnsFallback='configured-proxy';throw error;}
   let proxy;try{proxy=await resolveProxy(url.origin);}catch{gateway.dnsFallback='proxy-unavailable';throw error;}
   if(typeof proxy!=='string'||proxy.trim().toUpperCase()!=='DIRECT'){gateway.dnsFallback='configured-proxy';throw error;}
   let addresses;try{addresses=await resolve(url.hostname);}catch{gateway.dnsFallback='resolver-unavailable';throw error;}
   gateway.probeTransport='secure-dns';gateway.dnsFallback='resolved';
   await probeResolved({origin:url.origin,token:gateway.token,addresses});
   gateway.dnsFallback='used';
  }
 };
}
module.exports={createPublicProbe,probeAddresses,publicAddress};
