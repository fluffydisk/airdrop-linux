#!/usr/bin/python3
"""D-Bus system bridge v1: authorization and per-caller asynchronous jobs."""
import json
import threading
import time
import uuid
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib
from core import ACTIONS, Operations

NAME = 'io.github.fluffydisk.Airdrop.System'
INTERFACE = NAME + '1'
PATH = '/io/github/fluffydisk/Airdrop/System'


def deliver(callback, value):
    callback(value)
    return False


class Bridge(dbus.service.Object):
    def __init__(self, bus):
        self.bus = bus
        self.jobs = {}
        self.lock = threading.Lock()
        self.operations = Operations()
        self.active = None
        super().__init__(dbus.service.BusName(NAME, bus), PATH)

    def authorize(self, sender, action, interactive, reply, error):
        # D-Bus operations stay on the GLib thread. Polkit must be asynchronous
        # so its dialog can remain open without blocking status/job requests.
        try:
            uid = int(self.bus.get_unix_user(sender))
            if uid == 0:
                raise dbus.exceptions.DBusException('Run Airdrop as a desktop user.', name=INTERFACE + '.Denied')
            authority = dbus.Interface(self.bus.get_object('org.freedesktop.PolicyKit1', '/org/freedesktop/PolicyKit1/Authority', introspect=False), 'org.freedesktop.PolicyKit1.Authority')
            def authorized(result):
                if result[0]:
                    reply(uid)
                else:
                    error(dbus.exceptions.DBusException('Permission was denied or cancelled.', name=INTERFACE + '.Denied'))
            authority.CheckAuthorization(('system-bus-name', {'name': dbus.String(sender, variant_level=1)}),
                                         'io.github.fluffydisk.airdrop.' + action, {}, dbus.UInt32(1 if interactive else 0), '',
                                         signature='(sa{sv})sa{ss}us', reply_handler=authorized, error_handler=error, timeout=120)
        except Exception as exc:
            error(exc)

    @dbus.service.method(INTERFACE, in_signature='', out_signature='s', sender_keyword='sender', async_callbacks=('reply', 'error'))
    def Status(self, sender, reply, error):
        def authorized(uid):
            def worker():
                try:
                    value = json.dumps(self.operations.status(uid))
                    GLib.idle_add(deliver, reply, value)
                except Exception as exc:
                    GLib.idle_add(deliver, error, exc)
            threading.Thread(target=worker, daemon=True).start()
        self.authorize(sender, 'inspect', False, authorized, error)

    @dbus.service.method(INTERFACE, in_signature='s', out_signature='s', sender_keyword='sender', async_callbacks=('reply', 'error'))
    def Run(self, action, sender, reply, error):
        if action not in ACTIONS:
            error(dbus.exceptions.DBusException('Unknown system action', name=INTERFACE + '.InvalidAction')); return
        def authorized(uid):
            try:
                with self.lock:
                    if self.active:
                        raise RuntimeError('A system setup operation is already running.')
                    now = time.monotonic()
                    self.jobs = {key: job for key, job in self.jobs.items() if now - job['created'] < 1800}
                    if len(self.jobs) >= 64:
                        raise RuntimeError('Too many setup operations. Retry later.')
                    job_id = str(uuid.uuid4())
                    self.active = job_id
                    self.jobs[job_id] = {'uid': uid, 'sender': sender, 'created': now, 'state': 'running', 'message': 'Preparing…'}
                reply(job_id)
                def worker():
                    def progress(message, **extra):
                        with self.lock:
                            self.jobs[job_id].update(message=message, **extra)
                    try:
                        self.operations.perform(str(action), uid, progress)
                        with self.lock:
                            self.jobs[job_id].update(state='complete', message='Completed', auth_url='')
                    except Exception as exc:
                        with self.lock:
                            self.jobs[job_id].update(state='error', message=str(exc))
                    finally:
                        with self.lock:
                            self.active = None
                threading.Thread(target=worker, daemon=True).start()
            except Exception as exc:
                error(exc)
        self.authorize(sender, 'configure', True, authorized, error)

    @dbus.service.method(INTERFACE, in_signature='s', out_signature='s', sender_keyword='sender')
    def GetJob(self, job_id, sender):
        with self.lock:
            job = self.jobs.get(str(job_id))
            if not job or job['sender'] != sender:
                raise dbus.exceptions.DBusException('Job is not owned by this connection.', name=INTERFACE + '.Denied')
            return json.dumps({key: value for key, value in job.items() if key not in {'uid', 'sender', 'created'}})


if __name__ == '__main__':
    DBusGMainLoop(set_as_default=True)
    service = Bridge(dbus.SystemBus())
    GLib.MainLoop().run()
