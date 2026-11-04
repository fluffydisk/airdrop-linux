#!/usr/bin/env python3
"""Prepare a pinned, offline-buildable r2 recipe from a published app commit.

Online preparation verifies npm archive integrities; assembly
remains isolated in flatpak-builder. No guessed source hashes.
"""
import argparse
import base64
import difflib
import hashlib
import json
from pathlib import Path
import re
import tarfile
import urllib.request
import yaml
from flatpak_reference_inputs import stage_manifest

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--commit',required=True)
parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args()
if not re.fullmatch('[0-9a-f]{40}',args.commit):parser.error('Pass an immutable published source commit')
out=args.output.resolve()
manifest,receipt=stage_manifest(ROOT/'packaging/flathub-draft/io.github.fluffydisk.airdrop-linux.yml',out)
url='https://codeload.github.com/fluffydisk/airdrop-linux/tar.gz/'+args.commit
with urllib.request.urlopen(url,timeout=60) as response:archive=response.read()
app_source={'type':'archive','url':url,'sha256':hashlib.sha256(archive).hexdigest(),'archive-type':'tar-gzip'}
source=out/'application-source';source.mkdir()
archive_path=out/'application.tar.gz';archive_path.write_bytes(archive)
with tarfile.open(archive_path) as package:package.extractall(source,filter='data')
app=next(source.iterdir())
# Build the closure from the downloaded commit, never from a different worktree.
cache=json.loads((out/'generated-npm-sources.json').read_text());hashes={s[k] for s in cache for k in ['sha512','sha256'] if k in s}
extra=[]
for lock in [app/'package-lock.json',app/'desktop/package-lock.json',app/'packaging/flatpak/build-tools/package-lock.json']:
 for name,pkg in json.loads(lock.read_text())['packages'].items():
  if not name or pkg.get('dev'):continue
  algorithm,encoded=pkg['integrity'].split('-',1);digest=base64.b64decode(encoded).hex()
  if digest in hashes:continue
  if algorithm!='sha512':raise ValueError('Unexpected npm integrity algorithm')
  with urllib.request.urlopen(pkg['resolved'],timeout=45) as response:data=response.read()
  if hashlib.sha512(data).hexdigest()!=digest:raise ValueError('npm integrity mismatch: '+name)
  extra.append({'type':'file','url':pkg['resolved'],'sha512':digest,'dest':'flatpak-node/npm-cache/_cacache/content-v2/sha512/'+digest[:2]+'/'+digest[2:4],'dest-filename':digest[4:]});hashes.add(digest)
(out/'generated-npm-sources.json').write_text(json.dumps(cache+extra,indent=4)+'\n')
module=next(m for m in manifest['modules'] if m['name']=='airdrop-linux')
metadata_patch=''
for source_entry in module['sources']:
 if isinstance(source_entry,dict) and source_entry.get('url','').endswith('/packaging/flatpak/install-flatpak.sh'):
  # Assembly helpers must match the pinned application, including portal helpers.
  source_entry['url']='https://raw.githubusercontent.com/fluffydisk/airdrop-linux/'+args.commit+'/packaging/flatpak/install-flatpak.sh'
  source_entry['sha256']=hashlib.sha256((app/'packaging/flatpak/install-flatpak.sh').read_bytes()).hexdigest()
 if isinstance(source_entry,dict) and source_entry.get('url','').endswith(('.metainfo.xml','.desktop')):
  name=source_entry['url'].rsplit('/',1)[1]
  with urllib.request.urlopen(source_entry['url'],timeout=30) as response:original=response.read()
  if hashlib.sha256(original).hexdigest()!=source_entry['sha256']:raise ValueError('Metadata source integrity mismatch')
  metadata_patch+=''.join(difflib.unified_diff(original.decode().splitlines(True),(app/'packaging'/name).read_text().splitlines(True),fromfile='a/'+name,tofile='b/'+name))
(out/'metadata.patch').write_text(metadata_patch)
module['sources'][0]=app_source
module['sources']=[s for s in module['sources'] if not isinstance(s,dict) or s.get('path') not in ['application-id.patch','connection.patch','dependency-security.patch']]
manifest['modules']=[m for m in manifest['modules'] if not isinstance(m,dict) or m.get('name') != 'embedded-tsnet']
(out/'io.github.fluffydisk.airdrop-linux.yml').write_text('# Internal GitHub distribution recipe; Airdrop relay + paired LAN.\n'+yaml.safe_dump(manifest,sort_keys=False,width=110))
(out/'README.md').write_text('''# Internal GitHub Flatpak device-sharing reference

This standalone x86_64 recipe builds the application offline from pinned sources.
Internet sharing uses the built-in JavaScript relay client; no Go helper is needed. Electron is an official prebuilt binary.
This is not a Flathub submission or a claim of Flathub approval.

Run upstream scripts/validate-flatpak-reference.py with --manifest pointing
to io.github.fluffydisk.airdrop-linux.yml in this directory. All local inputs,
must remain alongside the manifest.
See preparation.json for the source commit and archive hashes.
''')
(out/'preparation.json').write_text(json.dumps({'application_commit':args.commit,'application_archive_sha256':app_source['sha256'],'extra_verified_npm_archives':len(extra),'connection':'airdrop-relay'},indent=2)+'\n')
print(out/'io.github.fluffydisk.airdrop-linux.yml')
