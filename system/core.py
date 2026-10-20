"""Fixed system operations. No caller-supplied commands, paths, URLs or flags."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import shlex
import shutil
import subprocess
import tempfile
import urllib.request

KEY_FINGERPRINT = '2596A99EAAB33821893C0A79458CA832957F5868'
ACTIONS = {'install', 'start', 'connect', 'share', 'migrate', 'restore-migration'}


def run(args, timeout=30, check=True):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'DEBIAN_FRONTEND': 'noninteractive'})
    if check and result.returncode:
        # Authentication links and private state must not enter system logs.
        raise RuntimeError(f'{Path(args[0]).name} failed (exit {result.returncode}). Check your connection or package-manager status and retry.')
    return result


def distro(values):
    distro_id = values.get('ID')
    code = values.get('VERSION_CODENAME', '')
    if distro_id == 'linuxmint':
        ubuntu = values.get('UBUNTU_CODENAME')
        if ubuntu:
            distro_id, code = 'ubuntu', ubuntu
        elif values.get('VERSION_ID', '').split('.')[0] == '7':
            distro_id, code = 'debian', 'trixie'
    if (distro_id == 'debian' and code in {'bookworm', 'trixie'}) or (distro_id == 'ubuntu' and code in {'jammy', 'noble', 'resolute'}):
        return distro_id, code
    if distro_id in {'arch', 'omarchy', 'manjaro', 'endeavouros'}:
        return 'arch', ''
    raise RuntimeError('This distribution is not supported by automatic Tailscale setup.')


def read_os_release():
    result = {}
    for line in Path('/etc/os-release').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            parts = shlex.split(value)
            result[key] = parts[0] if parts else ''
    return result


def sharing_url_conflict(config):
    """Only inspect routes on the HTTPS port we intend to configure."""
    for host, web in config.get('Web', {}).items():
        if host.endswith(':443'):
            handlers = web.get('Handlers', {})
            for route, handler in handlers.items():
                if route == '/push' or route.startswith('/push/') or route == '/ui' or route.startswith('/ui/'):
                    if handler != {'Proxy': 'http://127.0.0.1:6001' + route}:
                        return True
            root = handlers.get('/')
            if root and root != {'Proxy': 'http://127.0.0.1:6001'}:
                return True
    tcp = config.get('TCP', {}).get('443', {})
    return bool(tcp and tcp != {'HTTPS': True})


class Operations:
    def __init__(self, command=run):
        self.command = command

    def status(self, uid=None):
        result = {'protocol': 1, 'installed': bool(shutil.which('tailscale')), 'service': False}
        if not result['installed']:
            return result
        result['service'] = self.command(['/usr/bin/systemctl', 'is-active', '--quiet', 'tailscaled.service'], check=False).returncode == 0
        if not result['service']:
            return result
        status = self.command(['/usr/bin/tailscale', 'status', '--json'], check=False, timeout=5)
        try:
            raw = json.loads(status.stdout)
            for key in ['BackendState', 'TailscaleIPs', 'Self', 'Peer']:
                if key in raw:
                    result[key] = raw[key]
        except (ValueError, TypeError):
            result['BackendState'] = 'Unavailable'
        served = self.command(['/usr/bin/tailscale', 'serve', 'status', '--json'], check=False, timeout=5)
        try:
            config = json.loads(served.stdout or '{}')
            result['sharing'] = any(web.get('Handlers', {}).get('/') == {'Proxy': 'http://127.0.0.1:6001'} for host, web in config.get('Web', {}).items() if host.endswith(':443'))
            result['conflict'] = sharing_url_conflict(config)
        except (ValueError, TypeError):
            result['sharing'] = False
        # Do not return private keys, authentication URLs, user accounts or full peer metadata.
        result['Self'] = {key: (result.get('Self') or {}).get(key) for key in ['ID', 'DNSName', 'Online']}
        result['Peer'] = {key: {field: peer.get(field) for field in ['ID', 'HostName', 'DNSName', 'Online']} for key, peer in (result.get('Peer') or {}).items()}
        owner_file = Path('/var/lib/airdrop-system/sharing-owner')
        result['otherOwner'] = uid is not None and owner_file.exists() and owner_file.read_text().strip() != str(uid)
        return result

    def install(self, progress):
        family, code = distro(read_os_release())
        if shutil.which('tailscale'):
            return
        progress('Installing Tailscale from its signed package source…')
        if family == 'arch':
            self.command(['/usr/bin/pacman', '-S', '--needed', '--noconfirm', 'tailscale'], timeout=900)
            return
        base = f'https://pkgs.tailscale.com/stable/{family}/{code}'
        with urllib.request.urlopen(base + '.noarmor.gpg', timeout=30) as response:
            key = response.read(1024 * 1024 + 1)
        if len(key) > 1024 * 1024:
            raise RuntimeError('Tailscale signing key is too large')
        with tempfile.TemporaryDirectory(prefix='airdrop-key-') as work:
            keyfile = Path(work, 'key.gpg')
            keyfile.write_bytes(key)
            fingerprints = self.command(['/usr/bin/gpg', '--batch', '--homedir', work, '--show-keys', '--with-colons', str(keyfile)]).stdout
            primaries = []
            waiting = False
            for line in fingerprints.splitlines():
                if line.startswith('pub:'):
                    waiting = True
                elif line.startswith('fpr:') and waiting:
                    primaries.append(line.split(':')[9]); waiting = False
            if primaries != [KEY_FINGERPRINT]:
                raise RuntimeError('Tailscale signing key changed. Update Airdrop before installing.')
        keypath = Path('/usr/share/keyrings/airdrop-tailscale.gpg')
        source = Path('/etc/apt/sources.list.d/airdrop-tailscale.list')
        # Existing vendor sources are reused, without adding duplicate Signed-By entries.
        existing = []
        for directory in [Path('/etc/apt/sources.list'), *Path('/etc/apt/sources.list.d').glob('*')]:
            if directory.is_file() and directory != source and directory.suffix in {'.list', '.sources', ''}:
                if 'pkgs.tailscale.com' in directory.read_text(errors='replace'):
                    existing.append(directory)
        if not existing:
            keypath.write_bytes(key); keypath.chmod(0o644)
            source.write_text(f'deb [signed-by={keypath}] https://pkgs.tailscale.com/stable/{family} {code} main\n')
            source.chmod(0o644)
        self.command(['/usr/bin/apt-get', 'update'], timeout=900)
        self.command(['/usr/bin/apt-get', 'install', '-y', '--no-install-recommends', 'tailscale'], timeout=900)

    def connect(self, progress):
        proc = subprocess.Popen(['/usr/bin/tailscale', 'up', '--json', '--timeout=180s'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
        try:
            pending = ""
            for line in proc.stdout:
                pending += line
                if len(pending) > 1024 * 1024:
                    raise RuntimeError("Unexpected Tailscale response")
                try:
                    value = json.loads(pending)
                except ValueError:
                    continue
                pending = ""
                if value.get('AuthURL'):
                    url = value['AuthURL']
                    if not url.startswith('https://login.tailscale.com/'):
                        raise RuntimeError('Unexpected Tailscale authentication address')
                    progress('Complete sign-in in your browser.', auth_url=url)
                if value.get('Error'):
                    raise RuntimeError('Tailscale could not connect. Check your network and existing Tailscale settings.')
            if proc.wait(timeout=10):
                raise RuntimeError('Tailscale sign-in did not finish. Retry or approve the device in your Tailscale account.')
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()

    def share(self, uid, progress):
        state = self.status(uid)
        if state.get('BackendState') != 'Running':
            raise RuntimeError('Connect to Tailscale first.')
        served = self.command(['/usr/bin/tailscale', 'serve', 'status', '--json'])
        if sharing_url_conflict(json.loads(served.stdout or '{}')):
            raise RuntimeError('Another application already uses the Tailscale HTTPS address. Its configuration was kept; free that address before retrying.')
        owner_file = Path('/var/lib/airdrop-system/sharing-owner')
        if owner_file.exists() and owner_file.read_text().strip() != str(uid):
            raise RuntimeError('Private sharing belongs to another local user. Ask that user to disable their sharing first.')
        # Never reset Serve or change unrelated routes, account settings, DNS or exit nodes.
        served = self.command(['/usr/bin/tailscale', 'serve', '--bg', '--yes', '--https=443', '--set-path=/', 'http://127.0.0.1:6001'], timeout=60, check=False)
        if served.returncode:
            import re
            link = re.search(r'https://login\.tailscale\.com/[^\s]+', served.stdout)
            if link:
                progress('Enable HTTPS sharing in your Tailscale account, then retry this step.', auth_url=link.group(0))
                raise RuntimeError('Tailscale requires account approval for HTTPS sharing. Complete the browser step and retry.')
            raise RuntimeError('Private sharing could not be enabled. Check the Tailscale account and connection, then retry.')
        owner_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        owner_file.write_text(str(uid)); owner_file.chmod(0o600)

    def migrate(self, uid, restore=False):
        user = pwd.getpwuid(uid)
        backup = Path('/var/lib/airdrop-system/legacy-units', str(uid))
        units = []
        for name in ['airdrop-push.service', 'airdropshare.service']:
            target = Path('/etc/systemd/system', name)
            saved = backup / name
            if restore:
                if saved.is_file() and not target.exists():
                    shutil.copyfile(saved, target); target.chmod(0o644); units.append(name)
                continue
            if not target.exists():
                continue
            if target.is_symlink():
                raise RuntimeError('Legacy service is linked; migrate it manually.')
            content = target.read_text()
            lines = content.splitlines()
            if f'User={user.pw_name}' not in lines or f'{user.pw_dir}/.local/share/airdrop' not in content:
                raise RuntimeError('Existing Airdrop service belongs to another installation. It was not changed.')
            units.append(name)
        if restore:
            self.command(['/usr/bin/systemctl', 'daemon-reload'])
            if units:
                self.command(['/usr/bin/systemctl', 'enable', '--now', *units])
            return
        if units:
            self.command(['/usr/bin/systemctl', 'disable', '--now', *units])
            backup.mkdir(mode=0o700, parents=True, exist_ok=True)
            for name in units:
                target = Path('/etc/systemd/system', name)
                shutil.copyfile(target, backup / name); target.unlink()
            self.command(['/usr/bin/systemctl', 'daemon-reload'])

    def perform(self, action, uid, progress):
        if action not in ACTIONS:
            raise ValueError('Unknown system action')
        if action == 'install':
            return self.install(progress)
        if action == 'start':
            return self.command(['/usr/bin/systemctl', 'enable', '--now', 'tailscaled.service'])
        if action == 'connect':
            return self.connect(progress)
        if action == 'share':
            return self.share(uid, progress)
        if action in {'migrate', 'restore-migration'}:
            return self.migrate(uid, restore=action == 'restore-migration')
