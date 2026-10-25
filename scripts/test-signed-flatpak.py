#!/usr/bin/env python3
"""Real signed-repository install/update/r2 migration in a disposable account.

Uses the actual r2 bundle and clean-built candidate, not a toy application.
Tailscale credential-retention sentinels are explicitly fixtures, not an
authenticated account. Requires an isolated CI VM/account and no installed app.
"""
import argparse,contextlib,hashlib,http.server,importlib.util,json,os,shutil,subprocess,tempfile,threading,uuid
from pathlib import Path
from flatpak_channel import APP,REF,R2,descriptors,promote,run
import importlib.util
spec=importlib.util.spec_from_file_location('airdrop_installer',Path(__file__).with_name('install-flatpak.py'))
installer=importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name]=installer;spec.loader.exec_module(installer)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

def node(scope,code):
 return run('flatpak','run','--'+scope,'--command=/app/lib/airdrop-linux/runtime/node',APP,'-e',code,capture=True)

def state(scope,seed=False):
 code='''const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(process.env.XDG_DATA_HOME,'airdrop');
const relative=['files/repository-update-sentinel.txt','config/repository-test.env','state/desktop/connections/devices.json','state/desktop/connections/tsnet/credential-retention-fixture'];
'''
 if seed:
  code+='''for(const name of relative){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});if(fs.existsSync(file))throw Error('Refusing to overwrite existing data');fs.writeFileSync(file,name.endsWith('devices.json')?JSON.stringify({mode:'local',configured:true}):crypto.randomBytes(64),{mode:0o600});}'''
 code+='''console.log(JSON.stringify(Object.fromEntries(relative.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]))));'''
 return json.loads(node(scope,code))

def baseline(public,r2,key,base):
 public.mkdir();repo=public/'flatpak';run('ostree',f'--repo={repo}','init','--mode=archive-z2')
 run('flatpak','build-import-bundle','--no-update-summary',f'--gpg-sign={key}',f'--gpg-homedir={os.environ["GNUPGHOME"]}',repo,r2)
 run('flatpak','build-update-repo',f'--gpg-sign={key}',f'--gpg-homedir={os.environ["GNUPGHOME"]}',repo)
 assert run('ostree',f'--repo={repo}','rev-parse',REF,capture=True)==R2
 public_key=public/'airdrop-linux.gpg'
 with public_key.open('wb') as output:subprocess.run(['gpg','--batch','--export',key],stdout=output,check=True)
 descriptors(public,base,public_key)
 receipt={'schema':1,'app_id':APP,'arch':'x86_64','branch':'stable','version':'1.5.0','revision':2,'source_commit':'680434e8d656d7052374063e7f7e88e69d60f89a','commit':R2,'baseline_commit':R2,'fingerprint':key,'repository_url':base+'flatpak/'}
 file=public/'flatpak-channel.json';file.write_text(json.dumps(receipt)+'\n');run('gpg','--batch','--yes','--local-user',key,'--armor','--detach-sign',file)

@contextlib.contextmanager
def system_authorization(temp):
 """Test-only passwordless sudo adapter; never launches the app as root."""
 real=shutil.which('flatpak');wrapper=temp/'authorized-cli';wrapper.mkdir();file=wrapper/'flatpak'
 file.write_text('#!/bin/sh\nif [ "$1" != run ]; then\n for arg do\n  if [ "$arg" = --system ]; then exec sudo --preserve-env=XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS '+real+' "$@"; fi\n done\nfi\nexec '+real+' "$@"\n');file.chmod(0o755)
 old=os.environ['PATH'];os.environ['PATH']=str(wrapper)+os.pathsep+old
 try:yield
 finally:os.environ['PATH']=old

def exercise(candidate,r2,output,system=False):
 assert os.environ.get('AIRDROP_TEST_DISPOSABLE')=='1','This test requires an explicitly disposable account'
 assert not installer.installations(),'Existing app left untouched: use a clean test account'
 output.mkdir();checks=[]
 def passed(name):checks.append({'requirement':name,'status':'VERIFIED'});print('VERIFIED: '+name,flush=True)
 def rejected(action,name):
  try:action()
  except (ValueError,RuntimeError,subprocess.CalledProcessError):passed(name);return
  raise AssertionError('Expected rejection: '+name)
 with tempfile.TemporaryDirectory(prefix='airdrop-signed-test-') as directory:
  temp=Path(directory);key=run('gpg','--with-colons','--list-secret-keys',capture=True).split('fpr:::::::::')[1].split(':')[0]
  host=temp/'host';host.mkdir()
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),lambda *a,**kw:Quiet(*a,directory=str(host),**kw));threading.Thread(target=server.serve_forever,daemon=True).start()
  base=f'http://127.0.0.1:{server.server_port}/channel/';trust=installer.Trust(base,key,2)
  try:
   baseline_dir=temp/'baseline';baseline(baseline_dir,r2,key,base)
   (host/'channel').symlink_to(baseline_dir,target_is_directory=True)
   installer.install('user',trust=trust);assert node('user','console.log(require("/app/lib/airdrop-linux/server/package.json").version)')=='1.5.0'
   before=state('user',True);passed('Clean GPG-verified installation of actual r2 application from HTTP repository')
   next_dir=temp/'next';next_dir.mkdir();(next_dir/'index.md').write_text('# Disposable signing test\n')
   published=promote(candidate,next_dir,key,base,None,r2)
   (host/'next-link').symlink_to(next_dir,target_is_directory=True);os.replace(host/'next-link',host/'channel')
   run('flatpak','update','--user','--noninteractive',APP+'//stable')
   assert run('flatpak','info','--user','--show-commit',APP,'stable',capture=True)==published['commit']!=R2
   marker=json.loads(node('user','console.log(require("node:fs").readFileSync("/app/share/airdrop-linux/distribution.json","utf8"))'))
   assert marker['revision']==published['revision'] and state('user')==before
   passed('Real flatpak update fetched a newer signed commit and its new distribution payload; private data and Tailscale-state fixtures unchanged')
   # The same stable URL now exposes the next complete repository atomically.
   installer.install('user',trust=installer.Trust(base,key));passed('Idempotent trusted-remote install/update')
   for file in ['summary.sig', 'objects/'+published['commit'][:2]+'/'+published['commit'][2:]+'.commitmeta']:
    target=next_dir/'flatpak'/file;backup=target.read_bytes();target.write_bytes(b'invalid signature')
    try:
     rejected(lambda:installer.install('user',trust=installer.Trust(base,key)),f'Invalid {file.rsplit("/",1)[-1]} rejected before installation')
     assert state('user')==before and run('flatpak','info','--user','--show-commit',APP,'stable',capture=True)==published['commit']
    finally:target.write_bytes(backup)
   run('flatpak','remote-modify','--user','--no-gpg-verify','airdrop-linux')
   rejected(lambda:installer.install('user',trust=installer.Trust(base,key)),'Existing remote with disabled GPG verification is rejected, never repaired silently')
   run('flatpak','remote-modify','--user','--gpg-verify','airdrop-linux')
   # Explicitly reset this disposable app to the user's actual standalone r2.
   # No --delete-data is used. Production installer never permits a downgrade.
   run('flatpak','uninstall','--user','--noninteractive',APP)
   run('flatpak','install','--user','--noninteractive',r2)
   assert run('flatpak','info','--user','--show-commit',APP,'stable',capture=True)==R2
   installer.install(trust=installer.Trust(base,key))
   assert state('user')==before and len(installer.installations())==1
   assert run('flatpak','info','--user','--show-origin',APP,'stable',capture=True)=='airdrop-linux'
   passed('Actual standalone r2 -> signed remote migration changed origin without duplicate app or data/identity fixture loss')
   rejected(lambda:installer.install('system',trust=installer.Trust(base,key)),'User installation cannot be shadowed by --system')
   # Serving a correctly signed older channel must not migrate an installed r3.
   (host/'old-link').symlink_to(baseline_dir,target_is_directory=True);os.replace(host/'old-link',host/'channel')
   rejected(lambda:installer.install('user',trust=installer.Trust(base,key)),'Signed repository older than the safe migration revision is rejected')
   (host/'new-link').symlink_to(next_dir,target_is_directory=True);os.replace(host/'new-link',host/'channel')
   if system:
    with system_authorization(temp):
     # Actual system scope in the disposable VM; runtime and GPG remain enabled.
     runtime=temp/'flathub.flatpakrepo';installer.fetch('https://dl.flathub.org/repo/flathub.flatpakrepo',runtime)
     run('flatpak','remote-add','--system','flathub',runtime)
     run('flatpak','install','--system','--noninteractive',r2)
     rejected(lambda:installer.install(trust=installer.Trust(base,key)),'Actual duplicate user/system installation is detected and left untouched')
     run('flatpak','uninstall','--user','--noninteractive',APP)
     rejected(lambda:installer.install('user',trust=installer.Trust(base,key)),'System installation cannot be shadowed by --user')
     installer.install(trust=installer.Trust(base,key));assert state('system')==before
     passed('Actual system r2 migration uses system remote and preserves the desktop user data/identity fixtures')
     run('flatpak','uninstall','--system','--noninteractive',APP)
    installer.install('user',trust=installer.Trust(base,key));assert state('user')==before
   (output/'fixture-public.json').write_text(json.dumps(published,indent=2)+'\n')
   shutil.copyfile(next_dir/'airdrop-linux.flatpakrepo',output/'fixture.flatpakrepo')
   # Reuse packaged functional tests; all operations hit the actual signed app.
   for name,args in [('backend',['dbus-run-session','--','node','scripts/smoke-sandbox.js','flatpak']),('desktop',['xvfb-run','-a','dbus-run-session','--','node','scripts/smoke-sandbox-desktop.cjs','flatpak'])]:
    with (output/(name+'.log')).open('w') as stream:
     subprocess.run(args,check=True,stdout=stream,stderr=subprocess.STDOUT,env={**os.environ,'AIRDROP_TEST_DEVICES':'1','AIRDROP_TEST_CONNECTION':'1','AIRDROP_TEST_HOME':'/var/data/signed-repository-functional-test'})
    passed('Actual signed app '+name+' transfer/LAN/QR/clipboard/lifecycle checks')
   shutil.copyfile(next_dir/'flatpak-channel.json',output/'signed-channel.json')
   passed('Application remains installed once with both summary/commit GPG checks enabled')
  finally:
   server.shutdown()
   (output/'results.json').write_text(json.dumps({'checks':checks,'account_credentials':'retention fixtures only; no authenticated physical-device claim'},indent=2)+'\n')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidate',required=True,type=Path);p.add_argument('--r2',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--system-cases',action='store_true');a=p.parse_args()
 exercise(a.candidate,a.r2,a.output,a.system_cases)
