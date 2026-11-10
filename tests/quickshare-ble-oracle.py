#!/usr/bin/env python3
"""Independent BLE wire fixture oracle; never imports the Rust implementation.

Public layouts: google/nearby@1bbe8ec, internal/weave/packet.cc and
connections/implementation/mediums/ble/{ble_advertisement_header,bloom_filter}.cc.
This does not exercise a radio or establish Android compatibility.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

MASK = (1 << 64) - 1

def rotate(n, shift):
    return ((n << shift) | (n >> (64 - shift))) & MASK

def mix(n):
    for shift, multiplier in [(33, 0xff51afd7ed558ccd), (33, 0xc4ceb9fe1a85ec53)]:
        n = ((n ^ (n >> shift)) * multiplier) & MASK
    return n ^ (n >> 33)

def murmur(data):
    # Independent Python implementation of public MurmurHash3 x64/128, seed 0.
    h1 = h2 = 0
    c1, c2 = 0x87c37b91114253d5, 0x4cf5ad432745937f
    length = len(data)
    while len(data) >= 16:
        k1, k2 = struct.unpack('<QQ', data[:16]); data = data[16:]
        h1 ^= (rotate(k1 * c1 & MASK, 31) * c2) & MASK
        h1 = ((rotate(h1, 27) + h2) * 5 + 0x52dce729) & MASK
        h2 ^= (rotate(k2 * c2 & MASK, 33) * c1) & MASK
        h2 = ((rotate(h2, 31) + h1) * 5 + 0x38495ab5) & MASK
    k1 = int.from_bytes(data[:8], 'little')
    k2 = int.from_bytes(data[8:], 'little')
    if len(data) > 8: h2 ^= rotate(k2 * c2 & MASK, 33) * c1 & MASK
    if data: h1 ^= rotate(k1 * c1 & MASK, 31) * c2 & MASK
    h1 ^= length; h2 ^= length
    h1 = (h1 + h2) & MASK; h2 = (h2 + h1) & MASK
    return (mix(h1) + mix(h2)) & MASK

def positions(service):
    low = murmur(service)
    a, b = struct.unpack('<ii', struct.pack('<Q', low))
    out = []
    for repetition in range(1, 6):
        n = (a + repetition * b) & 0xffffffff
        if n & 0x80000000: n = (~n) & 0xffffffff
        out.append(n % 80)
    return out

def fixtures():
    service = hashlib.sha256(b'NearbySharing').digest()[:3]
    assert service == bytes.fromhex('fc9f5e')
    identity = bytes(range(16))
    info = b'\x02' + identity + b'\x06Galaxy'
    inner = b'\x23' + service + b'S24A' + bytes([len(info)]) + info + bytes(8)
    full = b'\x48' + service + struct.pack('!I', len(inner)) + inner + b'\x12\x34\x00'
    bloom = bytearray(10)
    for element in (b'fixture', b'NearbySharing'):
        for pos in positions(element): bloom[pos // 8] |= 1 << (pos % 8)
    ad_hash = hashlib.sha256(hashlib.sha256(b'fixture').digest()[:4] + full).digest()[:4]
    header = b'\x41' + bloom + ad_hash
    message = service + b'\x00\x00\x00\x11' + bytes(range(17))
    packets = []
    for offset in range(0, len(message), 19):
        h = (((offset // 19 + 1) % 8) << 4) | (8 if offset == 0 else 0) | (4 if offset + 19 >= len(message) else 0)
        packets.append((bytes([h]) + message[offset:offset + 19]).hex())
    return dict(full=full.hex(), compact=header.hex(), bloomPositions=positions(b'NearbySharing'), packets=packets, nearbyFrame=(b'\x00\x00\x00\x11' + bytes(range(17))).hex())

if __name__ == '__main__':
    path = Path(__file__).with_name('fixtures') / 'quickshare-ble-wire.json'
    expected = fixtures()
    if '--write' in sys.argv: path.write_text(json.dumps(expected, indent=2) + '\n')
    else:
        assert json.loads(path.read_text()) == expected, 'BLE wire fixture changed'
        print('PASS independent BLE advertisement/Bloom/Weave fixtures (no radio evidence)')
