#!/usr/bin/env python3
"""Actual public signed install, controlled baseline, standard update and migration.

Run only on a disposable CI VM. The explicit --commit rollback below prepares
an old signed test baseline; it is never part of the user migration procedure.
"""
import importlib.util,json,os,subprocess,sys,urllib.request
from pathlib import Path
from flatpak_channel import APP,R2,run
spec=importlib.util.spec_from_file_location('signed_flatpak_tests',Path(__file__).with_name('test-signed-flatpak.py'));tests=importlib.util.module_from_spec(spec);sys.modules[spec.name]=tests;spec.loader.exec_module(tests)
installer=tests.installer
assert os.environ.get('AIRDROP_TEST_DISPOSABLE')=='1'
assert not installer.installations(),'Use a clean account; existing installation left untouched'
receipt=installer.install('user');before=tests.state('user',True)
print('VERIFIED: public HTTPS repository summary, commit and descriptor identity; fresh signed installation',flush=True)
# Deploy the real signed r2 ancestor to test a forward update from old code.
run('flatpak','update','--user','--noninteractive','--commit='+receipt['baseline_commit'],APP+'//stable')
assert run('flatpak','info','--user','--show-commit',APP,'stable',capture=True)==receipt['baseline_commit']
run('flatpak','update','--user','--noninteractive',APP+'//stable')
assert run('flatpak','info','--user','--show-commit',APP,'stable',capture=True)==receipt['commit']
assert tests.state('user')==before
print('VERIFIED: ordinary flatpak update advanced the actual public signed previous revision to the current payload; data/identity fixtures preserved',flush=True)
run('flatpak','uninstall','--user','--noninteractive',APP)
bundle=Path(os.environ['RUNNER_TEMP'])/'migration-r2.flatpak'
with urllib.request.urlopen('https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/airdrop-linux-1.5.0-x86_64-reference-r2.flatpak') as response:bundle.write_bytes(response.read())
import hashlib
assert hashlib.sha256(bundle.read_bytes()).hexdigest()=='9dcc5d18450eb1404ce1615ebf4cf55dac03eeb09958dc4c767353dfd0cfb9df'
run('flatpak','install','--user','--noninteractive',bundle)
installer.install()
assert tests.state('user')==before and len(installer.installations())==1
print('VERIFIED: original public r2 bundle migrated to signed origin without duplicate installation or data loss',flush=True)
