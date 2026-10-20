import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('airdrop_system_core', Path(__file__).parent.parent / 'system/core.py')
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class CoreTests(unittest.TestCase):
    def test_distribution_mapping(self):
        for item, expected in [({'ID': 'debian', 'VERSION_CODENAME': 'bookworm'}, ('debian', 'bookworm')),
                               ({'ID': 'ubuntu', 'VERSION_CODENAME': 'resolute'}, ('ubuntu', 'resolute')),
                               ({'ID': 'linuxmint', 'UBUNTU_CODENAME': 'noble'}, ('ubuntu', 'noble')),
                               ({'ID': 'linuxmint', 'VERSION_ID': '7', 'VERSION_CODENAME': 'gigi'}, ('debian', 'trixie')),
                               ({'ID': 'omarchy'}, ('arch', ''))]:
            self.assertEqual(core.distro(item), expected)
        for item in [{'ID': 'ubuntu', 'VERSION_CODENAME': '../../evil'}, {'ID': 'debian', 'VERSION_CODENAME': 'sid'}, {'ID': 'unknown'}]:
            with self.assertRaises(RuntimeError):
                core.distro(item)

    def test_routes_are_not_reset_or_overwritten(self):
        self.assertFalse(core.sharing_url_conflict({}))
        self.assertFalse(core.sharing_url_conflict({'Web': {'pc.ts.net:443': {'Handlers': {'/other': {'Proxy': 'http://localhost:8000'}}}}}))
        self.assertFalse(core.sharing_url_conflict({'TCP': {'443': {'HTTPS': True}}, 'Web': {'pc.ts.net:443': {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:6001'}}}}}))
        self.assertTrue(core.sharing_url_conflict({'Web': {'pc.ts.net:443': {'Handlers': {'/': {'Proxy': 'http://localhost:8000'}}}}}))
        self.assertTrue(core.sharing_url_conflict({'TCP': {'443': {'TCPForward': 'other:443'}}}))
        self.assertFalse(core.sharing_url_conflict({'Web': {'pc.ts.net:8443': {'Handlers': {'/': {'Proxy': 'http://localhost:8000'}}}}}))

    def test_unknown_actions_never_execute(self):
        commands = []
        operations = core.Operations(lambda *args, **kwargs: commands.append(args))
        for action in ['shell', 'install;id', '../start', 'reset', 'logout']:
            with self.assertRaises(ValueError):
                operations.perform(action, 1000, lambda *args: None)
        self.assertEqual(commands, [])

    def test_status_does_not_disclose_authentication_or_identity_details(self):
        raw = {'BackendState': 'Running', 'TailscaleIPs': ['100.64.0.1'], 'AuthURL': 'SECRET', 'User': {'PRIVATE': 'PRIVATE'}, 'Self': {'ID': 'self', 'DNSName': 'pc.test.ts.net.', 'Online': True, 'PublicKey': 'secret'}, 'Peer': {'phone': {'ID': 'phone', 'Online': True, 'HostName': 'Phone', 'PublicKey': 'secret'}}}
        def command(args, **kwargs):
            return SimpleNamespace(returncode=0, stdout=json.dumps(raw) if 'status' in args and 'serve' not in args else '{}')
        with patch.object(core.shutil, 'which', return_value='/usr/bin/tailscale'):
            status = core.Operations(command).status()
        self.assertNotIn('SECRET', json.dumps(status)); self.assertNotIn('PublicKey', json.dumps(status)); self.assertNotIn('User', status)
        self.assertEqual(status['BackendState'], 'Running')

    def test_pretty_printed_login_json_is_streamed_to_the_owner(self):
        proc = SimpleNamespace(stdout=io.StringIO('{\n "BackendState": "NeedsLogin",\n "AuthURL": "https://login.tailscale.com/a/test"\n}\n{\n"BackendState":"Running"\n}\n'), wait=lambda **kwargs: 0, poll=lambda: 0)
        progress = []
        with patch.object(core.subprocess, 'Popen', return_value=proc):
            core.Operations().connect(lambda message, **extra: progress.append((message, extra)))
        self.assertEqual(progress[0][1]['auth_url'], 'https://login.tailscale.com/a/test')

    def test_changed_vendor_key_is_rejected_before_system_writes(self):
        commands = []
        def command(args, **kwargs):
            commands.append(args)
            return SimpleNamespace(stdout='pub:::::::::\nfpr:::::::::WRONG:\n', returncode=0)
        with patch.object(core, 'read_os_release', return_value={'ID': 'ubuntu', 'VERSION_CODENAME': 'noble'}), patch.object(core.shutil, 'which', return_value=None), patch.object(core.urllib.request, 'urlopen') as request:
            request.return_value.__enter__.return_value.read.return_value = b'fake-key'
            with self.assertRaisesRegex(RuntimeError, 'signing key changed'):
                core.Operations(command).install(lambda *args: None)
        self.assertEqual(len(commands), 1)
        self.assertEqual(Path(commands[0][0]).name, 'gpg')


if __name__ == '__main__':
    unittest.main()
