#!/usr/bin/env python3
"""Package the validated archive repository and a provenance receipt for signing."""
import argparse,hashlib,json,os,shutil,subprocess,tarfile
import xml.etree.ElementTree as ET
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--validated',required=True,type=Path);p.add_argument('--prepared',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
a.output.mkdir()
result=json.loads((a.validated/'results.json').read_text());assert result.get('reference_working_on_native_arch') is True and not result.get('failure')
required=['Clean offline build','Manifest lint','Repository lint','Package security and dependency inventory','Backend transfers and isolation','X11 clipboard sandbox and connection UI','Native headless Wayland startup']
assert all(any(r['requirement']==name and r['status']=='VERIFIED' for r in result['checks']) for name in required)
receipt=json.loads((a.prepared/'distribution.json').read_text())
receipt.update(app_id='io.github.fluffydisk.airdrop-linux',arch='x86_64',branch='stable',build_run=os.environ.get('GITHUB_RUN_ID'),workflow_commit=os.environ.get('GITHUB_SHA'))
assert json.loads((a.validated/'build/files/lib/airdrop-linux/server/package.json').read_text())['version']==receipt['version']
assert ET.parse(a.validated/'build/files/share/metainfo/io.github.fluffydisk.airdrop-linux.metainfo.xml').find('releases/release').attrib['version']==receipt['version']
repo=a.validated/'repo';receipt['commit']=subprocess.check_output(['ostree','--repo='+str(repo),'rev-parse','app/io.github.fluffydisk.airdrop-linux/x86_64/stable'],text=True).strip()
shutil.copytree(repo,a.output/'repo');(a.output/'candidate.json').write_text(json.dumps(receipt,sort_keys=True,indent=2)+'\n')
