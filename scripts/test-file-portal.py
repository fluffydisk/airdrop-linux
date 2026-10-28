#!/usr/bin/env python3
"""Exercise the compiled helper over real D-Bus with a controlled portal service.

This verifies FD transport, request matching, rejection and transient file export.
It does not claim that a physical desktop's default file manager was opened.
Run under dbus-run-session, with the compiled helper as the first argument.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

helper = str(Path(sys.argv[1]).resolve())
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()
xml = '''<node><interface name="org.freedesktop.portal.OpenURI"><method name="OpenFile"><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method></interface><interface name="org.freedesktop.portal.Documents"><method name="GetMountPoint"><arg type="ay" direction="out"/></method><method name="Add"><arg type="h" direction="in"/><arg type="b" direction="in"/><arg type="b" direction="in"/><arg type="s" direction="out"/></method></interface></node>'''
seen = []
rejection = False
with tempfile.TemporaryDirectory(prefix='airdrop-file-portal-') as temp:
    root = Path(temp)
    folder = root/'shared folder ü'
    folder.mkdir()
    file = folder/'test ü.txt'
    file.write_text('original content')

    def method(connection, sender, object_path, interface, name, parameters, invocation):
        values = parameters.unpack()
        if name == 'GetMountPoint':
            invocation.return_value(GLib.Variant('(ay)', (list(os.fsencode(root)+b'\0'),)))
            return
        fds = invocation.get_message().get_unix_fd_list()
        index = values[1] if name == 'OpenFile' else values[0]
        fd = fds.get(index)
        try:
            seen.append((name, os.fstat(fd).st_ino))
            if name == 'Add':
                assert values[1:] == (True, False), 'Exports must be transient'
                assert os.read(fd, 1024) == b'original content'
                invocation.return_value(GLib.Variant('(s)', ('exported-document',)))
                return
            assert os.fstat(fd).st_ino == folder.stat().st_ino
        finally:
            os.close(fd)
        token = values[2]['handle_token']
        request = '/org/freedesktop/portal/desktop/request/'+sender[1:].replace('.', '_')+'/'+token
        invocation.return_value(GLib.Variant('(o)', (request,)))
        def reply():
            # A different request must not complete this helper.
            connection.emit_signal(sender, request+'wrong', 'org.freedesktop.portal.Request', 'Response', GLib.Variant('(ua{sv})', (0, {})))
            connection.emit_signal(sender, request, 'org.freedesktop.portal.Request', 'Response', GLib.Variant('(ua{sv})', (2 if rejection else 0, {})))
            return False
        GLib.timeout_add(50, reply)

    info = Gio.DBusNodeInfo.new_for_xml(xml)
    registrations = [bus.register_object('/org/freedesktop/portal/desktop', info.interfaces[0], method, None, None),
                     bus.register_object('/org/freedesktop/portal/documents', info.interfaces[1], method, None, None)]
    owners = [Gio.bus_own_name_on_connection(bus, name, Gio.BusNameOwnerFlags.NONE, None, None) for name in ['org.freedesktop.portal.Desktop','org.freedesktop.portal.Documents']]
    thread = threading.Thread(target=loop.run, daemon=True)
    thread.start()
    try:
        subprocess.run([helper,str(folder)], check=True, timeout=10)
        rejection = True
        rejected = subprocess.run([helper,str(folder)], capture_output=True, timeout=10)
        assert rejected.returncode != 0 and b'rejected' in rejected.stderr
        link = root/'linked-folder'
        link.symlink_to(folder)
        assert subprocess.run([helper,str(link)], capture_output=True).returncode != 0
        # The pathname is replaced after Electron's validation. The helper must
        # export the inherited original descriptor, never reopen the replacement.
        fd = os.open(file, os.O_RDONLY)
        old = folder/'original.txt'
        file.rename(old)
        file.write_text('replacement content')
        def inherit():
            os.dup2(fd,3)
        child = subprocess.Popen([helper,'--export',str(file)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 pass_fds=(fd,3) if fd != 3 else (3,), preexec_fn=inherit, text=True)
        exported = child.stdout.readline().strip()
        assert urllib.parse.unquote(exported).endswith('/exported-document/original.txt'), exported
        assert child.stdout.readline().strip() == 'ready'
        assert child.poll() is None, 'Export connection must survive until drag completion'
        child.communicate(timeout=10)
        assert child.returncode == 0
        os.close(fd)
        assert [name for name, _ in seen] == ['OpenFile','OpenFile','Add']
        print('PASS: real directory FD, matching directed response, denied response, nofollow, inherited original file FD, transient export, drag lifetime (controlled portal; no desktop/file-manager claim)')
    finally:
        loop.quit()
        thread.join(timeout=3)
        for owner in owners: Gio.bus_unown_name(owner)
        for registration in registrations: bus.unregister_object(registration)
