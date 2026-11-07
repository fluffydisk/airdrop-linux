'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('AppStream latest release matches the application and lockfile versions',()=>{
 const version=require('../package.json').version;
 const xml=fs.readFileSync(require.resolve('../packaging/io.github.fluffydisk.airdrop-linux.metainfo.xml'),'utf8');
 assert.equal(xml.match(/<release\s+version="([^"]+)"/)[1],version);
 for(const file of ['../package-lock.json','../desktop/package.json','../desktop/package-lock.json'])assert.equal(require(file).version,version,file);
});
