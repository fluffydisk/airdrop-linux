"""Real isolated D-Bus protocol tests. No host system bus or Tailscale calls."""
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib
sys.path.insert(0, str(Path(__file__).parent.parent / 'system'))
from bridge import Bridge, INTERFACE, NAME, PATH


class FakeOperations:
    installed = False
    service = False
    connected = False
    sharing = False
    peers = False

    def status(self, uid=None):
        return {'protocol': 1, 'installed': self.installed, 'service': self.service, 'BackendState': 'Running' if self.connected else 'NeedsLogin', 'TailscaleIPs': ['100.64.0.1'] if self.connected else [], 'Self': {'ID': 'self', 'DNSName': 'pc.test.ts.net.', 'Online': True}, 'sharing': self.sharing, 'Peer': {'phone': {'ID': 'phone', 'HostName': 'Phone', 'Online': True}} if self.peers else {}}

    def perform(self, action, uid, progress):
        if action == 'install':
            self.installed = True
        elif action == 'start':
            self.service = True
        elif action == 'share':
            self.sharing = True
        elif action == 'connect':
            progress('Sign in', auth_url='https://login.tailscale.com/a/test')
            time.sleep(.8)
            self.connected = True


class Authority(dbus.service.Object):
    allowed = True

    def __init__(self, bus):
        super().__init__(dbus.service.BusName('org.freedesktop.PolicyKit1', bus), '/org/freedesktop/PolicyKit1/Authority')

    @dbus.service.method('org.freedesktop.PolicyKit1.Authority', in_signature='(sa{sv})sa{ss}us', out_signature='(bba{ss})')
    def CheckAuthorization(self, subject, action, details, flags, cancellation):
        if subject[0] != 'system-bus-name' or not str(subject[1]['name']).startswith(':'):
            return (False, False, {})
        return (self.allowed, False, {})


class TestBridge(Bridge):

    @dbus.service.method(INTERFACE, in_signature='b', out_signature='')
    def SetAllowed(self, value):
        authority.allowed = bool(value)

    @dbus.service.method(INTERFACE, in_signature='b', out_signature='')
    def SetOnlinePeers(self, value):
        self.operations.peers = bool(value)


if '--serve' in sys.argv:
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus(private=True)
    authority = Authority(bus)
    service = TestBridge(bus)
    service.operations = FakeOperations()
    print('ready', flush=True)
    GLib.MainLoop().run()
    sys.exit()


class ProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = subprocess.Popen([sys.executable, __file__, '--serve'], stdout=subprocess.PIPE, text=True)
        if cls.server.stdout.readline().strip() != 'ready':
            raise RuntimeError('Test service failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate(); cls.server.wait(timeout=5)

    def setUp(self):
        self.bus = dbus.SessionBus(private=True)
        self.client = dbus.Interface(self.bus.get_object(NAME, PATH), INTERFACE)
        self.client.SetAllowed(True)

    def tearDown(self):
        self.bus.close()

    def test_status_protocol(self):
        self.assertEqual(json.loads(self.client.Status())['protocol'], 1)

    def test_unknown_action_and_permission_denial(self):
        with self.assertRaises(dbus.exceptions.DBusException):
            self.client.Run('shell')
        self.client.SetAllowed(False)
        with self.assertRaises(dbus.exceptions.DBusException):
            self.client.Run('install')
        with self.assertRaises(dbus.exceptions.DBusException):
            self.client.Status()

    def test_jobs_and_auth_links_are_bound_to_exact_bus_connection(self):
        job = self.client.Run('connect')
        other = dbus.SessionBus(private=True)
        try:
            stranger = dbus.Interface(other.get_object(NAME, PATH), INTERFACE)
            with self.assertRaises(dbus.exceptions.DBusException):
                stranger.GetJob(job)
        finally:
            other.close()
        saw_url = False
        for _ in range(50):
            value = json.loads(self.client.GetJob(job))
            saw_url |= bool(value.get('auth_url'))
            if value['state'] == 'complete':
                break
            time.sleep(.02)
        self.assertTrue(saw_url)
        self.assertEqual(value['state'], 'complete')
        self.assertFalse(value.get('auth_url'))


unittest.main()
