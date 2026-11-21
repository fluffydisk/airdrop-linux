#!/usr/bin/env python3
"""Linux read-only HCI connection inventory; stdout never contains peer identities.

HCIGETCONNLIST is the ordinary kernel read ioctl, not the exclusive HCI user
channel. No HCI command is sent, no connection is changed, and no root is needed
on the validated kernel. ABI: Linux x86_64/aarch64, hci.h hci_conn_info (16 bytes).
"""
import argparse
import errno
import fcntl
import json
from pathlib import Path
import re
import socket
import struct
import subprocess
import sys

LIMIT = 16
HEADER = struct.Struct('@HH')
ENTRY = struct.Struct('@H6sBBHI')
HCIGETCONNLIST = (2 << 30) | (4 << 16) | (ord('H') << 8) | 212


class ControllerSelectionError(ValueError):
    def __init__(self, category):
        self.category = category
        super().__init__(category)


def controller_index(index=None, entries=None):
    if index is not None:
        if not 0 <= index <= 255:
            raise ValueError('invalid controller index')
        return index
    if entries is None:
        entries = (p.name for p in Path('/sys/class/bluetooth').iterdir())
    # Connection children such as hci1:2 are not controller devices. Controller
    # numbering can change after removal/re-add; hci0 is not a stable identity.
    indexes = {int(name[3:]) for name in entries if re.fullmatch(r'hci\d+', name)}
    if len(indexes) != 1:
        raise ControllerSelectionError('ambiguous-adapter' if indexes else 'unavailable')
    return indexes.pop()


def decode_links(data, devices=()):
    if len(data) < HEADER.size or ENTRY.size != 16:
        raise ValueError('unsupported or truncated connection ABI')
    _, count = HEADER.unpack_from(data)
    if count > LIMIT or len(data) < HEADER.size + count * ENTRY.size:
        raise ValueError('invalid connection count or truncated inventory')
    names = {str(d.get('address', '')).lower(): str(d.get('name', '')) for d in devices}
    result = {'schema': 1, 'querySucceeded': True, 'atCapacity': count == LIMIT, 'connections': []}
    for i in range(count):
        _, address, kind, outgoing, state, mode = ENTRY.unpack_from(data, HEADER.size + i * ENTRY.size)
        address_text = ':'.join(f'{v:02x}' for v in address[::-1])
        name = names.get(address_text, '')
        result['connections'].append({
            's24NameMatch': 'S24' in name,
            'soundcoreNameMatch': 'soundcore' in name.lower(),
            'linkType': 'LE' if kind == 128 else 'BR/EDR' if kind == 1 else 'other',
            'role': 'central' if mode & 1 else 'peripheral',
            'locallyInitiated': bool(outgoing),
            'connected': state == 1,
        })
    return result


def inventory(index=None):
    if sys.platform != 'linux':
        raise ValueError('Linux required')
    index = controller_index(index)
    with socket.socket(getattr(socket, 'AF_BLUETOOTH', 31), socket.SOCK_RAW | socket.SOCK_CLOEXEC, 1) as sock:
        data = bytearray(HEADER.pack(index, LIMIT) + bytes(LIMIT * ENTRY.size))
        fcntl.ioctl(sock.fileno(), HCIGETCONNLIST, data, True)
    devices = []
    # Identity matching is optional. Keep all names and addresses only in memory.
    try:
        response = subprocess.run(['busctl', '--json=short', 'call', 'org.bluez', '/', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects'], capture_output=True, text=True, timeout=5, check=True)
        for interfaces in json.loads(response.stdout)['data'][0].values():
            props = interfaces.get('org.bluez.Device1', {})
            value = lambda key: props.get(key, {}).get('data')
            if value('Address'):
                devices.append({'address': value('Address'), 'name': value('Name') or value('Alias') or ''})
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        pass
    return decode_links(data, devices)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=int, help='Explicit controller index; otherwise require exactly one detected adapter')
    args = parser.parse_args()
    try:
        print(json.dumps(inventory(args.index), indent=2))
    except (OSError, ValueError) as exc:
        category = exc.category if isinstance(exc, ControllerSelectionError) else 'permission-denied' if isinstance(exc, OSError) and exc.errno in (errno.EPERM, errno.EACCES) else 'unavailable'
        print(json.dumps({'schema': 1, 'querySucceeded': False, 'failure': category}))
        raise SystemExit(1)
