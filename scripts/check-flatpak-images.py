#!/usr/bin/env python3
"""Verify PNG structure/integrity and the actual AppStream screenshot download."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import urllib.request
import xml.etree.ElementTree as ET
import zlib

ROOT = Path(__file__).resolve().parents[1]


def png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'Not PNG'
    pos, compressed, dimensions, ended = 8, bytearray(), None, False
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos+4])[0]
        kind, body = data[pos+4:pos+8], data[pos+8:pos+8+size]
        assert len(body) == size
        crc = struct.unpack('>I', data[pos+8+size:pos+12+size])[0]
        assert zlib.crc32(kind+body) & 0xffffffff == crc, 'PNG CRC mismatch'
        if kind == b'IHDR':
            dimensions = struct.unpack('>II', body[:8])
        if kind == b'IDAT':
            compressed.extend(body)
        pos += 12+size
        if kind == b'IEND':
            ended = True
            break
    assert ended and dimensions and zlib.decompress(compressed), 'Incomplete PNG'
    return dict(width=dimensions[0], height=dimensions[1], bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metainfo', type=Path, default=ROOT/'packaging/io.github.fluffydisk.airdrop-linux.metainfo.xml')
    parser.add_argument('--capture', type=Path, default=ROOT/'assets/airdrop-flatpak-desktop.png')
    parser.add_argument('--icon', type=Path, default=ROOT/'ui/icon-512.png')
    args = parser.parse_args()
    images = {'icon': png(args.icon.read_bytes()), 'real_capture': png(args.capture.read_bytes())}
    assert images['icon']['width'] == images['icon']['height'] == 512
    url = ET.parse(args.metainfo).findtext('screenshots/screenshot/image')
    assert url and url.startswith('https://'), 'Missing HTTPS screenshot URL'
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(10*1024*1024+1)
    assert len(data) <= 10*1024*1024, 'Unexpectedly large screenshot'
    images['store_screenshot'] = {**png(data), 'url': url}
    for name in ['real_capture', 'store_screenshot']:
        assert images[name]['width'] >= 624 and images[name]['height'] >= 351
    print(json.dumps(images, indent=2))


if __name__ == '__main__':
    main()
