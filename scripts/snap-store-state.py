#!/usr/bin/env python3
"""Read the official publisher API with the existing scoped Store credential."""
import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='snap-store-state.json')
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


if __name__ == '__main__':
    main()
