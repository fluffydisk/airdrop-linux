'use strict';
// Laboratory-only opt-in. Never forward an arbitrary socket/environment into production.
const fs=require('node:fs'),path=require('node:path');
function traceSocket(value){
 if(value===undefined)return null;
 if(typeof value!=='string'||!path.isAbsolute(value)||Buffer.byteLength(value)>100)throw Error('Invalid laboratory trace socket');
 const parent=path.dirname(value),dir=fs.lstatSync(parent),leaf=fs.lstatSync(value),uid=process.getuid();
 if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==uid||(dir.mode&0o077)||fs.realpathSync(parent)!==parent||!leaf.isSocket()||leaf.isSymbolicLink()||leaf.uid!==uid||(leaf.mode&0o077))throw Error('Laboratory trace socket must have private owned scope');
 return value;
}
module.exports={traceSocket};
