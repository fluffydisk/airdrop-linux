#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const { version } = require('./build-packages');
const pkg = require('../package.json');
const root=path.resolve(__dirname,'..');
const sha=file=>crypto.createHash('sha256').update(file).digest('hex');
async function writeLocalFlatpakFixture(directory,flatpak,checksums,architectures) {
  const base=`https://github.com/fluffydisk/airdrop-linux/releases/download/v${pkg.version}`;
  const sources=[
    ...architectures.map(arch=>({type:'archive',url:base+`/airdrop-flatpak-${arch}-${pkg.version}.tar.gz`,sha256:checksums[`airdrop-flatpak-${arch}-${pkg.version}.tar.gz`],'only-arches':[arch==='x64'?'x86_64':'aarch64']})),
    {type:'inline','dest-filename':'airdrop-desktop',contents:'#!/bin/sh\nexport GTK_USE_PORTAL=1\nexec /app/lib/airdrop-linux/runtime/node /app/lib/airdrop-linux/server/scripts/managed-runtime.js desktop "$@"\n'},
    {type:'inline','dest-filename':'background-portal.c',contents:await fs.readFile(path.join(root,'packaging/flatpak/background-portal.c'),'utf8')},
    ...await Promise.all(['io.github.fluffydisk.airdrop-linux.desktop','io.github.fluffydisk.airdrop-linux.metainfo.xml'].map(async name=>({type:'inline','dest-filename':name,contents:await fs.readFile(path.join(root,'packaging',name),'utf8')}))),
    {type:'file',url:`https://raw.githubusercontent.com/fluffydisk/airdrop-linux/v${pkg.version}/ui/icon-512.png`,sha256:sha(await fs.readFile(path.join(root,'ui/icon-512.png'))),'dest-filename':'icon.png'}
  ];
  for(const source of sources) {
    // flathub-build --sandbox only permits local files within the manifest's
    // directory. Keep this test bundle self-contained, including both arches.
    if(source.type==='archive'){
      const name=path.basename(source.url);
      await fs.copyFile(path.join(directory,name),path.join(flatpak,name));
      source.path=name;delete source.url;
    } else if(source.type==='file'){
      await fs.copyFile(path.join(root,'ui/icon-512.png'),path.join(flatpak,'icon.png'));
      source.path='icon.png';delete source.url;
    }
  }
  const manifest={
    'app-id':'io.github.fluffydisk.airdrop-linux',runtime:'org.freedesktop.Platform','runtime-version':'25.08',base:'org.electronjs.Electron2.BaseApp','base-version':'25.08',sdk:'org.freedesktop.Sdk',command:'airdrop-desktop',
    'finish-args':['--share=ipc','--share=network','--socket=wayland','--socket=fallback-x11','--device=dri','--talk-name=org.kde.StatusNotifierWatcher','--env=GTK_USE_PORTAL=1'],
    modules:[{name:'airdrop-linux',buildsystem:'simple','build-commands':[
        'mkdir -p /app/lib/airdrop-linux',
        'cp -a server ui desktop runtime distribution.json LICENSE /app/lib/airdrop-linux/',
        'install -Dm755 airdrop-desktop /app/bin/airdrop-desktop',
        'cc -Wall -Wextra -Werror background-portal.c -o /app/bin/airdrop-background-portal $(pkg-config --cflags --libs gio-2.0)',
        'install -Dm644 io.github.fluffydisk.airdrop-linux.desktop /app/share/applications/io.github.fluffydisk.airdrop-linux.desktop',
        'install -Dm644 io.github.fluffydisk.airdrop-linux.metainfo.xml /app/share/metainfo/io.github.fluffydisk.airdrop-linux.metainfo.xml',
        'install -Dm644 icon.png /app/share/icons/hicolor/512x512/apps/io.github.fluffydisk.airdrop-linux.png'
      ],sources}]
  };
  await fs.writeFile(path.join(flatpak,'io.github.fluffydisk.airdrop-linux.json'),JSON.stringify(manifest,null,2)+'\n');
}
async function prepareLocalFlatpak(directory,arch) {
  if(!['x64','arm64'].includes(arch))throw new Error('Unsupported local fixture architecture');
  directory=path.resolve(directory);
  const flatpak=path.join(directory,'local-submissions/flatpak');await fs.mkdir(flatpak,{recursive:true});
  const name=`airdrop-flatpak-${arch}-${pkg.version}.tar.gz`;
  const checksums={[name]:sha(await fs.readFile(path.join(directory,name)))};
  await fs.writeFile(path.join(flatpak,'README.md'),'AI-assisted runtime fixture only. Do not submit to Flathub.\n');
  await writeLocalFlatpakFixture(directory,flatpak,checksums,[arch]);
  return path.join(flatpak,'io.github.fluffydisk.airdrop-linux.json');
}
async function generate(directory=path.join(root,'release'), { local = false } = {}) {
  directory = path.resolve(directory);
  version(pkg.version);
  const base=`https://github.com/fluffydisk/airdrop-linux/releases/download/v${pkg.version}`;
  const checksums={};
  for(const source of ['native','flatpak','snap'])for(const arch of ['x64','arm64']){
    const name=`airdrop-${source}-${arch}-${pkg.version}.tar.gz`;
    checksums[name]=sha(await fs.readFile(path.join(directory,name)));
  }
  const out=path.join(directory,local?'local-submissions':'submissions');await fs.mkdir(out,{recursive:true});
  const aur=path.join(out,'aur');await fs.mkdir(aur,{recursive:true});
  const native=arch=>`airdrop-native-${arch}-${pkg.version}.tar.gz`;
  const nativeURL=arch=>local?pathToFileURL(path.join(directory,native(arch))).href:base+'/'+native(arch);
  const build=`# Generated from immutable v${pkg.version} release payloads.\npkgname=airdrop-linux-bin\npkgver=${pkg.version}\npkgrel=1\npkgdesc='Private file and clipboard sharing over Tailscale'\narch=('x86_64' 'aarch64')\nurl='https://github.com/fluffydisk/airdrop-linux'\nlicense=('MIT')\noptions=('!strip' '!debug')\nprovides=('airdrop-linux')\nconflicts=('airdrop-linux')\ndepends=('glibc>=2.39' 'gcc-libs' 'gtk3' 'nss' 'alsa-lib' 'at-spi2-core' 'libcups' 'libdrm' 'mesa' 'libx11' 'libxcb' 'libxcomposite' 'libxdamage' 'libxext' 'libxfixes' 'libxrandr' 'libxkbcommon' 'dbus' 'systemd')\noptdepends=('tailscale: private networking' 'xdg-desktop-portal: desktop integration')\nsource_x86_64=('${nativeURL('x64')}')\nsource_aarch64=('${nativeURL('arm64')}')\nsha256sums_x86_64=('${checksums[native('x64')]}')\nsha256sums_aarch64=('${checksums[native('arm64')]}')\npackage() {\n  cp -a usr \"$pkgdir/\"\n  install -Dm644 usr/share/licenses/airdrop-linux/LICENSE \"$pkgdir/usr/share/licenses/$pkgname/LICENSE\"\n}\n`;
  await fs.writeFile(path.join(aur,'PKGBUILD'),build);
  const fields = build.split('\n').flatMap(line=>{
    const m=/^([a-z0-9_]+)=(.*)$/.exec(line);if(!m || !['pkgver','pkgrel','pkgdesc','arch','url','license','options','provides','conflicts','depends','optdepends','source_x86_64','source_aarch64','sha256sums_x86_64','sha256sums_aarch64'].includes(m[1]))return [];
    const values=m[2].startsWith('(') ? [...m[2].matchAll(/'([^']*)'/g)].map(v=>v[1]) : [m[2].replace(/^'|'$/g,'')];
    return values.map(v=>'\t'+m[1]+' = '+v);
  });
  await fs.writeFile(path.join(aur,'.SRCINFO'),'pkgbase = airdrop-linux-bin\n'+fields.join('\n')+'\n\npkgname = airdrop-linux-bin\n');
  // Keep .SRCINFO generated by makepkg, not a second handwritten dependency list.
  await fs.writeFile(path.join(aur,'README.md'),'Run `makepkg --printsrcinfo > .SRCINFO`, then `makepkg --cleanbuild --syncdeps` in a clean Arch build environment. Submit PKGBUILD and .SRCINFO to the separately owned AUR repository only after both architecture checksums verify.\n');
  const flatpak=path.join(out,'flatpak');await fs.mkdir(flatpak,{recursive:true});
  // AI-assisted fixtures are for runtime CI only, never a Flathub submission.
  // Remove previously generated production recipes when reusing an output tree.
  for(const id of ['io.github.fluffydisk.Airdrop','io.github.fluffydisk.airdrop-linux'])
    await fs.rm(path.join(flatpak,id+'.json'),{force:true});
  await fs.writeFile(path.join(flatpak,'README.md'),'No Flathub submission manifest is generated. A human must independently author it under Flathub policy. --local only produces an AI-assisted runtime test fixture, which must not be submitted.\n');
  if(local)await writeLocalFlatpakFixture(directory,flatpak,checksums,['x64','arm64']);
  const snap=path.join(out,'snap');await fs.mkdir(snap,{recursive:true});
  // Separate native architecture recipes prevent accidental cross-architecture payload reuse.
  for(const arch of ['x64','arm64']){
    const name=`airdrop-snap-${arch}-${pkg.version}.tar.gz`;
    const recipe=(await fs.readFile(path.join(root,'packaging/snap/snapcraft.yaml.in'),'utf8'))
      .replaceAll('@VERSION@',pkg.version).replaceAll('@ARCH@',arch==='x64'?'amd64':'arm64').replaceAll('@TRIPLET@',arch==='x64'?'x86_64-linux-gnu':'aarch64-linux-gnu').replaceAll('@URL@',local?path.join(directory,name):base+'/'+name).replaceAll('@SHA512@',crypto.createHash('sha512').update(await fs.readFile(path.join(directory,name))).digest('hex'));
    await fs.writeFile(path.join(snap,`snapcraft-${arch}.yaml`),recipe);
  }
  await fs.writeFile(path.join(directory,'channel-checksums.json'),JSON.stringify({version:pkg.version,files:checksums},null,2)+'\n');
  return out;
}
if(require.main===module)generate(process.argv.slice(2).find(arg=>arg!=='--local'),{local:process.argv.includes('--local')}).then(console.log).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={generate,prepareLocalFlatpak};
