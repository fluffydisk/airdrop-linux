#!/usr/bin/env python3
"""Read the official publisher API with the existing scoped Store credential."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def matching_revisions(state, artifact_root, version):
    """Match Store digests to the exact producer files, never revision numbers alone."""
    selected = []
    for arch, artifact_arch in [('amd64', 'x64'), ('arm64', 'arm64')]:
        files = list((Path(artifact_root) / f'validated-snap-{artifact_arch}').glob('*.snap'))
        if len(files) != 1:
            raise ValueError(f'Expected one tested artifact for {arch}')
        sha3, sha256 = hashlib.sha3_384(), hashlib.sha256()
        with files[0].open('rb') as source:
            while chunk := source.read(1024 * 1024):
                sha3.update(chunk)
                sha256.update(chunk)
        matches = [r for r in state['revisions']
                   if r.get('sha3-384') == sha3.hexdigest()
                   and r.get('size') == files[0].stat().st_size
                   and r.get('architectures') == [arch]
                   and r.get('version') == version
                   and r.get('base') == 'core24'
                   and r.get('confinement') == 'strict'
                   and r.get('grade') == 'stable']
        if not matches:
            raise ValueError(f'No matching strict Store revision for tested {arch} artifact')
        # Prefer an approved existing revision; never upload a duplicate.
        matches.sort(key=lambda r: (r.get('status') != 'Published', int(r['revision'])))
        revision = matches[0]
        selected.append({'arch': arch, 'version': version, 'revision': str(revision['revision']),
                         'status': revision['status'], 'sha256': sha256.hexdigest(),
                         'sha3_384': sha3.hexdigest()})
    return selected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='snap-store-state.json')
    parser.add_argument('--artifacts')
    parser.add_argument('--version')
    parser.add_argument('--release-candidate', action='store_true')
    args = parser.parse_args()
    if not os.environ.get('SNAPCRAFT_STORE_CREDENTIALS'):
        raise SystemExit('SNAPCRAFT_STORE_CREDENTIALS is not configured')

    import craft_store

    client = craft_store.UbuntuOneStoreClient(
        base_url='https://dashboard.snapcraft.io',
        storage_base_url='https://storage.snapcraftcontent.com',
        auth_url='https://login.ubuntu.com',
        application_name='snapcraft',
        user_agent='airdrop-linux-publication/1.5.0',
        endpoints=craft_store.endpoints.U1_SNAP_STORE,
        environment_auth='SNAPCRAFT_STORE_CREDENTIALS',
        ephemeral=False,
    )
    try:
        response = client.request(
            'GET', 'https://dashboard.snapcraft.io/api/v2/snaps/airdrop-linux/releases',
            headers={'Accept': 'application/json'},
        )
        payload = response.json()
    except Exception as error:
        # Never serialize authentication objects, request headers or credentials.
        raise SystemExit(f'Store revision query failed ({type(error).__name__})') from None

    revision_fields = ('revision', 'architectures', 'version', 'status', 'base',
                       'confinement', 'grade', 'sha3-384', 'size')
    release_fields = ('revision', 'architecture', 'channel', 'track', 'risk')
    state = {
        'name': 'airdrop-linux',
        'revisions': [{k: r[k] for k in revision_fields if k in r}
                      for r in payload['revisions']],
        'releases': [{k: r[k] for k in release_fields if k in r}
                     for r in payload.get('releases', [])],
    }
    encoded = json.dumps(state, indent=2) + '\n'
    Path(args.output).write_text(encoded)
    print(encoded, end='')
    if args.release_candidate and not args.artifacts:
        raise SystemExit('Candidate release requires exact tested artifacts')
    if args.artifacts:
        if not args.version:
            raise SystemExit('Artifact matching requires the expected release version')
        try:
            selected = matching_revisions(state, args.artifacts, args.version)
        except ValueError as error:
            raise SystemExit(str(error)) from None
        Path('snap-matched-revisions.json').write_text(json.dumps(selected, indent=2) + '\n')
        print(json.dumps({'matched_revisions': selected}, indent=2))
        if args.release_candidate:
            blocked = [r for r in selected if r['status'] != 'Published']
            if blocked:
                for r in blocked:
                    print(f"BLOCKED: {r['arch']} revision {r['revision']}: {r['status']}")
                raise SystemExit('Store review has not approved both revisions; no release attempted')
            for r in selected:
                try:
                    client.request('POST', 'https://dashboard.snapcraft.io/dev/api/snap-release/',
                                   json={'name': 'airdrop-linux', 'revision': r['revision'],
                                         'channels': ['latest/candidate']})
                except Exception as error:
                    raise SystemExit(f"Candidate release rejected ({type(error).__name__})") from None
            print('Both exact tested revisions released to latest/candidate; Store installation tests must still pass.')


if __name__ == '__main__':
    main()
