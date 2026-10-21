#!/usr/bin/env python3
"""Read-only audit of the deployed v1.5.0 repository and original release."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import xml.etree.ElementTree as ET

BASE = 'https://fluffydisk.github.io/airdrop-linux/'
FINGERPRINT = '6513D70958397F60D3787A0CB93F4FC1E97CF3AE'


def run(*args):
    return subprocess.check_output(args, text=True)


def main():
    with tempfile.TemporaryDirectory(prefix='airdrop-public-audit-') as directory:
        root = Path(directory)

        def fetch(relative):
            dest = root / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(BASE + relative, timeout=120) as response:
                dest.write_bytes(response.read())
            return dest

        key = fetch('airdrop-linux.gpg')
        fingerprint = next(line.split(':')[9] for line in run(
            'gpg', '--batch', '--with-colons', '--show-keys', str(key)
        ).splitlines() if line.startswith('fpr:'))
        assert fingerprint == FINGERPRINT, fingerprint
        print('Public signing fingerprint:', fingerprint, flush=True)
        release = json.loads(run('gh', 'api', 'repos/fluffydisk/airdrop-linux/releases/tags/v1.5.0'))
        assert not release['draft'] and not release['prerelease']
        assets = {asset['name']: asset for asset in release['assets']}
        with urllib.request.urlopen(assets['SHA256SUMS']['browser_download_url'], timeout=120) as response:
            sums = dict((name.lstrip('*'), digest) for digest, name in
                        (line.split() for line in response.read().decode().splitlines()))

        def verify_signature(signature, data=None):
            args = ['gpgv', '--keyring', str(key), str(signature)]
            if data:
                args.append(str(data))
            subprocess.run(args, check=True)

        apt_release = fetch('apt/dists/stable/Release')
        verify_signature(fetch('apt/dists/stable/InRelease'))
        verify_signature(fetch('apt/dists/stable/Release.gpg'), apt_release)
        records = {}
        active = False
        for line in apt_release.read_text().splitlines():
            if not line.startswith(' '):
                active = line == 'SHA256:'
            elif active:
                digest, size, name = line.split()
                records[name] = (digest, int(size))
        for arch in ('amd64', 'arm64'):
            relative = f'main/binary-{arch}/Packages'
            index = fetch('apt/dists/stable/' + relative)
            assert (hashlib.sha256(index.read_bytes()).hexdigest(), index.stat().st_size) == records[relative]
            stanzas = [dict(line.split(': ', 1) for line in stanza.splitlines() if ': ' in line)
                       for stanza in index.read_text().strip().split('\n\n')]
            package = next(p for p in stanzas if p['Package'] == 'airdrop-linux' and p['Version'] == '1.5.0-1')
            assert package['Architecture'] == arch
            payload = fetch('apt/' + package['Filename'])
            digest = hashlib.sha256(payload.read_bytes()).hexdigest()
            assert digest == package['SHA256'] == sums[payload.name] == assets[payload.name]['digest'].removeprefix('sha256:')
            print('Verified DEB:', arch, digest, flush=True)

        ns = {'r': 'http://linux.duke.edu/metadata/repo', 'p': 'http://linux.duke.edu/metadata/common'}
        rpmdb = root / 'rpmdb'
        rpmdb.mkdir()
        public_ascii = fetch('airdrop-linux.asc')
        subprocess.run(['rpmkeys', '--dbpath', str(rpmdb), '--import', str(public_ascii)], check=True)
        for arch in ('x86_64', 'aarch64'):
            metadata = fetch(f'rpm/{arch}/repodata/repomd.xml')
            verify_signature(fetch(f'rpm/{arch}/repodata/repomd.xml.asc'), metadata)
            primary = ET.parse(metadata).find("r:data[@type='primary']", ns)
            location = primary.find('r:location', ns).attrib['href']
            compressed = fetch(f'rpm/{arch}/' + location)
            assert primary.find('r:checksum', ns).attrib['type'] == 'sha256'
            assert hashlib.sha256(compressed.read_bytes()).hexdigest() == primary.find('r:checksum', ns).text
            document = ET.fromstring(gzip.decompress(compressed.read_bytes()))
            package = next(p for p in document.findall('p:package', ns)
                           if p.find('p:name', ns).text == 'airdrop-linux' and p.find('p:version', ns).attrib['ver'] == '1.5.0')
            assert package.find('p:arch', ns).text == arch
            payload = fetch(f'rpm/{arch}/' + package.find('p:location', ns).attrib['href'])
            checksum = package.find('p:checksum', ns)
            assert checksum.attrib['type'] == 'sha256'
            assert hashlib.sha256(payload.read_bytes()).hexdigest() == checksum.text
            subprocess.run(['rpmkeys', '--dbpath', str(rpmdb), '--checksig', str(payload)], check=True)
            # Signing changes the RPM header: compare the payload digest to the
            # checksum-verified original instead of expecting equal file hashes.
            original = root / ('original-' + payload.name)
            with urllib.request.urlopen(assets[payload.name]['browser_download_url'], timeout=120) as response:
                original.write_bytes(response.read())
            assert hashlib.sha256(original.read_bytes()).hexdigest() == sums[payload.name] == assets[payload.name]['digest'].removeprefix('sha256:')
            query = '%{PAYLOADDIGEST}'
            assert run('rpm', '-qp', '--qf', query, str(payload)) == run('rpm', '-qp', '--qf', query, str(original))
            print('Verified signed RPM and original payload:', arch, checksum.text, flush=True)
        print('Public APT/RPM metadata, all four packages and release provenance passed.', flush=True)


if __name__ == '__main__':
    main()
