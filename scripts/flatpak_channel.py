#!/usr/bin/env python3
"""Sign a verified application repository inside the protected Pages publisher.

The native Pages tree must already exist. Never edits release assets or key
protection. Test callers can select a disposable key/local HTTP origin explicitly.
"""
import argparse,base64,configparser,hashlib,json,os,re,shutil,subprocess,tempfile
from pathlib import Path
import urllib.request,urllib.error
APP='io.github.fluffydisk.airdrop-linux';REF=f'app/{APP}/x86_64/stable'
PRODUCTION='https://fluffydisk.github.io/airdrop-linux/'
FINGERPRINT='6513D70958397F60D3787A0CB93F4FC1E97CF3AE'
R2='f7627ea19cc9cc901a96683a02a5efef8cf5cb3497ca423c80d76cfc6ab5fd75'
def run(*args,capture=False):
 return subprocess.check_output(list(map(str,args)),text=True).strip() if capture else subprocess.run(list(map(str,args)),check=True)
def version(value):
 if not re.fullmatch(r'\d+\.\d+\.\d+',value):raise ValueError('Invalid stable version')
 return tuple(map(int,value.split('.')))
def fetch(url,dest,optional=False):
 try:
  with urllib.request.urlopen(url,timeout=120) as response:dest.write_bytes(response.read())
 except urllib.error.HTTPError as error:
  if optional and error.code==404:return False
  raise
 return True
def verify_public_key(key,fingerprint):
 records=run('gpg','--batch','--with-colons','--show-keys',key,capture=True).splitlines()
 primary=[records[i+1].split(':')[9] for i,row in enumerate(records) if row.startswith('pub:')]
 if primary!=[fingerprint]:raise ValueError('Unexpected signing key identity')
def signed_json(url,key,temp,optional=False):
 file=temp/'previous-channel.json'
 if not fetch(url+'flatpak-channel.json',file,optional):return None
 signature=temp/'previous-channel.json.asc';fetch(url+'flatpak-channel.json.asc',signature)
 run('gpgv','--keyring',key,signature,file)
 return json.loads(file.read_text())
def descriptors(public,base,key):
 encoded=base64.b64encode(key.read_bytes()).decode()
 (public/'airdrop-linux.flatpakrepo').write_text(f'''[Flatpak Repo]
Title=Airdrop Linux
Url={base}flatpak/
Homepage=https://github.com/fluffydisk/airdrop-linux
Description=Signed upstream stable Flatpak updates (x86_64)
GPGKey={encoded}
''')
 (public/'airdrop-linux.flatpakref').write_text(f'''[Flatpak Ref]
Title=Airdrop Linux
Name={APP}
Branch=stable
Url={base}flatpak/
IsRuntime=false
GPGKey={encoded}
RuntimeRepo=https://dl.flathub.org/repo/flathub.flatpakrepo
SuggestRemoteName=airdrop-linux
''')
def promote(candidate,public,fingerprint,base=PRODUCTION,previous=PRODUCTION,r2=None):
 assert public.is_dir() and not (public/'flatpak').exists(),'Use a complete native Pages tree and a new Flatpak subdirectory'
 assert re.fullmatch('[A-F0-9]{40,64}',fingerprint)
 receipt=json.loads((candidate/'candidate.json').read_text())
 assert receipt['app_id']==APP and receipt['arch']=='x86_64' and receipt['branch']=='stable'
 assert re.fullmatch('[0-9a-f]{40}',receipt['source_commit']) and int(receipt['revision'])>=3
 version(receipt['version']);source=candidate/'repo'
 native_before={str(p.relative_to(public)):hashlib.sha256(p.read_bytes()).hexdigest() for tree in ['apt','rpm'] for p in (public/tree).rglob('*') if p.is_file()}
 assert run('ostree',f'--repo={source}','rev-parse',REF,capture=True)==receipt['commit']
 run('ostree',f'--repo={source}','fsck')
 marker=json.loads(run('ostree',f'--repo={source}','cat',receipt['commit'],'/files/share/airdrop-linux/distribution.json',capture=True))
 assert all(marker[k]==receipt[k] for k in ['source_commit','version','revision'])
 repo=public/'flatpak';run('ostree',f'--repo={repo}','init','--mode=archive-z2')
 with tempfile.TemporaryDirectory(prefix='airdrop-public-key-') as temporary:
  temp=Path(temporary);key=temp/'key.gpg'
  with key.open('wb') as output:subprocess.run(['gpg','--batch','--export',fingerprint],stdout=output,check=True)
  verify_public_key(key,fingerprint)
  prior=None
  if previous:
   previous_key=temp/'previous.gpg';fetch(previous+'airdrop-linux.gpg',previous_key)
   verify_public_key(previous_key,FINGERPRINT if previous==PRODUCTION else fingerprint)
   prior=signed_json(previous,previous_key,temp,optional=True)
   if prior and (version(receipt['version']),receipt['revision']) <= (version(prior['version']),prior['revision']):
    raise ValueError('Refusing repeated or older repository version/revision')
   run('ostree',f'--repo={repo}','remote','add',f'--gpg-import={previous_key}','--set=gpg-verify-summary=true','previous',previous+'flatpak/')
   available=run('ostree',f'--repo={repo}','remote','refs','previous',capture=True).splitlines()
   selected=[ref.split(':',1)[-1] for ref in available if ref.split(':',1)[-1]==REF or ref.split(':',1)[-1] in ['appstream/x86_64','appstream2/x86_64','screenshots/x86_64']]
   assert REF in selected
   # The modern channel advertises only the tested architecture. Native ARM
   # repositories and historical release bundles are independent and untouched.
   run('ostree',f'--repo={repo}','pull','--mirror','--depth=0','previous',*selected)
   # Keep the previous head addressable while old summaries are cached by CDNs.
   old=run('ostree',f'--repo={repo}','rev-parse',REF,capture=True)
   if not prior:run('ostree',f'--repo={repo}','refs',f'--create=history/airdrop-linux/{old}',old)
   run('ostree',f'--repo={repo}','remote','delete','previous')
  if not prior:
   if not r2:raise ValueError('The first signed channel requires the verified actual r2 bundle')
   expected=json.loads(Path('packaging/flatpak-channel/channel.json').read_text())['r2_sha256']
   if hashlib.sha256(r2.read_bytes()).hexdigest()!=expected:raise ValueError('r2 bundle checksum mismatch')
   run('flatpak','build-import-bundle','--no-update-summary',f'--gpg-sign={fingerprint}',f'--gpg-homedir={os.environ["GNUPGHOME"]}',repo,r2)
   assert run('ostree',f'--repo={repo}','rev-parse',REF,capture=True)==R2
  run('flatpak','build-commit-from',f'--src-repo={source}',f'--src-ref={REF}','--no-update-summary','--force','--timestamp=NOW',f'--gpg-sign={fingerprint}',f'--gpg-homedir={os.environ["GNUPGHOME"]}',repo,REF)
  for media in run('ostree',f'--repo={source}','refs',capture=True).splitlines():
   if media.startswith('screenshots/'):
    run('ostree',f'--repo={repo}','pull-local','--untrusted',source,media)
    media_commit=run('ostree',f'--repo={repo}','rev-parse',media,capture=True)
    run('ostree',f'--repo={repo}','gpg-sign',f'--gpg-homedir={os.environ["GNUPGHOME"]}',media_commit,fingerprint)
  run('flatpak','build-update-repo','--generate-static-deltas','--static-delta-jobs=2','--title=Airdrop Linux',f'--gpg-sign={fingerprint}',f'--gpg-homedir={os.environ["GNUPGHOME"]}',repo)
  # Keep current and previous payloads for real updates/cache overlap without
  # growing the combined Pages site indefinitely. Prune only this staged repo.
  run('ostree',f'--repo={repo}','prune','--refs-only','--depth=1')
  current=run('ostree',f'--repo={repo}','rev-parse',REF,capture=True)
  published={**receipt,'schema':1,'commit':current,'baseline_commit':prior['commit'] if prior else R2,'fingerprint':fingerprint,'repository_url':base+'flatpak/'}
  channel=public/'flatpak-channel.json';channel.write_text(json.dumps(published,sort_keys=True,indent=2)+'\n')
  run('gpg','--batch','--yes','--local-user',fingerprint,'--armor','--detach-sign',channel)
  run('gpgv','--keyring',key,str(channel)+'.asc',channel)
  descriptors(public,base,key)
  # Native key files are already present in production and must match.
  if (public/'airdrop-linux.gpg').exists():verify_public_key(public/'airdrop-linux.gpg',fingerprint)
  else:shutil.copyfile(key,public/'airdrop-linux.gpg')
  shutil.copyfile('scripts/install-flatpak.py',public/'install-flatpak.py')
  run('gpg','--batch','--yes','--local-user',fingerprint,'--armor','--detach-sign',public/'install-flatpak.py')
  with (public/'index.md').open('a') as index:index.write('\nFlatpak: [verified installer](install-flatpak.py) · [remote](airdrop-linux.flatpakrepo) · [install reference](airdrop-linux.flatpakref)\n')
 assert all((public/name).is_file() and hashlib.sha256((public/name).read_bytes()).hexdigest()==digest for name,digest in native_before.items()), 'Native repository bytes changed during Flatpak publication'
 print(json.dumps({'signed_commit':current,'source_commit':receipt['source_commit'],'revision':receipt['revision'],'public_bytes':sum(p.stat().st_size for p in public.rglob('*') if p.is_file())}))
 return published
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidate',required=True,type=Path);p.add_argument('--public',required=True,type=Path);p.add_argument('--fingerprint',required=True);p.add_argument('--base-url',default=PRODUCTION);p.add_argument('--previous-url',default=PRODUCTION);p.add_argument('--r2',type=Path)
 a=p.parse_args();promote(a.candidate,a.public,a.fingerprint,a.base_url,a.previous_url or None,a.r2)
