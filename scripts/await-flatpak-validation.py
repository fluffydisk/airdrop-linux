#!/usr/bin/env python3
"""Require the same tested application source before creating its native tag."""
import json,re,subprocess,sys,tempfile,time
from pathlib import Path
from candidate_provenance import verified_build
repo='fluffydisk/airdrop-linux';source=sys.argv[1];assert re.fullmatch('[0-9a-f]{40}',source)
def api(path):return json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/'+path],text=True))
checked=set();deadline=time.monotonic()+1200
while time.monotonic()<deadline:
 runs=api('actions/workflows/flatpak-update-repository.yml/runs?branch=main&per_page=10')['workflow_runs']
 for run in runs:
  key=(run['id'],run.get('run_attempt',1))
  if key in checked:continue
  jobs=api(f'actions/runs/{run["id"]}/jobs?per_page=100')['jobs']
  if not verified_build(run,jobs):
   if run['head_sha']==source and run['conclusion'] in ['failure','cancelled','timed_out']:
    raise RuntimeError('Matching Flatpak validation did not pass; no native tag will be created')
   if run['conclusion'] is not None:checked.add(key)
   continue
  with tempfile.TemporaryDirectory(prefix='flatpak-source-proof-') as directory:
   subprocess.run(['gh','run','download',str(run['id']),'--repo',repo,'--name','signed-flatpak-validation-evidence','--dir',directory],check=True)
   receipt=json.loads((Path(directory)/'prepared/preparation.json').read_text())
  if receipt['application_commit']==source:
   print('All required Flatpak validation passed for the exact native source:',source,flush=True);sys.exit(0)
  checked.add(key)
 print('Waiting for the same application source to finish Flatpak validation before tagging…',flush=True);time.sleep(5)
raise RuntimeError('Timed out waiting for source-matched Flatpak validation; tag remains uncreated')
