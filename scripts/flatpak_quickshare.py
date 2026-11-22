"""Build the optional Quick Share helper for the signed upstream Flatpak."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

GRANTS = ('--allow=bluetooth', '--system-talk-name=org.bluez')
RESOURCE = 'lib/airdrop-linux/desktop/resources/quickshare/x64'
LICENSES = ('LICENSE', 'MODIFICATIONS.md', 'THIRD-PARTY-NOTICES.md')


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def add_quickshare(manifest, module, source, output, commit):
    # The host build uses the pinned toolchain and lockfile of the exact
    # selected application source. The sandbox assembles it offline.
    workspace = source / 'network/quickshare'
    payload = output / 'quickshare'
    payload.mkdir()
    executable = payload / 'airdrop-quickshare'
    with tempfile.TemporaryDirectory(prefix='airdrop-flatpak-cargo-') as target:
        subprocess.run(['cargo', 'build', '--locked', '--features', 'ble-native',
                        '--bin', 'airdrop-quickshare', '--target-dir', target],
                       cwd=workspace, check=True)
        shutil.copyfile(Path(target) / 'debug/airdrop-quickshare', executable)
    subprocess.run(['strip', '--strip-unneeded', executable], check=True)
    receipt = {
        'schema': 1, 'arch': 'x64', 'desktopDefault': True,
        'applicationCommit': commit, 'sha256': sha256(executable),
        'lockSha256': sha256(workspace / 'Cargo.lock'),
        'capabilities': {'lan': True, 'ble': True, 'classicReceive': True},
    }
    (payload / 'helper.json').write_text(json.dumps(receipt, indent=2) + '\n')
    for name in ('airdrop-quickshare', 'helper.json'):
        module['sources'].append({'type': 'file', 'path': 'quickshare/' + name,
                                  'sha256': sha256(payload / name), 'dest': 'quickshare-input'})
    module['build-commands'] += [
        f'install -Dm755 quickshare-input/airdrop-quickshare /app/{RESOURCE}/airdrop-quickshare',
        f'install -Dm644 quickshare-input/helper.json /app/{RESOURCE}/helper.json',
        'install -Dm644 -t /app/share/licenses/$FLATPAK_ID/quickshare ' +
        ' '.join('network/quickshare/' + name for name in LICENSES),
        'cp -R network/quickshare/licenses /app/share/licenses/$FLATPAK_ID/quickshare/',
    ]
    manifest['finish-args'].extend(GRANTS)


def audit_quickshare(files, finish_args, app_id):
    grants = set(finish_args).intersection(GRANTS)
    helper_root = files / RESOURCE
    if not grants:
        assert not helper_root.exists(), 'Quick Share helper is missing required grants'
        return
    assert grants == set(GRANTS), 'Incomplete Quick Share Bluetooth grants'
    executable = helper_root / 'airdrop-quickshare'
    receipt = json.loads((helper_root / 'helper.json').read_text())
    marker = json.loads((files / 'share/airdrop-linux/distribution.json').read_text())
    assert receipt['desktopDefault'] is True and receipt['arch'] == 'x64'
    assert receipt['applicationCommit'] == marker['source_commit']
    assert receipt['capabilities']['classicReceive'] is True
    assert executable.stat().st_mode & 0o111 and sha256(executable) == receipt['sha256']
    for name in LICENSES:
        assert (files / 'share/licenses' / app_id / 'quickshare' / name).is_file()
