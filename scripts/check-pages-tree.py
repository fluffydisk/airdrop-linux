#!/usr/bin/env python3
"""Reject broken/oversized Pages snapshots before atomic artifact deployment."""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('public',type=Path);a=p.parse_args()
root=a.public
required=['apt/dists/stable/InRelease','rpm/x86_64/repodata/repomd.xml.asc','rpm/aarch64/repodata/repomd.xml.asc','airdrop-linux.gpg','flatpak/config','flatpak/summary','flatpak/summary.sig','airdrop-linux.flatpakrepo','airdrop-linux.flatpakref']
assert all((root/name).is_file() for name in required),'Incomplete combined native/Flatpak snapshot'
assert not any(p.is_symlink() for p in root.rglob('*')),'Pages artifact must not contain symlinks'
sizes={name:sum(p.stat().st_size for p in (root/name).rglob('*') if p.is_file()) for name in ['apt','rpm','flatpak']}
total=sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
print(json.dumps({'bytes':total,'components':sizes,'official_limit':'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits'}))
assert total<=1_000_000_000,'Combined Pages snapshot exceeds the documented 1 GB published-site limit'
