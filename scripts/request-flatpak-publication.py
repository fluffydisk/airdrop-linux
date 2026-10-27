#!/usr/bin/env python3
"""Request the existing approval gate, retiring only superseded legacy runs.

Never approves a deployment or changes environment protection. Modern pending
requests and newer native releases are never cancelled automatically.
"""
import base64,hashlib,json,os,re,subprocess,sys,tempfile
from pathlib import Path
from flatpak_channel import PRODUCTION,FINGERPRINT,fetch,verify_public_key,signed_json
repo='fluffydisk/airdrop-linux'
def api(path):return subprocess.run(['gh','api',f'repos/{repo}/'+path],capture_output=True,text=True)
def version(value):return tuple(map(int,value.removeprefix('v').split('.')))
def public_bootstrap_changed(base,key,temp):
 file=temp/'published-installer.py';signature=temp/'published-installer.py.asc'
 fetch(base+'install-flatpak.py',file);fetch(base+'install-flatpak.py.asc',signature)
 subprocess.run(['gpgv','--keyring',str(key),str(signature),str(file)],check=True)
 return hashlib.sha256(file.read_bytes()).digest()!=hashlib.sha256(Path('scripts/install-flatpak.py').read_bytes()).digest()

def request(run_id,tag):
 assert re.fullmatch(r'\d+',run_id) and re.fullmatch(r'v\d+\.\d+\.\d+',tag)
 response=api('actions/workflows/package-publishing.yml/runs?status=waiting');response.check_returncode()
 for waiting in json.loads(response.stdout)['workflow_runs']:
  if waiting['head_branch']!='main':continue
  source=waiting['head_sha']
  modern=api('contents/packaging/flatpak-channel/channel.json?ref='+source)
  if modern.returncode==0:continue
  if 'HTTP 404' not in modern.stderr:raise RuntimeError('Could not determine pending publication provenance')
  package=api('contents/package.json?ref='+source);package.check_returncode()
  package_version=json.loads(base64.b64decode(json.loads(package.stdout)['content']))['version']
  if version(package_version)>version(tag):continue
  print('Retiring superseded pre-channel publication request',waiting['id'],source,flush=True)
  subprocess.run(['gh','api','--method','POST',f'repos/{repo}/actions/runs/{waiting["id"]}/cancel'],check=True)
 candidate=['-f','flatpak_run='+run_id]
 with tempfile.TemporaryDirectory() as directory:
  temp=Path(directory);key=temp/'key.gpg';fetch(PRODUCTION+'airdrop-linux.gpg',key);verify_public_key(key,FINGERPRINT)
  live=signed_json(PRODUCTION,key,temp,optional=True)
  if live and (version(live['version']),live['revision']) >= (version(tag),int(os.environ['TARGET_REVISION'])):
   if not public_bootstrap_changed(PRODUCTION,key,temp):
    print('Signed public channel and bootstrap are current; no duplicate approval requested.',flush=True)
    return
   # Update auxiliary site files without republishing/downgrading the app.
   tag='v'+live['version'];candidate=[]
   print('Signed app is current but the authenticated bootstrap differs; requesting preservation-only refresh.',flush=True)
 subprocess.run(['gh','workflow','run','package-publishing.yml','--repo',repo,'--ref','main','-f','tag='+tag,'-F','publish=true',*candidate],check=True)
 print('Requested protected publication; required human review remains enforced.',flush=True)

if __name__=='__main__':request(*sys.argv[1:])
