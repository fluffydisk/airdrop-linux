'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
const manage = require('../lib/manage');
const { getPaths } = require('../lib/paths');
async function fixture(t) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-packages-'));
 const home=path.join(directory,'home');await fs.mkdir(home);
 const paths=getPaths({home,root:path.join(home,'airdrop')});
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await manage.initialize(paths);return {directory,home,paths};
}
test('setup preserves VAPID identity and permissions on repeated initialization',async t=>{
 const {paths}=await fixture(t);const identity=await fs.readFile(paths.env,'utf8');
 await manage.initialize(paths);assert.equal(await fs.readFile(paths.env,'utf8'),identity);
 assert.equal((await fs.stat(paths.env)).mode & 0o777,0o600);
});
test('unsafe roots and symlink data roots are rejected',async t=>{
 const {directory,home,paths}=await fixture(t);
 await assert.rejects(manage.safeRoot(home,home),/unsafe/);
 await assert.rejects(manage.safeRoot('/',home),/unsafe/);
 const link=path.join(directory,'link');await fs.symlink(paths.root,link);
 await assert.rejects(manage.safeRoot(link,home),/symbolic/);
});
test('ownership verification refuses altered files and unrelated paths before running commands',async t=>{
 const {home,paths}=await fixture(t);const helper=path.join(home,'.local/bin/airdrop');
 await fs.mkdir(path.dirname(helper),{recursive:true});await fs.writeFile(helper,'owned');
 const marker=await manage.record(paths,[helper]);
 assert.deepEqual(await manage.matchingFiles(marker,home),[helper]);
 await fs.writeFile(helper,'changed');
 await assert.rejects(manage.matchingFiles(marker,home),/changed/);
 await assert.rejects(manage.matchingFiles({...marker,files:[{path:'/etc/passwd',sha256:''}]},home),/Invalid/);
});
test('managed uninstall preserves data; permission failure never deletes requested data',async t=>{
 const {paths,home}=await fixture(t);await manage.record(paths,[],'apt');
 await fs.writeFile(path.join(paths.files,'keep.txt'),'user data');const calls=[];
 await manage.uninstall({paths,home,source:'apt',execute:async(...args)=>calls.push(args)});
 assert.equal(await fs.readFile(path.join(paths.files,'keep.txt'),'utf8'),'user data');
 assert.deepEqual(calls.map(c=>c[0]),['systemctl','sudo']);
 await assert.rejects(manage.uninstall({paths,home,source:'apt',deleteData:true,execute:async()=>{throw new Error('denied');}}),/denied/);
 assert.equal(await fs.readFile(path.join(paths.files,'keep.txt'),'utf8'),'user data');
 await manage.uninstall({paths,home,source:'apt',deleteData:true,execute:async()=>{}});
 await assert.rejects(fs.access(paths.root));
});
test('installed script CLI removes owned code and launchers while retaining data by default',async t=>{
 const {paths,home}=await fixture(t);
 await fs.mkdir(paths.server,{recursive:true});
 for(const name of ['lib','bin','scripts','ui'])await fs.cp(name,path.join(paths.server,name),{recursive:true});
 await fs.symlink(path.resolve('node_modules'),path.join(paths.server,'node_modules'));
 const helper=path.join(home,'.local/bin/airdrop');await fs.mkdir(path.dirname(helper),{recursive:true});await fs.writeFile(helper,'owned');
 await fs.writeFile(path.join(paths.files,'keep.txt'),'keep');await manage.record(paths,[helper]);
 const cli=path.join(paths.server,'bin/airdrop.js');
 await assert.rejects(run(process.execPath,[cli,'uninstall'],{env:{...process.env,HOME:home,AIRDROP_HOME:paths.root}}),/noninteractive/);
 await fs.access(paths.server);
 const result=await run(process.execPath,[cli,'uninstall','--yes'],{env:{...process.env,HOME:home,AIRDROP_HOME:paths.root}});
 assert.match(result.stdout,/Data retained/);await assert.rejects(fs.access(helper));await assert.rejects(fs.access(paths.app));
 assert.equal(await fs.readFile(path.join(paths.files,'keep.txt'),'utf8'),'keep');
});
test('package update guard rejects mutation before network or filesystem writes',async t=>{
 const {paths}=await fixture(t);await manage.record(paths,[],'rpm');
 const updater=require('../lib/updater');
 await assert.rejects(updater.prepare(paths.root,{}),/package manager/);
 await assert.rejects(updater.activate(paths.root,{}),/package manager/);
 assert.throws(()=>updater.launch(paths.root,{},123),/package manager/);
 await assert.rejects(fs.access(path.join(paths.root,'state/updates')));
});
test('port conflicts produce actionable startup errors',async t=>{
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 await assert.rejects(manage.available(server.address().port),/already in use/);
});
test('distribution marker selects package manager and rejects unknown sources',async t=>{
 const {directory}=await fixture(t);const file=path.join(directory,'distribution.json');
 const distribution=require('../lib/installation').distribution;
 await fs.writeFile(file,JSON.stringify({source:'flatpak'}));
 assert.equal(distribution({AIRDROP_INSTALL_MANIFEST:file}).managed,true);
 assert.match(distribution({AIRDROP_INSTALL_MANIFEST:file}).message,/flatpak update/);
 await fs.writeFile(file,JSON.stringify({source:'invalid'}));
 assert.throws(()=>distribution({AIRDROP_INSTALL_MANIFEST:file}),/Unknown/);
});
test('background portal waits for the matching response; denial and absence fail closed',async()=>{
 const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
 const request=require('../desktop/background').requestBackground;
 async function response(granted){
  const monitor=new EventEmitter();monitor.stdout=new PassThrough();monitor.stderr=new PassThrough();monitor.kill=()=>{};
  const result=request({spawnProcess:()=>monitor,call:(_cmd,_args,cb)=>{
   cb(null);monitor.stdout.write(`/org/freedesktop/portal/desktop/request/1_2/airdrop${process.pid}: org.freedesktop.portal.Request.Response (uint32 ${granted?0:1}, {'background': <${granted}>})\n`);
  },timeout:1000});
  monitor.stdout.write('Monitoring signals from all objects\n');return result;
 }
 assert.equal(await response(true),true);assert.equal(await response(false),false);
 const monitor=new EventEmitter();monitor.stdout=new PassThrough();monitor.stderr=new PassThrough();monitor.kill=()=>{};
 const result=request({spawnProcess:()=>monitor,timeout:100});monitor.emit('error',new Error('not available'));assert.equal(await result,false);
});
test('managed setup requires explicit migration and archives old code without changing identity',async t=>{
 const {directory,paths}=await fixture(t);await fs.mkdir(path.join(paths.root,'app/server'),{recursive:true});
 await fs.writeFile(path.join(paths.root,'app/server/old.js'),'old code');
 await fs.writeFile(path.join(paths.root,'state/runtime.json'),'{}');
 await manage.record(paths,[],'script');
 const identity=await fs.readFile(paths.env,'utf8');
 const manifest=path.join(directory,'distribution.json');await fs.writeFile(manifest,'{"source":"apt"}');
 const saved={AIRDROP_INSTALL_MANIFEST:process.env.AIRDROP_INSTALL_MANIFEST,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME};
 process.env.AIRDROP_INSTALL_MANIFEST=manifest;process.env.XDG_CONFIG_HOME=path.join(directory,'config');
 try{
  await assert.rejects(manage.setup({paths,execute:async()=>{}}),/setup --migrate/);
  await manage.setup({paths,migrate:true,execute:async()=>{}});
  assert.equal(await fs.readFile(paths.env,'utf8'),identity);
  const backups=await fs.readdir(paths.backups);
  assert.equal(await fs.readFile(path.join(paths.backups,backups[0],'app/server/old.js'),'utf8'),'old code');
  assert.equal((await manage.read(path.join(paths.root,'state/installation.json'))).source,'apt');
 }finally{for(const [name,value]of Object.entries(saved))if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
test('channel recipes pin both architectures to actual payload checksums',async t=>{
 const {directory}=await fixture(t);const version=require('../package.json').version;
 for(const channel of ['native','flatpak','snap'])for(const arch of ['x64','arm64'])await fs.writeFile(path.join(directory,`airdrop-${channel}-${arch}-${version}.tar.gz`),channel+arch);
 const out=await require('../scripts/prepare-channels').generate(directory);
 const srcinfo=await fs.readFile(path.join(out,'aur/.SRCINFO'),'utf8');assert.match(srcinfo,/sha256sums_aarch64 = [a-f0-9]{64}/);
 const flatpak=JSON.parse(await fs.readFile(path.join(out,'flatpak/io.github.fluffydisk.Airdrop.json'),'utf8'));
 assert.ok(!flatpak['finish-args'].some(arg=>arg.includes('--filesystem=home')));
 const sources=flatpak.modules.at(-1).sources.filter(s=>s.type==='archive');assert.equal(sources.length,2);assert.ok(sources.every(s=>/^[a-f0-9]{64}$/.test(s.sha256)));
 const snap=await fs.readFile(path.join(out,'snap/snapcraft-x64.yaml'),'utf8');assert.match(snap,/source-checksum: sha512\/[a-f0-9]{128}/);assert.match(snap,/daemon-scope: user/);
 const localOut=await require('../scripts/prepare-channels').generate(directory,{local:true});
 assert.notEqual(localOut,out);
 const localManifest=JSON.parse(await fs.readFile(path.join(localOut,'flatpak/io.github.fluffydisk.Airdrop.json'),'utf8'));
 for(const source of localManifest.modules.at(-1).sources.filter(s=>s.type==='archive'||s.type==='file')){assert.ok(path.isAbsolute(source.path));assert.equal(source.url,undefined);await fs.access(source.path);}
 assert.ok(sources.every(source=>source.url.startsWith('https://')));
});
test('managed packages can be removed before first setup without touching a data tree',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-uninitialised-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const paths=getPaths({root:path.join(directory,'not-created')});const calls=[];
 const result=await manage.uninstall({paths,source:'apt',execute:async(...args)=>calls.push(args)});
 assert.match(result,/No user data directory/);assert.equal(calls.length,1);assert.equal(calls[0][0],'sudo');
 await assert.rejects(fs.access(paths.root));
 await assert.rejects(manage.uninstall({paths,source:'flatpak',execute:async()=>{throw new Error('must not run host command');}}),/Run this command on the host/);
 await assert.rejects(manage.uninstall({paths,source:'snap'}),error=>error.message.includes('sudo snap remove airdrop-linux.') && !error.message.includes('--purge'));
 await assert.rejects(manage.uninstall({paths,source:'snap',deleteData:true}),error=>error.message.includes('sudo snap remove airdrop-linux --purge') && error.message.includes('snap forget <set-id> airdrop-linux'));
 await assert.rejects(manage.uninstall({paths,source:'flatpak',deleteData:true}),/flatpak uninstall io.github.fluffydisk.Airdrop --delete-data/);
});
