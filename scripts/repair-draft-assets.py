#!/usr/bin/env python3
"""Complete a partial draft from its original tested producer; never overwrite assets."""
import argparse,hashlib,json,re,subprocess,time
from pathlib import Path
REPO='fluffydisk/airdrop-linux'
def gh(*args):return subprocess.check_output(['gh',*args],text=True)
def api(path):return json.loads(gh('api',path if path.startswith('https://api.github.com/') else f'repos/{REPO}/'+path))
def provenance(run_id,tag):
 assert re.fullmatch(r'\d+',run_id) and re.fullmatch(r'v\d+\.\d+\.\d+',tag)
 run=api('actions/runs/'+run_id);ref=api('git/ref/tags/'+tag)
 assert run['path']=='.github/workflows/release.yml' and run['head_branch'] in ['main',tag]
 assert ref['object']['type']=='commit' and ref['object']['sha']==run['head_sha']
 jobs=api('actions/runs/'+run_id+'/jobs?per_page=100')['jobs']
 for name in ['build (ubuntu-24.04, x64)','build (ubuntu-24.04-arm, arm64)']:
  job=next(j for j in jobs if j['name']==name);assert job['conclusion']=='success'
  for step in ['Run npm test','Run actions/upload-artifact@v4']:
   assert next(s for s in job['steps'] if s['name']==step)['conclusion']=='success'
 print('Verified original tested producer and immutable tag:',run['head_sha'],flush=True)
def digest(file):
 h=hashlib.sha256()
 with file.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def repair(run_id,tag,directory):
 provenance(run_id,tag)
 url=json.loads(gh('release','view',tag,'--repo',REPO,'--json','apiUrl'))['apiUrl']
 assert re.fullmatch(r'https://api.github.com/repos/fluffydisk/airdrop-linux/releases/\d+',url)
 def release():
  value=api(url);assert value['draft'] and value['tag_name']==tag;return value
 data=release();manifest=json.loads((directory/'airdrop-update.json').read_text());assert manifest['version']==tag[1:]
 records=(directory/'SHA256SUMS').read_text().splitlines();expected={}
 for record in records:
  match=re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_.-]+)',record);assert match
  checksum,name=match.groups();assert name not in expected and digest(directory/name)==checksum;expected[name]=checksum
 assert len(expected)==18
 expected['SHA256SUMS']=digest(directory/'SHA256SUMS')
 def verify_existing(data):
  for asset in data['assets']:
   assert asset['name'] in expected,'Unexpected existing asset'
   assert asset['digest']=='sha256:'+expected[asset['name']],'Refusing to replace mismatched existing bytes'
 verify_existing(data)
 for name in expected:
  data=release();verify_existing(data)
  if any(asset['name']==name for asset in data['assets']):continue
  for attempt in range(3):
   result=subprocess.run(['gh','release','upload',tag,str(directory/name),'--repo',REPO],capture_output=True,text=True)
   data=release();verify_existing(data)
   if any(asset['name']==name for asset in data['assets']):break
   if not re.search(r'HTTP (?:404|429|500|502|503|504)\b',result.stderr+result.stdout) or attempt==2:
    raise RuntimeError('Draft asset upload failed; existing assets remain unchanged: '+name)
   time.sleep(5*(attempt+1))
  print('Uploaded verified missing draft asset:',name,flush=True)
 data=release();verify_existing(data);assert {a['name'] for a in data['assets']}==set(expected)
 print('All 19 draft assets now match the original producer. Draft remains unpublished.',flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('run_id');p.add_argument('tag');p.add_argument('directory',nargs='?',type=Path)
 a=p.parse_args()
 if a.directory:repair(a.run_id,a.tag,a.directory)
 else:provenance(a.run_id,a.tag)
