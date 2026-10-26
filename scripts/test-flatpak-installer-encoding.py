#!/usr/bin/env python3
"""Exercise real GPG signatures whose key UID has non-ASCII characters."""
import importlib.util,os,subprocess,sys,tempfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('encoding_installer',Path(__file__).with_name('install-flatpak.py'))
installer=importlib.util.module_from_spec(spec);sys.modules[spec.name]=installer;spec.loader.exec_module(installer)
for status in [0,1]:
 args=[sys.executable,'-c',"import sys;sys.stderr.buffer.write(b'non-UTF8 UID: \\xd6\\n');sys.exit("+str(status)+")"]
 try:installer.command(*args)
 except RuntimeError:assert status==1
 else:assert status==0
print('VERIFIED: undecodable diagnostic bytes preserve both successful and failed subprocess exit status')
with tempfile.TemporaryDirectory(prefix='airdrop-key-encoding-') as directory:
 root=Path(directory);home=root/'keys';home.mkdir(mode=0o700)
 try:
  def gpg(*args):return installer.command('gpg','--homedir',home,'--batch',*args)
  gpg('--pinentry-mode','loopback','--passphrase','','--quick-generate-key','Ö encoding fixture <test@example.invalid>','ed25519','sign','1d')
  key=next(row.split(':')[9] for row in gpg('--with-colons','--list-secret-keys').stdout.splitlines() if row.startswith('fpr:'))
  public=root/'key.gpg'
  with public.open('wb') as output:subprocess.run(['gpg','--homedir',str(home),'--batch','--export',key],stdout=output,check=True)
  payload=root/'channel.json';payload.write_text('{"signed":"encoding fixture"}\n')
  gpg('--yes','--local-user',key,'--armor','--detach-sign',payload)
  args=['gpgv','--keyring',str(public),str(payload)+'.asc',str(payload)]
  raw=subprocess.run(args,capture_output=True,env={**os.environ,'LC_ALL':'C'},check=True)
  try:raw.stderr.decode('utf-8');legacy=False
  except UnicodeDecodeError:legacy=True
  installer.command(*args)
  print(f'VERIFIED: real GPG signature with non-ASCII key UID accepted; non-UTF8 C-locale diagnostics reproduced={legacy}')
  payload.write_text('{"signed":"tampered fixture"}\n')
  try:installer.command(*args)
  except RuntimeError as error:assert 'BAD signature' in str(error),str(error)
  else:raise AssertionError('Tampered signed metadata was accepted')
  print('VERIFIED: tampered metadata with the same non-ASCII key UID is rejected; decoding does not change signature validity')
 finally:subprocess.run(['gpgconf','--kill','gpg-agent'],env={**os.environ,'GNUPGHOME':str(home)},check=False)
