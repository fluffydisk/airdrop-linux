#!/usr/bin/env python3
"""Audit this application's declared grants and actual built ELF/license payload."""
import argparse
import base64
import hashlib
import json
import struct
from pathlib import Path
import xml.etree.ElementTree as ET
from flatpak_reference_inputs import inspect_manifest

APP = 'io.github.fluffydisk.airdrop-linux'
ALLOWED = {'--share=ipc','--share=network','--socket=wayland','--socket=fallback-x11',
           '--device=dri','--talk-name=org.kde.StatusNotifierWatcher','--env=GTK_USE_PORTAL=1'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--build-dir',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args = parser.parse_args()
    data, inputs = inspect_manifest(args.manifest)
    assert data['app-id'] == APP
    assert set(data['finish-args']) <= ALLOWED, 'Unreviewed sandbox permission'
    assert data['runtime-version'] == data['base-version'], 'Runtime/BaseApp mismatch'
    files = args.build_dir/'files'
    meta = ET.parse(files/f'share/metainfo/{APP}.metainfo.xml').getroot()
    assert meta.findtext('id') == APP and meta.findtext('launchable') == APP+'.desktop'
    assert meta.findtext('metadata_license') == 'CC0-1.0' and meta.findtext('project_license') == 'MIT'
    assert (files/f'share/applications/{APP}.desktop').is_file()
    assert (files/f'share/icons/hicolor/512x512/apps/{APP}.png').is_file()
    image = (files/f'share/icons/hicolor/512x512/apps/{APP}.png').read_bytes()
    assert image[:8] == b'\x89PNG\r\n\x1a\n'
    width,height = struct.unpack('>II',image[16:24])
    icon = {'width':width,'height':height,'sha256':hashlib.sha256(image).hexdigest()}
    assert icon['width'] == icon['height'] == 512
    binaries, licenses, npm = [], [], []
    for file in sorted(files.rglob('*')):
        if file.is_symlink() or not file.is_file():
            continue
        name = file.relative_to(files).as_posix()
        with file.open('rb') as stream:
            header = stream.read(20)
        if header[:4] == b'\x7fELF':
            machine = int.from_bytes(header[18:20], 'little')
            assert machine == 62, f'Non-x86_64 ELF: {name}'
            binaries.append({'path':name,'ELF_machine':machine,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
        if name.startswith('share/licenses/'+APP+'/'):
            licenses.append({'path':name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    for component,relative in [('server','lib/airdrop-linux/server'),('desktop','lib/airdrop-linux/desktop/resources/app')]:
        lock = json.loads((files/relative/'package-lock.json').read_text())
        for name,pkg in lock['packages'].items():
            if name and not pkg.get('dev'):
                if pkg.get('integrity'):
                    algorithm,encoded=pkg['integrity'].split('-',1)
                    digest=base64.b64decode(encoded).hex()
                    assert any(source.get(algorithm)==digest for source in inputs['sources']), 'Offline source missing for '+name
                npm.append({'component':component,'package_path':name,'version':pkg.get('version'),'integrity':pkg.get('integrity'),'resolved':pkg.get('resolved')})
    for required in ['node','dufs','electron']:
        assert any('/'+required+'/' in entry['path'] for entry in licenses), 'Missing '+required+' licenses'
    assert not list((files/'lib/airdrop-linux').rglob('chrome-sandbox')), 'Unused setuid helper must not ship'
    assert not list((files/'lib/airdrop-linux/server/node_modules').rglob('*.node')), 'Unexpected native server addon'
    report = {'status':'VERIFIED','scope':'x86_64 package structure/grants/inventory; not Flathub inclusion approval',
              'finish_args':data['finish-args'],'runtime':data['runtime'],'runtime_version':data['runtime-version'],
              'base':data['base'],'base_version':data['base-version'],'sdk_extensions':data['sdk-extensions'],
              'only_arches':inputs['only_arches'],'declared_source_count':inputs['expanded_sources'],'installed_icon':icon,
              'ELF_files':binaries,'licenses':licenses,'production_npm':npm,
              'component_origins':{'application':'pinned source archive plus reviewed patches','dufs':'offline locked Cargo compilation',
                  'portal_helper':'C compiled in the SDK','node':'signed Node 24 SDK extension','electron':'official prebuilt archive; source-build requirement unresolved'},
              'human_review':['Host-dependent inclusion','Trademark/name/icon rights','Complete Electron source-build or explicitly granted exception'],
              'sources':['https://docs.flathub.org/docs/for-app-authors/requirements','https://docs.flatpak.org/en/latest/sandbox-permissions.html']}
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(f'Package audit passed: {len(binaries)} ELF files, {len(licenses)} license files, {len(npm)} production npm entries')


if __name__ == '__main__':
    main()
