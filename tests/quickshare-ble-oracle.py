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

def valid_legacy_fast(service, packet):
    # Independent grammar check for our explicitly supported subset, from the
    # two public Google encoders, not a call into the Rust implementation.
    if service != 0xfef3 or len(packet) not in (25, 26, 27) or packet[0] != 0x4a:
        return False
    size = packet[1]
    if size not in (23, 24) or len(packet) not in (size + 2, size + 4):
        return False
    body = packet[2:2 + size]
    if body[0] != 0x23 or not body[1:5].isalnum() or body[5] != 17:
        return False
    if body[6] >> 5 > 1 or body[6] & 1:
        return False
    return size == 23 or body[23] == 0

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
    # Legacy fast: Google mediums header + Connections v1/P2P-point-to-point
    # identity-only endpoint data. No service hash, name, MAC or PSM; UUID
    # FEF3 supplies the service binding. This synthetic fixture is not a capture.
    fast_info = bytes([0x12]) + identity
    fast_body = b'\x23S24A' + bytes([len(fast_info)]) + fast_info
    fast = b'\x4a' + bytes([len(fast_body)]) + fast_body + b'\x12\x34'
    assert len(fast)==27 and valid_legacy_fast(0xfef3, fast)
    rejected = []
    for label, position, value in [('medium-version',0,0x6a),('socket-version',0,0x46),('second-profile',0,0x4b),('data-length',1,255),('foreign-pcp',2,0x21),('endpoint-bytes',3,0),('info-size',7,18),('application-version',8,0xe2),('reserved-metadata',8,0x13)]:
        bad=bytearray(fast);bad[position]=value
        rejected.append(dict(case=label,service=0xfef3,bytes=bytes(bad).hex()))
    for label, packet, namespace in [('foreign-service',fast,0xfe2c),('truncated-body',fast[:24],0xfef3),('partial-token',fast[:-1],0xfef3),('unsupported-extras',fast+b'\x00',0xfef3)]:
        rejected.append(dict(case=label,service=namespace,bytes=packet.hex()))
    assert all(not valid_legacy_fast(r['service'],bytes.fromhex(r['bytes'])) for r in rejected)
    return dict(fastRejected=rejected,fast=fast.hex(),fastService=0xfef3,full=full.hex(), compact=header.hex(), bloomPositions=positions(b'NearbySharing'), packets=packets, nearbyFrame=(b'\x00\x00\x00\x11' + bytes(range(17))).hex())

if __name__ == '__main__':
    path = Path(__file__).with_name('fixtures') / 'quickshare-ble-wire.json'
    expected = fixtures()
    if '--write' in sys.argv: path.write_text(json.dumps(expected, indent=2) + '\n')
    else:
        assert json.loads(path.read_text()) == expected, 'BLE wire fixture changed'
        print('PASS independent BLE advertisement/Bloom/Weave fixtures (no radio evidence)')
