#!/usr/bin/env python3
"""Full preservation regression with a signed Flatpak fixture, not real Airdrop."""
import functools,http.server,importlib.util,json,os,subprocess,tempfile,threading
from pathlib import Path
from flatpak_channel import APP,REF,run

spec=importlib.util.spec_from_file_location('channel_preserver',Path(__file__).with_name('preserve-flatpak-channel.py'))
preserver=importlib.util.module_from_spec(spec);spec.loader.exec_module(preserver)
spec=importlib.util.spec_from_file_location('channel_requester',Path(__file__).with_name('request-flatpak-publication.py'))
requester=importlib.util.module_from_spec(spec);spec.loader.exec_module(requester)

with tempfile.TemporaryDirectory(prefix='airdrop-preservation-') as directory:
 root=Path(directory);home=root/'keys';home.mkdir(mode=0o700)
 original=os.environ.get('GNUPGHOME');os.environ['GNUPGHOME']=str(home)
 try:
  run('gpg','--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key','Preservation fixture <test@example.invalid>','ed25519','sign','1d')
  key=next(row.split(':')[9] for row in run('gpg','--batch','--with-colons','--list-secret-keys',capture=True).splitlines() if row.startswith('fpr:'))
  source=root/'source';source.mkdir();repo=source/'flatpak';build=root/'build'
  (build/'files/bin').mkdir(parents=True);(build/'export').mkdir()
  (build/'metadata').write_text(f'[Application]\nname={APP}\nruntime=org.freedesktop.Platform/x86_64/26.08\nsdk=org.freedesktop.Sdk/x86_64/26.08\ncommand=fixture\n')
  payload=build/'files/bin/fixture';payload.write_text('#!/bin/sh\necho baseline-fixture\n');payload.chmod(0o755)
  def export(branch):
   run('flatpak','build-export','--arch=x86_64','--no-update-summary',f'--gpg-sign={key}',f'--gpg-homedir={home}',repo,build,branch)
   return run('ostree',f'--repo={repo}','rev-parse',f'app/{APP}/x86_64/{branch}',capture=True)
  baseline=export('stable')
  payload.write_text('#!/bin/sh\necho current-fixture\n');current=export('stable')
  assert baseline!=current
  # Reproduce the exact production defect: a valid signed app commit exposed
  # through an alias that does not appear in its immutable ref-binding.
  run('ostree',f'--repo={repo}','refs','--create=history/airdrop-linux/'+baseline,baseline)
  def summary():run('flatpak','build-update-repo',f'--gpg-sign={key}',f'--gpg-homedir={home}',repo)
  summary()
  with (source/'airdrop-linux.gpg').open('wb') as output:subprocess.run(['gpg','--batch','--export',key],stdout=output,check=True)
  class Quiet(http.server.SimpleHTTPRequestHandler):
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(source)))
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   base=f'http://127.0.0.1:{server.server_port}/'
   receipt={'schema':1,'app_id':APP,'arch':'x86_64','branch':'stable','version':'1.5.0','revision':3,'commit':current,'baseline_commit':baseline,'fingerprint':key,'repository_url':base+'flatpak/','fixture':True}
   def sign_receipt():
    file=source/'flatpak-channel.json';file.write_text(json.dumps(receipt,sort_keys=True,indent=2)+'\n')
    run('gpg','--batch','--yes','--local-user',key,'--armor','--detach-sign',file)
   sign_receipt()
   bootstrap=source/'install-flatpak.py'
   bootstrap.write_text('# authenticated previous bootstrap fixture\n')
   def sign_bootstrap():run('gpg','--batch','--yes','--local-user',key,'--armor','--detach-sign',bootstrap)
   sign_bootstrap()
   check=root/'bootstrap-check';check.mkdir()
   assert requester.public_bootstrap_changed(base,source/'airdrop-linux.gpg',check)
   bootstrap.write_bytes(Path('scripts/install-flatpak.py').read_bytes());sign_bootstrap()
   assert not requester.public_bootstrap_changed(base,source/'airdrop-linux.gpg',check)
   bootstrap.write_text('# tampered bootstrap fixture\n')
   try:requester.public_bootstrap_changed(base,source/'airdrop-linux.gpg',check)
   except subprocess.CalledProcessError:pass
   else:raise AssertionError('Invalid public bootstrap signature was ignored')
   bootstrap.write_text('# authenticated previous bootstrap fixture\n');sign_bootstrap()
   print('VERIFIED: authenticated stale bootstrap requests refresh, current bootstrap skips it, invalid signature is fatal',flush=True)
   probe=root/'unfiltered';run('ostree',f'--repo={probe}','init','--mode=archive-z2')
   run('ostree',f'--repo={probe}','remote','add',f'--gpg-import={source/"airdrop-linux.gpg"}','--set=gpg-verify-summary=true','fixture',base+'flatpak/')
   # Pull only the invalid alias into a fresh repo: a full mirror may first
   # cache the same commit through its valid canonical ref, skipping rechecks.
   failed=subprocess.run(['ostree',f'--repo={probe}','pull','--mirror','--depth=1','fixture','history/airdrop-linux/'+baseline],capture_output=True,text=True)
   assert failed.returncode and 'binding' in failed.stderr.lower(),failed.stderr
   print('VERIFIED: explicit historical-alias pull deterministically rejects its signed ref binding',flush=True)
   def native(name):
    public=root/name;public.mkdir()
    for tree in ['apt','rpm']:(public/tree).mkdir();(public/tree/'fixture-input').write_bytes((tree+' unchanged\n').encode())
    (public/'airdrop-linux.gpg').write_bytes((source/'airdrop-linux.gpg').read_bytes())
    return public
   public=native('preserved');before=preserver.native_snapshot(public)
   assert preserver.preserve(public,key,base)==receipt
   target=public/'flatpak'
   assert run('ostree',f'--repo={target}','rev-parse',REF,capture=True)==current
   assert 'baseline-fixture' in run('ostree',f'--repo={target}','cat',baseline,'/files/bin/fixture',capture=True)
   assert not any(ref.startswith('history/') for ref in run('ostree',f'--repo={target}','refs',capture=True).splitlines())
   assert (public/'flatpak-channel.json').read_bytes()==(source/'flatpak-channel.json').read_bytes()
   assert (public/'flatpak-channel.json.asc').read_bytes()==(source/'flatpak-channel.json.asc').read_bytes()
   assert (public/'install-flatpak.py').read_bytes()==Path('scripts/install-flatpak.py').read_bytes()
   run('gpgv','--keyring',source/'airdrop-linux.gpg',public/'install-flatpak.py.asc',public/'install-flatpak.py')
   assert preserver.native_snapshot(public)==before
   run('ostree',f'--repo={target}','fsck')
   print('VERIFIED: complete signed preservation retains app/current parent, receipt bytes, native fixture inputs and valid bootstrap signature; history aliases omitted',flush=True)
   bad=export('untrusted')
   run('ostree',f'--repo={repo}','refs','--force','--create='+REF,bad)
   receipt['commit']=bad;sign_receipt();summary()
   try:preserver.preserve(native('bad-binding'),key,base)
   except subprocess.CalledProcessError as error:assert 'binding' in str(error.output).lower(),error.output
   else:raise AssertionError('Wrong binding on the canonical app ref was accepted')
   print('VERIFIED: canonical app ref with a wrong signed binding is still rejected; no binding or GPG bypass',flush=True)
  finally:server.shutdown();server.server_close();thread.join()
 finally:
  subprocess.run(['gpgconf','--kill','gpg-agent'],check=False)
  if original is None:os.environ.pop('GNUPGHOME',None)
  else:os.environ['GNUPGHOME']=original
