#!/usr/bin/env python3
"""Carry the current signed Flatpak channel into an APT/RPM-only Pages release.

Exit 2 only when no modern channel has ever been published. Any signature,
network or identity failure aborts publication instead of falling back to r2.
"""
import argparse,hashlib,os,shutil,tempfile
from pathlib import Path
from flatpak_channel import PRODUCTION,fetch,verify_public_key,signed_json,run,descriptors,REF,pull_repository,canonical_channel_refs

def native_snapshot(public):
 return {str(p.relative_to(public)):hashlib.sha256(p.read_bytes()).hexdigest() for tree in ['apt','rpm'] for p in (public/tree).rglob('*') if p.is_file()}

def preserve(public,fingerprint,base=PRODUCTION):
 with tempfile.TemporaryDirectory() as directory:
  temp=Path(directory);key=temp/'key.gpg';fetch(base+'airdrop-linux.gpg',key);verify_public_key(key,fingerprint)
  prior=signed_json(base,key,temp,optional=True)
  if prior is None:return None
  before=native_snapshot(public)
  repo=public/'flatpak';assert not repo.exists();run('ostree',f'--repo={repo}','init','--mode=archive-z2')
  run('ostree',f'--repo={repo}','remote','add',f'--gpg-import={key}','--set=gpg-verify-summary=true','previous',base+'flatpak/')
  selected=canonical_channel_refs(repo,'previous')
  pull_repository(repo,'--mirror','--depth=1','previous',*selected)
  run('ostree',f'--repo={repo}','fsck')
  assert run('ostree',f'--repo={repo}','rev-parse',REF,capture=True)==prior['commit']
  run('ostree',f'--repo={repo}','show','--gpg-verify-remote=previous',prior['baseline_commit'])
  run('ostree',f'--repo={repo}','remote','delete','previous')
  run('flatpak','build-update-repo','--generate-static-deltas','--static-delta-jobs=2',f'--gpg-sign={fingerprint}',f'--gpg-homedir={os.environ["GNUPGHOME"]}',repo)
  run('ostree',f'--repo={repo}','prune','--refs-only','--depth=1')
  for source,name in [('previous-channel.json','flatpak-channel.json'),('previous-channel.json.asc','flatpak-channel.json.asc')]:shutil.copyfile(temp/source,public/name)
  descriptors(public,base,key)
  shutil.copyfile('scripts/install-flatpak.py',public/'install-flatpak.py')
  run('gpg','--batch','--yes','--local-user',fingerprint,'--armor','--detach-sign',public/'install-flatpak.py')
  assert native_snapshot(public)==before,'Native package inputs changed while preserving the Flatpak channel'
  print('Preserved published Flatpak commit and signed channel receipt',prior['commit'])
  return prior

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--public',required=True,type=Path);p.add_argument('--fingerprint',required=True);a=p.parse_args()
 if preserve(a.public,a.fingerprint) is None:raise SystemExit(2)
