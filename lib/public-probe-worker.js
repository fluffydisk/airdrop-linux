'use strict';
const {probeAddresses}=require('./public-connection-probe');
const {healthFailure}=require('./connection-health');
process.on('disconnect',()=>process.exit(0));
process.once('message',async options=>{
 let result;
 try{await probeAddresses(options);result={ok:true};}
 catch(error){const failure=healthFailure(error);result={ok:false,code:failure.code,...(failure.httpStatus?{httpStatus:failure.httpStatus}:{})};}
 // The parent closes IPC after consuming the result. Exiting on send completion
 // can overtake message delivery when Electron is busy handling window events.
 if(process.connected)process.send(result,error=>{if(error)process.exit(1);});
});
