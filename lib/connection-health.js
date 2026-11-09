'use strict';
// Diagnostics use bounded categories, never raw network errors containing URLs,
// pairing capabilities, proxy credentials or local filesystem paths.
class HealthError extends Error {
  constructor(code,scope='public',httpStatus){
    const name=scope==='local'?'The local workspace':'The sharing address';
    const reason={DNS:'could not be resolved by DNS',TLS:'failed its HTTPS certificate check',TIMEOUT:'did not respond in time',REFUSED:'refused the connection',NETWORK:'could not be reached',CONTENT:'did not return the expected workspace health response'}[code];
    super(code==='TUNNEL'?'Cloudflare cannot reach this temporary tunnel (Error 1033). A new connection is needed.':httpStatus?`${name} returned HTTP ${httpStatus}.`:`${name} ${reason||'could not be verified'}.`);
    this.code=code;this.scope=scope;if(httpStatus)this.httpStatus=httpStatus;
  }
}
function healthFailure(error,scope='public'){
  if(error instanceof HealthError)return error;
  const source=[error?.code,error?.cause?.code,error?.name,error?.message].join(' ');
  const code=/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(source)?'DNS':/CERT_|ERR_CERT|certificate|SSL_|TLS_/i.test(source)?'TLS':/TimeoutError|ETIMEDOUT|ERR_TIMED_OUT|AbortError/i.test(source)?'TIMEOUT':/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(source)?'REFUSED':'NETWORK';
  return new HealthError(code,scope);
}
function validHealth(status,health,scope='public'){
  if(status<200||status>=300)throw new HealthError('HTTP',scope,status);
  if(health?.push!==true||health?.share!==true)throw new HealthError('CONTENT',scope);
}
module.exports={HealthError,healthFailure,validHealth};
