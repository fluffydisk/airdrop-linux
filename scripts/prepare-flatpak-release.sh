#!/usr/bin/env bash
# Online preparation only. Compilation and npm installs run offline in the SDK.
set -euo pipefail
tag=${1:?Usage: prepare-flatpak-release.sh vVERSION}
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
: "${FLATPAK_BUILDER_TOOLS:?Set the path to the pinned flatpak-builder-tools checkout}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gh release view "$tag" --json isDraft,isPrerelease,publishedAt > "$work/release.json"
jq -e '.isDraft == false and .isPrerelease == false' "$work/release.json"
gh api "repos/$GH_REPO/commits/$tag" --jq .sha > "$work/commit"
python3 - "$tag" "$work" <<'PY'
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,tarfile,urllib.request
import yaml
tag,work=sys.argv[1],pathlib.Path(sys.argv[2])
commit=(work/'commit').read_text().strip()
assert re.fullmatch(r'[a-f0-9]{40}',commit)
manifest_path=pathlib.Path('packaging/io.github.fluffydisk.airdrop-linux.yml')
manifest=yaml.safe_load(manifest_path.read_text())
def fetch(url,name):
    target=work/name
    subprocess.run(['curl','--proto','=https','-fsSL','--retry','3',url,'-o',str(target)],check=True)
    return target
def unpack(archive,name):
    dest=work/name
    dest.mkdir()
    with tarfile.open(archive) as tar: tar.extractall(dest,filter='data')
    return next(dest.iterdir())
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def checksums(url,name):
    return {line.split()[1].lstrip('*'):line.split()[0] for line in fetch(url,name).read_text().splitlines() if line.strip()}
url=f'https://codeload.github.com/{os.environ["GH_REPO"]}/tar.gz/{commit}'
archive=fetch(url,'application.tar.gz')
source=unpack(archive,'application')
assert 'v'+json.loads((source/'package.json').read_text())['version']==tag
pins=json.loads((source/'packaging/runtime-sources.json').read_text())
node,dufs,app=manifest['modules']
dufs_version=pins['dufsVersion']
dufs_commit=subprocess.check_output(['gh','api',f'repos/sigoden/dufs/commits/v{dufs_version}','--jq','.sha'],text=True).strip()
assert re.fullmatch(r'[a-f0-9]{40}',dufs_commit)
dufs_url=f'https://codeload.github.com/sigoden/dufs/tar.gz/{dufs_commit}'
dufs_archive=fetch(dufs_url,'dufs.tar.gz')
dufs_source=unpack(dufs_archive,'dufs')
dufs['sources'][0].update(url=dufs_url,sha256=digest(dufs_archive))
app['sources'][0].update(url=url,sha256=digest(archive))
main=(source/'desktop/main.js').read_text()
if "app.setDesktopName('io.github.fluffydisk.airdrop-linux.desktop')" in main:
    app['sources']=[s for s in app['sources'] if not isinstance(s,dict) or s.get('path')!='flatpak/application-id.patch']
else:
    assert tag=='v1.5.0', 'A new release must include the upstream desktop identity fix'
electron=json.loads((source/'desktop/package-lock.json').read_text())['packages']['node_modules/electron']['version']
electron_base=f'https://github.com/electron/electron/releases/download/v{electron}'
electron_sums=checksums(electron_base+'/SHASUMS256.txt','electron-sums')
for s in app['sources']:
    if isinstance(s,dict) and s.get('dest')=='electron-runtime':
        arch={'x86_64':'x64','aarch64':'arm64'}[s['only-arches'][0]]
        name=f'electron-v{electron}-linux-{arch}.zip'
        s.update(url=electron_base+'/'+name,sha256=electron_sums[name])
shutil.copytree('packaging/flatpak/build-tools',source/'build-tools')
subprocess.run(['flatpak-node-generator','--no-devel','-r','--max-parallel','12','-o','packaging/flatpak/generated-npm-sources.json','npm',str(source/'package-lock.json')],check=True)
subprocess.run([sys.executable,os.environ['FLATPAK_BUILDER_TOOLS']+'/cargo/flatpak-cargo-generator.py',str(dufs_source/'Cargo.lock'),'-o','packaging/flatpak/generated-cargo-sources.json'],check=True)
class IndentedDumper(yaml.SafeDumper):
    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)
manifest_text=yaml.dump(manifest,Dumper=IndentedDumper,sort_keys=False,width=110)
manifest_path.write_text('# AI-assisted upstream packaging; not a Flathub submission.\n'+manifest_text.replace('  - name:', '\n  - name:'))
import xml.etree.ElementTree as ET
metadata=pathlib.Path('packaging/io.github.fluffydisk.airdrop-linux.metainfo.xml')
tree=ET.parse(metadata)
releases=tree.getroot().find('releases')
if not any(r.get('version')==tag[1:] for r in releases):
    date=json.loads((work/'release.json').read_text())['publishedAt'][:10]
    releases.insert(0,ET.Element('release',{'version':tag[1:],'date':date}))
    tree.write(metadata,encoding='utf-8',xml_declaration=True)
pathlib.Path('packaging/flatpak/source-provenance.json').write_text(json.dumps({'tag':tag,'applicationCommit':commit,'applicationArchiveSha256':digest(archive),'node':'signed org.freedesktop.Sdk.Extension.node24//26.08','dufs':dufs_version,'dufsCommit':dufs_commit,'electron':electron,'electronOrigin':'official prebuilt archive; not compiled Chromium','packagingOrigin':'AI-assisted'},indent=2)+'\n')
subprocess.run([sys.executable,'scripts/check-flatpak-inputs.py','--application-source',str(source)],check=True)
PY
