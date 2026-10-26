#!/usr/bin/env python3
"""Real signed HTTP repository: retry a 503, never retry a bad signature."""
import functools,http.server,os,subprocess,tempfile,threading
from pathlib import Path
from flatpak_channel import REF,pull_repository,run

with tempfile.TemporaryDirectory(prefix='airdrop-http-retry-') as directory:
 root=Path(directory);keyring=root/'keys';keyring.mkdir(mode=0o700)
 keyenv={**os.environ,'GNUPGHOME':str(keyring)}
 def gpg(*args,**kwargs):return subprocess.run(['gpg','--batch',*args],env=keyenv,check=True,**kwargs)
 try:
  gpg('--pinentry-mode','loopback','--passphrase','','--quick-generate-key','Retry fixture <test@example.invalid>','ed25519','sign','1d',capture_output=True)
  rows=subprocess.check_output(['gpg','--batch','--with-colons','--list-secret-keys'],env=keyenv,text=True)
  key=next(r.split(':')[9] for r in rows.splitlines() if r.startswith('fpr:'))
  public=root/'key.gpg'
  with public.open('wb') as output:gpg('--export',key,stdout=output)
  source=root/'source';tree=root/'tree';tree.mkdir();(tree/'payload.txt').write_text('Signed network retry payload\n')
  run('ostree',f'--repo={source}','init','--mode=archive-z2')
  commit=subprocess.check_output(['ostree',f'--repo={source}','commit','--branch='+REF,'--subject=HTTP retry fixture','--tree=dir='+str(tree),f'--gpg-homedir={keyring}',f'--gpg-sign={key}'],text=True).strip()
  run('ostree',f'--repo={source}','summary','--update',f'--gpg-homedir={keyring}',f'--gpg-sign={key}')
  class Handler(http.server.SimpleHTTPRequestHandler):
   failures=1;commit_requests=0;summary_requests=0
   def log_message(self,*args):pass
   def do_GET(self):
    if self.path=='/summary':Handler.summary_requests+=1
    if self.path.endswith('.commit'):
     Handler.commit_requests+=1
     if Handler.failures:
      Handler.failures-=1;self.send_response(503,'Controlled transient');self.send_header('Content-Length','0');self.end_headers();return
    super().do_GET()
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(source)))
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   def remote(name):
    dest=root/name;run('ostree',f'--repo={dest}','init','--mode=bare-user')
    run('ostree',f'--repo={dest}','remote','add',f'--gpg-import={public}','--set=gpg-verify-summary=true','fixture',f'http://127.0.0.1:{server.server_port}/')
    return dest
   dest=remote('client')
   # Disable only libostree's own network retry in this fault-injection test
   # to exercise our outer 503 retry. Both GPG checks remain enabled.
   pull_repository(dest,'--network-retries=0','fixture',REF,delay=0)
   assert Handler.commit_requests==2
   assert subprocess.check_output(['ostree',f'--repo={dest}','cat','fixture:'+REF,'/payload.txt'],text=True)=='Signed network retry payload\n'
   print('VERIFIED: real signed repository recovered from an injected object HTTP 503; authenticated payload is correct')
   Handler.failures=100;before=Handler.commit_requests
   try:pull_repository(remote('persistent-503'),'--network-retries=0','fixture',REF,delay=0)
   except subprocess.CalledProcessError:pass
   else:raise AssertionError('Persistent HTTP 503 was ignored')
   assert Handler.commit_requests-before==3,'Retry budget was not enforced'
   Handler.failures=0
   print('VERIFIED: persistent HTTP 503 fails after exactly three attempts')
   (source/'summary.sig').write_bytes(b'Invalid signature fixture')
   before=Handler.summary_requests
   try:pull_repository(remote('bad-signature'),'--network-retries=0','fixture',REF,delay=0)
   except subprocess.CalledProcessError:pass
   else:raise AssertionError('Invalid repository signature was accepted')
   assert Handler.summary_requests-before==1,'Integrity error was retried'
   print('VERIFIED: invalid signed summary is fatal on the first attempt; no signature bypass or integrity retry')
  finally:server.shutdown();server.server_close();thread.join()
 finally:subprocess.run(['gpgconf','--kill','gpg-agent'],env=keyenv,check=False)
