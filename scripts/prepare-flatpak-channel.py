#!/usr/bin/env python3
"""Prepare the existing source-built r2 recipe with a real repository revision."""
import argparse,json,re,subprocess,sys
from pathlib import Path
import yaml
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--source',required=True);p.add_argument('--revision',required=True,type=int);p.add_argument('--output',required=True,type=Path)
a=p.parse_args()
if not re.fullmatch('[0-9a-f]{40}',a.source) or a.revision<3:p.error('Use an immutable source commit and repository revision >= 3')
subprocess.run([sys.executable,'scripts/prepare-device-flatpak.py','--commit',a.source,'--output',str(a.output)],check=True)
source=next((a.output/'application-source').iterdir())
version=json.loads((source/'package.json').read_text())['version']
if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Stable semantic application version required')
marker={'schema':1,'version':version,'revision':a.revision,'source_commit':a.source,'channel':'stable'}
manifest=a.output/'io.github.fluffydisk.airdrop-linux.yml';data=yaml.safe_load(manifest.read_text())
module=next(m for m in data['modules'] if m['name']=='airdrop-linux')
module['sources'].append({'type':'inline','dest-filename':'distribution.json','contents':json.dumps(marker,sort_keys=True)+'\n'})
module['build-commands'].append('install -Dm644 distribution.json /app/share/airdrop-linux/distribution.json')
manifest.write_text(yaml.safe_dump(data,sort_keys=False,width=110))
(a.output/'distribution.json').write_text(json.dumps(marker,indent=2)+'\n')
print(manifest)
