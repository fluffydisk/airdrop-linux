#!/usr/bin/env python3
"""Carry the current signed Flatpak channel into an APT/RPM-only Pages release.

Exit 2 only when no modern channel has ever been published. Any signature,
network or identity failure aborts publication instead of falling back to r2.
"""
import argparse,os,shutil,tempfile
from pathlib import Path
from flatpak_channel import PRODUCTION,fetch,verify_public_key,signed_json,run,descriptors,REF,pull_repository
p=argparse.ArgumentParser();p.add_argument('--public',required=True,type=Path);p.add_argument('--fingerprint',required=True);a=p.parse_args()
with tempfile.TemporaryDirectory() as directory:
 temp=Path(directory);key=temp/'key.gpg';fetch(PRODUCTION+'airdrop-linux.gpg',key);verify_public_key(key,a.fingerprint)
 prior=signed_json(PRODUCTION,key,temp,optional=True)
 if prior is None:raise SystemExit(2)
 repo=a.public/'flatpak';assert not repo.exists();run('ostree',f'--repo={repo}','init','--mode=archive-z2')
 run('ostree',f'--repo={repo}','remote','add',f'--gpg-import={key}','--set=gpg-verify-summary=true','previous',PRODUCTION+'flatpak/')
 pull_repository(repo,'--mirror','--depth=1','previous');run('ostree',f'--repo={repo}','remote','delete','previous')
 assert run('ostree',f'--repo={repo}','rev-parse',REF,capture=True)==prior['commit']
 run('flatpak','build-update-repo','--generate-static-deltas','--static-delta-jobs=2',f'--gpg-sign={a.fingerprint}',f'--gpg-homedir={os.environ["GNUPGHOME"]}',repo)
 run('ostree',f'--repo={repo}','prune','--refs-only','--depth=1')
 for source,name in [('previous-channel.json','flatpak-channel.json'),('previous-channel.json.asc','flatpak-channel.json.asc')]:shutil.copyfile(temp/source,a.public/name)
 descriptors(a.public,PRODUCTION,key)
 shutil.copyfile('scripts/install-flatpak.py',a.public/'install-flatpak.py')
 run('gpg','--batch','--yes','--local-user',a.fingerprint,'--armor','--detach-sign',a.public/'install-flatpak.py')
 print('Preserved published Flatpak commit and signed channel receipt',prior['commit'])
