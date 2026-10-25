#!/usr/bin/env python3
"""Request the existing approval gate, retiring only superseded legacy runs.

Never approves a deployment or changes environment protection. Modern pending
requests and newer native releases are never cancelled automatically.
"""
import base64,json,re,subprocess,sys
repo='fluffydisk/airdrop-linux';run_id,tag=sys.argv[1:]
assert re.fullmatch(r'\d+',run_id) and re.fullmatch(r'v\d+\.\d+\.\d+',tag)
def api(path):return subprocess.run(['gh','api',f'repos/{repo}/'+path],capture_output=True,text=True)
def version(value):return tuple(map(int,value.removeprefix('v').split('.')))
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
subprocess.run(['gh','workflow','run','package-publishing.yml','--repo',repo,'--ref','main','-f','tag='+tag,'-F','publish=true','-f','flatpak_run='+run_id],check=True)
print('Requested protected publication; required human review remains enforced.',flush=True)
