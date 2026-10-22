#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync: run } = require('node:child_process');
const { desktopProfile } = require('./desktop-apparmor');
const root = path.resolve(__dirname,'..');
const pkg = require('../package.json');
const pins = require('../packaging/runtime-sources.json');
const hash = file => crypto.createHash('sha256').update(file).digest('hex');
function version(value) { if(!/^\d+\.\d+\.\d+$/.test(value))throw new Error('Only stable semantic versions can be packaged');return value; }
async function download(url, sha, target) {
  await fs.mkdir(path.dirname(target),{recursive:true});
  try { if(hash(await fs.readFile(target)) === sha)return; } catch(e){if(e.code!=='ENOENT')throw e;}
  run('curl',['-fL','--retry','3','--proto','=https',url,'-o',target],{stdio:'inherit'});
  if(hash(await fs.readFile(target))!==sha){await fs.rm(target);throw new Error('Runtime checksum mismatch');}
}
async function stage(target, {source='apt', arch=process.arch, desktop=path.join(root,`desktop/out/Airdrop-linux-${arch}`)}={}) {
  if(!pins[arch])throw new Error('Supported architectures: x64, arm64');
  if(!['apt','aur','rpm','flatpak','snap'].includes(source))throw new Error('Invalid distribution');
  version(pkg.version);
  if(JSON.parse(await fs.readFile(path.join(desktop,'resources/app/package.json'),'utf8')).version !== pkg.version)throw new Error('Rebuild the matching desktop first');
  await fs.mkdir(target,{recursive:true});
  const server=path.join(target,'server');await fs.mkdir(server);
  for(const item of ['push-server.js','package.json','package-lock.json','lib','bin']) await fs.cp(path.join(root,item),path.join(server,item),{recursive:true});
  await fs.mkdir(path.join(server,'scripts'));
  for(const name of ['migrate-layout.js','managed-runtime.js','register-install.js']) await fs.copyFile(path.join(root,'scripts',name),path.join(server,'scripts',name));
  await fs.mkdir(path.join(server,'ui'));await fs.copyFile(path.join(root,'ui/zip.js'),path.join(server,'ui/zip.js'));
  run('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:server,stdio:'inherit'});
  await fs.cp(path.join(root,'ui'),path.join(target,'ui'),{recursive:true});
  await fs.cp(desktop,path.join(target,'desktop'),{recursive:true});
  await fs.copyFile(path.join(root,'LICENSE'),path.join(target,'LICENSE'));
  await fs.writeFile(path.join(target,'distribution.json'),JSON.stringify({source,version:pkg.version,arch}));
  const cache=path.join(root,'.cache/package-runtime');
  const node=path.join(cache,`node-${arch}.tar.xz`),dufs=path.join(cache,`dufs-${arch}.tar.gz`);
  await download(`https://nodejs.org/dist/v${pins.nodeVersion}/node-v${pins.nodeVersion}-linux-${arch}.tar.xz`,pins[arch].node,node);
  await download(`https://github.com/sigoden/dufs/releases/download/v${pins.dufsVersion}/dufs-v${pins.dufsVersion}-${arch==='x64'?'x86_64':'aarch64'}-unknown-linux-musl.tar.gz`,pins[arch].dufs,dufs);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-runtime-'));
  try {
    run('tar',['-xJf',node,'-C',temp]);await fs.mkdir(path.join(target,'runtime'));
    await fs.copyFile(path.join(temp,`node-v${pins.nodeVersion}-linux-${arch}/bin/node`),path.join(target,'runtime/node'));await fs.chmod(path.join(target,'runtime/node'),0o755);
    await fs.copyFile(path.join(temp,`node-v${pins.nodeVersion}-linux-${arch}/LICENSE`),path.join(target,'runtime/NODE-LICENSE'));
    run('tar',['-xzf',dufs,'-C',temp]);await fs.copyFile(path.join(temp,'dufs'),path.join(target,'runtime/dufs'));await fs.chmod(path.join(target,'runtime/dufs'),0o755);
  } finally {await fs.rm(temp,{recursive:true,force:true});}
  const license=path.join(cache,'DUFS-LICENSE');
  await download(pins.dufsLicense.url,pins.dufsLicense.sha256,license);
  await fs.copyFile(license,path.join(target,'runtime/DUFS-LICENSE'));
  await normalizePayload(target,arch);
  await deduplicatePayload(target);
}
async function normalizePayload(directory, arch) {
  // Electron packager creates private directories. Snapcraft stages as root,
  // while the installed app runs as the user, so payloads must be traversable.
  await fs.chmod(directory,0o755);
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isSymbolicLink()) { await fs.rm(file); continue; } // dependency CLI links are unused
    if(entry.isDirectory()) {
      if(entry.name==='prebuilds') {
        for(const platform of await fs.readdir(file)) if(platform!==`linux-${arch}`)await fs.rm(path.join(file,platform),{recursive:true,force:true});
      }
      await normalizePayload(file,arch); continue;
    }
    if(!entry.isFile())throw new Error('Unexpected package file type');
    if(/^\.(npmignore|eslintrc.*|jshintrc)$/.test(entry.name) || /^eslint\.config\./.test(entry.name)) {await fs.rm(file);continue;}
    const header=Buffer.alloc(4);const handle=await fs.open(file);await handle.read(header,0,4,0);await handle.close();
    if(header.equals(Buffer.from([127,69,76,70]))) {
      run(arch===process.arch?'strip':(arch==='arm64'?'aarch64-linux-gnu-strip':'x86_64-linux-gnu-strip'),['--strip-unneeded',file]);
      if(/\.(so(\.\d+)*|bare)$/.test(entry.name))await fs.chmod(file,0o644);
    }else if(/\.(js|cjs|mjs|mts)$/.test(entry.name) || header.toString().startsWith('#!')){
      const data=await fs.readFile(file,'utf8');
      if(data.startsWith('#!') && /^#![^\n]*\bnode\b/.test(data))await fs.writeFile(file,data.replace(/^#![^\n]*\n/,''));
      if(/\.(js|cjs|mjs|mts)$/.test(entry.name) || /^#![^\n]*\bnode\b/.test(data))await fs.chmod(file,0o644);
    }
    await fs.chmod(file,((await fs.stat(file)).mode&0o111)?0o755:0o644);
  }
}
async function deduplicatePayload(directory) {
  const groups=new Map();
  async function collect(folder) {
    for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
      const file=path.join(folder,entry.name);
      if(entry.isDirectory()){await collect(file);continue;}
      if(!entry.isFile())throw new Error('Unexpected package file type');
      const stat=await fs.stat(file),key=`${stat.size}:${stat.mode&0o777}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(file);
    }
  }
  await collect(directory);
  for(const files of groups.values()) {
    if(files.length<2)continue;
    const contents=new Map();
    for(const file of files) {
      const digest=hash(await fs.readFile(file)),original=contents.get(digest);
      if(!original){contents.set(digest,file);continue;}
      // These are immutable code files. Preserve both module paths and modes
      // while allowing RPM and tar to store identical dependency content once.
      const temporary=file+'.dedupe-'+crypto.randomUUID();
      try {await fs.link(original,temporary);await fs.rename(temporary,file);}
      finally {await fs.rm(temporary,{force:true});}
    }
  }
}
async function layout(target,source,arch=process.arch) {
  const base=path.join(target,'usr/lib/airdrop-linux');await stage(base,{source,arch});
  await fs.mkdir(path.join(target,'usr/bin'),{recursive:true});
  for(const [name,action] of [['airdrop','cli'],['airdrop-desktop','desktop']]){
    const file=path.join(target,'usr/bin',name);
    await fs.writeFile(file,`#!/bin/sh\nexec /usr/lib/airdrop-linux/runtime/node /usr/lib/airdrop-linux/server/scripts/managed-runtime.js ${action} "$@"\n`,{mode:0o755});
  }
  for(const [from,to] of [
    ['packaging/native/airdrop-linux.target','usr/lib/systemd/user/airdrop-linux.target'],
    ['packaging/native/airdrop-linux-backend.service','usr/lib/systemd/user/airdrop-linux-backend.service'],
    ['packaging/io.github.fluffydisk.airdrop-linux.desktop','usr/share/applications/io.github.fluffydisk.airdrop-linux.desktop'],
    ['packaging/io.github.fluffydisk.airdrop-linux.metainfo.xml','usr/share/metainfo/io.github.fluffydisk.airdrop-linux.metainfo.xml'],
    ['ui/icon-192.png','usr/share/icons/hicolor/192x192/apps/io.github.fluffydisk.airdrop-linux.png'],
    ['LICENSE','usr/share/licenses/airdrop-linux/LICENSE']]){
    await fs.mkdir(path.dirname(path.join(target,to)),{recursive:true});await fs.copyFile(path.join(root,from),path.join(target,to));
  }
  await fs.mkdir(path.join(target,'etc/apparmor.d'),{recursive:true});
  await fs.writeFile(path.join(target,'etc/apparmor.d/airdrop-linux'),desktopProfile('/usr/lib/airdrop-linux/desktop/Airdrop'));
  await fs.mkdir(path.join(target,'usr/share/doc/airdrop-linux'),{recursive:true});
  const copyright=await fs.readFile(path.join(root,'LICENSE'),'utf8');
  await fs.writeFile(path.join(target,'usr/share/doc/airdrop-linux/copyright'),copyright+'\nBundled Electron/Chromium licenses: /usr/lib/airdrop-linux/desktop/LICENSES.chromium.html\nBundled Node licenses: /usr/lib/airdrop-linux/runtime/NODE-LICENSE\nBundled npm packages retain their LICENSE/COPYING files alongside their package.json.\n');
  await fs.writeFile(path.join(target,'usr/share/doc/airdrop-linux/changelog.Debian'),`airdrop-linux (${pkg.version}-1) stable; urgency=medium\n\n  * Package-managed distribution with user services and safe removal.\n\n -- Airdrop Linux maintainers <fluffydisk@users.noreply.github.com>  Wed, 21 Oct 2026 12:00:00 +0000\n`);
  run('gzip',['-n','-9',path.join(target,'usr/share/doc/airdrop-linux/changelog.Debian')]);
  if(source==='apt') {
    await fs.mkdir(path.join(target,'usr/share/lintian/overrides'),{recursive:true});
    await fs.copyFile(path.join(root,'packaging/native/lintian-overrides'),path.join(target,'usr/share/lintian/overrides/airdrop-linux'));
  }
  // Normalize immutable package payload permissions independently of the builder's umask.
  run('chmod',['-R','a+rX',target]);
}
async function main() {
  const source=process.argv[2] || 'apt';
  const targetArch=process.env.AIRDROP_PACKAGE_ARCH || process.arch;
  if(!pins[targetArch])throw new Error('Supported architectures: x64, arm64');
  const out=path.join(root,'release');await fs.mkdir(out,{recursive:true});
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'airdrop-package-'));
  try {
    const target=path.join(temp,'root');
    if(['flatpak','snap'].includes(source)){
      await stage(path.join(target,'app'),{source,arch:targetArch});
      run('tar',['-czf',path.join(out,`airdrop-${source}-${targetArch}-${pkg.version}.tar.gz`),'-C',target,'app']);return;
    }
    await layout(target,source,targetArch);
    const arch=targetArch==='x64'?'amd64':'arm64';
    if(source==='apt'){
      await fs.mkdir(path.join(target,'DEBIAN'));
      const installedSize=run('du',['-sk',target],{encoding:'utf8'}).split(/\s/)[0];
      await fs.writeFile(path.join(target,'DEBIAN/control'),`Package: airdrop-linux\nVersion: ${pkg.version}-1\nArchitecture: ${arch}\nMaintainer: Airdrop Linux maintainers <fluffydisk@users.noreply.github.com>\nSection: net\nPriority: optional\nInstalled-Size: ${installedSize}\nDepends: libc6 (>= 2.39), libatomic1, libstdc++6, libgcc-s1, libatspi2.0-0 | libatspi2.0-0t64, libgtk-3-0 | libgtk-3-0t64, libnss3, libnspr4, libasound2 | libasound2t64, libatk1.0-0 | libatk1.0-0t64, libatk-bridge2.0-0 | libatk-bridge2.0-0t64, libcups2 | libcups2t64, libdrm2, libgbm1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxrandr2, libxkbcommon0, dbus, systemd\nRecommends: xdg-desktop-portal, xdg-utils, apparmor\nHomepage: https://github.com/fluffydisk/airdrop-linux\nDescription: Private file and clipboard sharing over Tailscale\n Electron desktop, local Node gateway, CLI and file server.\n Tailscale is configured separately on the host.\n`);
      await fs.writeFile(path.join(target,'DEBIAN/conffiles'),'/etc/apparmor.d/airdrop-linux\n');
      for(const hook of ['postinst','prerm','postrm'])await fs.copyFile(path.join(root,'packaging/native',hook),path.join(target,'DEBIAN',hook));
      run('chmod',['0755',path.join(target,'DEBIAN/postinst'),path.join(target,'DEBIAN/prerm'),path.join(target,'DEBIAN/postrm')]);
      run('dpkg-deb',['--root-owner-group','--build',target,path.join(out,`airdrop-linux_${pkg.version}-1_${arch}.deb`)],{stdio:'inherit'});
    }else if(source==='rpm'){
      const top=path.join(temp,'rpm');for(const dir of ['BUILD','BUILDROOT','RPMS','SOURCES','SPECS','SRPMS'])await fs.mkdir(path.join(top,dir),{recursive:true});
      run('tar',['-czf',path.join(top,'SOURCES/payload.tar.gz'),'-C',target,'.']);
      const spec=(await fs.readFile(path.join(root,'packaging/native/airdrop-linux.spec'),'utf8')).replaceAll('@VERSION@',pkg.version);
      await fs.writeFile(path.join(top,'SPECS/airdrop-linux.spec'),spec);
      run('rpmbuild',['-bb','--target',targetArch==='x64'?'x86_64':'aarch64','--define',`_topdir ${top}`,'--define','_build_id_links none',path.join(top,'SPECS/airdrop-linux.spec')],{stdio:'inherit'});
      for(const dir of await fs.readdir(path.join(top,'RPMS')))for(const file of await fs.readdir(path.join(top,'RPMS',dir)))await fs.copyFile(path.join(top,'RPMS',dir,file),path.join(out,file));
    }else if(source==='aur'){
      run('tar',['-czf',path.join(out,`airdrop-native-${targetArch}-${pkg.version}.tar.gz`),'-C',target,'.']);
    }else throw new Error('Unknown package format');
  }finally{await fs.rm(temp,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={stage,layout,version,normalizePayload,deduplicatePayload};
