#!/usr/bin/env python3
"""Download only a successfully tested candidate produced on this repo's main."""
import argparse,hashlib,json,re,shutil,subprocess,tarfile,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('run_id');p.add_argument('output',type=Path);a=p.parse_args()
assert re.fullmatch(r'\d+',a.run_id)
repo='fluffydisk/airdrop-linux'
def api(path):return json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/'+path],text=True))
for attempt in range(13):
 run=api('actions/runs/'+a.run_id)
 if run['status']=='completed':break
 if attempt==12:raise RuntimeError('Candidate run did not finish')
 time.sleep(5)
assert run['conclusion']=='success' and run['head_branch']=='main' and run['head_repository']['full_name']==repo
assert run['path']=='.github/workflows/flatpak-update-repository.yml'
a.output.mkdir();archive_dir=a.output/'download'
subprocess.run(['gh','run','download',a.run_id,'--repo',repo,'--name','signed-flatpak-candidate','--dir',str(archive_dir)],check=True)
archive=archive_dir/'candidate.tar'
assert (archive_dir/'candidate.tar.sha256').read_text().split()==[hashlib.sha256(archive.read_bytes()).hexdigest(),'candidate.tar']
with tarfile.open(archive) as tar:tar.extractall(a.output,filter='data')
receipt=json.loads((a.output/'candidate.json').read_text())
assert receipt['build_run']==a.run_id and receipt['workflow_commit']==run['head_sha']
shutil.rmtree(archive_dir)
print('Verified candidate run',a.run_id,'source',receipt['source_commit'],'revision',receipt['revision'])
