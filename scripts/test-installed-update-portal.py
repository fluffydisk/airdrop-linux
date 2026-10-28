#!/usr/bin/env python3
"""Actual signed Flatpak update through the installed in-sandbox helper.

Disposable CI only. Portal consent is explicitly seeded in this test account;
no interactive user consent or physical desktop test is claimed.
"""
import argparse,json,os,subprocess,tempfile
from pathlib import Path
APP='io.github.fluffydisk.airdrop-linux';REF='app/'+APP+'/x86_64/stable'
def run(*args):
 return subprocess.check_output(list(map(str,args)),text=True).strip()
p=argparse.ArgumentParser();p.add_argument('--repo',required=True,type=Path);a=p.parse_args()
assert os.environ.get('AIRDROP_TEST_DISPOSABLE')=='1'
key=os.environ['SIGNING_KEY_FINGERPRINT']
old=run('flatpak','info','--user','--show-commit',APP)
with tempfile.TemporaryDirectory(prefix='airdrop-portal-update-fixture-') as directory:
 build=Path(directory)/'build'
 run('ostree','--repo='+str(a.repo),'checkout','--user-mode','--force-copy',old,build)
 file=build/'files/share/airdrop-linux/distribution.json';marker=json.loads(file.read_text());marker['revision']+=1
 file.write_text(json.dumps(marker)+'\n')
 # Real changed payload, same permissions, signed by the already trusted CI key.
 run('flatpak','build-export','--gpg-sign='+key,'--gpg-homedir='+os.environ['GNUPGHOME'],a.repo,build,'stable')
 run('flatpak','build-update-repo','--gpg-sign='+key,'--gpg-homedir='+os.environ['GNUPGHOME'],a.repo)
 expected=run('ostree','--repo='+str(a.repo),'rev-parse',REF);assert expected!=old
 try:
  run('flatpak','permission-set','flatpak','updates',APP,'no')
  denied=subprocess.run(['flatpak','run','--user','--command=/app/bin/airdrop-update-portal',APP],capture_output=True,text=True,timeout=90)
  assert denied.returncode!=0 and run('flatpak','info','--user','--show-commit',APP)==old,'Consent denial must leave installed commit intact'
  run('flatpak','permission-set','flatpak','updates',APP,'yes')
  installed=subprocess.run(['flatpak','run','--user','--command=/app/bin/airdrop-update-portal',APP],capture_output=True,text=True,timeout=180)
  print(installed.stdout,flush=True)
  assert installed.returncode==0,installed.stderr
  assert 'done' in installed.stdout.splitlines(),installed.stdout
  assert run('flatpak','info','--user','--show-commit',APP)==expected
  current=json.loads(run('flatpak','run','--user','--command=/app/lib/airdrop-linux/runtime/node',APP,'-e','console.log(require("node:fs").readFileSync("/app/share/airdrop-linux/distribution.json","utf8"))'))
  assert current['revision']==marker['revision']
  print('VERIFIED: installed app helper performed a real GPG-verified portal update to a changed payload; denied consent kept the old commit; newly launched sandbox loaded the new payload. Consent is a CI fixture, not a physical-user dialog test.')
 finally:
  run('flatpak','permission-remove','flatpak','updates',APP)
