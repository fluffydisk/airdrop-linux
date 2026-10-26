#!/usr/bin/env python3
"""Regress GitHub's file-only artifact hop with real OSTree integrity checks."""
import subprocess,tempfile,zipfile
from pathlib import Path
from flatpak_channel import REF,restore_artifact_layout

def ostree(repo,*args,check=True):
 return subprocess.run(['ostree',f'--repo={repo}',*args],check=check,capture_output=True,text=True)

with tempfile.TemporaryDirectory(prefix='airdrop-artifact-layout-') as directory:
 root=Path(directory);source=root/'source';tree=root/'tree';tree.mkdir()
 (tree/'payload.txt').write_text('Verified application payload\n')
 ostree(source,'init','--mode=archive-z2')
 commit=ostree(source,'commit','--branch='+REF,'--subject=Artifact round-trip fixture','--tree=dir='+str(tree)).stdout.strip()
 archive=root/'files-only.zip'
 # Match upload-artifact: file entries only, no entries for empty directories.
 with zipfile.ZipFile(archive,'w') as zipped:
  for file in source.rglob('*'):
   if file.is_file():zipped.write(file,file.relative_to(source))
 restored=root/'restored'
 with zipfile.ZipFile(archive) as zipped:zipped.extractall(restored)
 before={str(p.relative_to(restored)):p.read_bytes() for p in restored.rglob('*') if p.is_file()}
 failure=ostree(restored,'fsck',check=False)
 assert failure.returncode and 'refs/remotes' in failure.stderr,failure.stderr
 restore_artifact_layout(restored)
 assert before=={str(p.relative_to(restored)):p.read_bytes() for p in restored.rglob('*') if p.is_file()}
 ostree(restored,'fsck')
 assert ostree(restored,'rev-parse',REF).stdout.strip()==commit
 assert ostree(restored,'cat',commit,'/payload.txt').stdout=='Verified application payload\n'
 print('VERIFIED: file-only artifact loses empty dirs; structural restoration preserves all bytes, commit and payload; full fsck passes')
 # A corrupt object must still fail. Restoring directories is no fsck bypass.
 (restored/'objects'/commit[:2]/(commit[2:]+'.commit')).write_bytes(b'corrupt commit object')
 restore_artifact_layout(restored)
 assert ostree(restored,'fsck',check=False).returncode,'Corrupt commit passed integrity checking'
 print('VERIFIED: corrupted OSTree object still fails full fsck after layout restoration')
