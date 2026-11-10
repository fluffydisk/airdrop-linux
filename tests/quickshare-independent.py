#!/usr/bin/env python3
"""Independent Python client: P-256 UKEY2, transcript/code and directional keys.

Uses Python/OpenSSL crypto and a small test-only protobuf codec, no rqs_lib code.
Field numbers: Google Nearby schemas pinned at e71e92bb246450c56bc1b1823929e8c1c49723fa;
UKEY2/SecureMessage labels follow the Google protocol. This is NOT an Android
result and covers only the client role and helper receiving; not BLE discovery or Node publication.
Requires cryptography (Ubuntu/Debian python3-cryptography).
"""
import hashlib
import hmac
import json
import os
import queue
import socket
import struct
import subprocess
import tempfile
import threading
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding


def varint(n):
    assert n >= 0
    data = bytearray()
    while n > 127:
        data.append((n & 127) | 128)
        n >>= 7
    return bytes(data + bytes([n]))


def integer(field, n):
    return varint(field << 3) + varint(n)


def blob(field, data):
    return varint((field << 3) | 2) + varint(len(data)) + data


def fields(data):
    result, offset = {}, 0

    def number():
        nonlocal offset
        n, shift = 0, 0
        while shift < 70:
            assert offset < len(data), 'Truncated protobuf'
            b = data[offset]
            offset += 1
            n |= (b & 127) << shift
            if b < 128:
                return n
            shift += 7
        raise AssertionError('Oversized protobuf varint')

    while offset < len(data):
        tag = number()
        if tag & 7 == 0:
            value = number()
        else:
            assert tag & 7 == 2, 'Unsupported fixture wire type'
            size = number()
            assert size <= len(data) - offset, 'Truncated protobuf bytes'
            value = data[offset:offset + size]
            offset += size
        result.setdefault(tag >> 3, []).append(value)
    return result


def one(data, field):
    values = fields(data)[field]
    assert len(values) == 1, 'Unexpected repeated field'
    return values[0]


def frame(kind, field, payload):
    return integer(1, 1) + blob(2, integer(1, kind) + blob(field, payload))


def recv_exact(sock, size):
    result = bytearray()
    while len(result) < size:
        chunk = sock.recv(size - len(result))
        assert chunk, 'Unexpected peer EOF'
        result.extend(chunk)
    return bytes(result)


def receive(sock):
    size, = struct.unpack('!I', recv_exact(sock, 4))
    assert 0 < size <= 5 * 1024 * 1024, 'Invalid wire frame size'
    return recv_exact(sock, size)


def send(sock, data):
    # Deliberately fragment a complete frame across prefix/body boundaries.
    raw = struct.pack('!I', len(data)) + data
    for start, end in [(0, 1), (1, 3), (3, 7), (7, len(raw))]:
        sock.sendall(raw[start:end])


def hkdf(salt, secret, info):
    # All requested keys are one SHA-256 block.
    prk = hmac.digest(salt, secret, 'sha256')
    return hmac.digest(prk, info + b'\x01', 'sha256')


def code(auth):
    value, multiplier = 0, 1
    for byte in auth:
        signed = byte if byte < 128 else byte - 256
        value += signed * multiplier
        value = value % 9973 if value >= 0 else -((-value) % 9973)
        multiplier = multiplier * 31 % 9973
    return f'{abs(value):04}'


class Helper:
    def __init__(self, executable):
        self.proc = subprocess.Popen([executable], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.pending, self.events, self.sequence = queue.Queue(), [], 0
        def read():
            try:
                for line in self.proc.stdout:
                    assert len(line) <= 4 * 1024 * 1024
                    self.pending.put(json.loads(line))
            finally:
                self.pending.put(None)
        threading.Thread(target=read, daemon=True).start()

    def next(self):
        message = self.pending.get(timeout=10)
        assert message and message['v'] == 1, 'Helper IPC closed or incompatible'
        return message

    def request(self, method, params=None):
        self.sequence += 1
        request_id = str(self.sequence)
        self.proc.stdin.write((json.dumps(dict(v=1, id=request_id, method=method,
                                              params=params or {})) + '\n').encode())
        self.proc.stdin.flush()
        while True:
            message = self.next()
            if message.get('id') == request_id:
                assert 'error' not in message, 'Helper rejected fixture command'
                return message['result']
            self.events.append(message)

    def event(self, predicate):
        while True:
            for message in self.events:
                if predicate(message):
                    return message
            self.events.append(self.next())

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=7)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        assert self.proc.returncode == 0, 'Helper failed on shutdown'


def main(mode):
    if not __debug__:
        raise RuntimeError("Protocol acceptance assertions require non-optimized Python")
    executable = os.environ['AIRDROP_TEST_QUICKSHARE_HELPER']
    data = b'' if mode == 'empty' else bytes(range(256)) * 257 + b'final'
    filename = 'independent-empty.bin' if mode == 'empty' else '独立-é.bin'
    with tempfile.TemporaryDirectory(prefix='quickshare-independent-') as root:
        helper = Helper(executable)
        try:
            assert helper.request('hello')['protocol'] == 1
            port = helper.request('start', dict(port=0, name='Independent fixture', staging=root))['port']
            with socket.create_connection(('127.0.0.1', port), timeout=5) as sock:
                endpoint = b'\x02' + bytes(16) + b'\x06Python'
                send(sock, frame(1, 2, blob(1, b'TEST') + blob(2, b'Python') + blob(6, endpoint)))
                private = ec.generate_private_key(ec.SECP256R1())
                public = private.public_key().public_numbers()
                def coordinate(n):
                    data = n.to_bytes(32, 'big')
                    return b'\x00' + data if data[0] & 128 else data
                public_proto = integer(1, 1) + blob(2, blob(1, coordinate(public.x)) + blob(2, coordinate(public.y)))
                finish = integer(1, 4) + blob(2, blob(1, public_proto))
                init_data = (integer(1, 1) + blob(2, os.urandom(32)) +
                             blob(3, integer(1, 100) + blob(2, hashlib.sha512(finish).digest())) +
                             blob(4, b'AES_256_CBC-HMAC_SHA256'))
                init = integer(1, 2) + blob(2, init_data)
                send(sock, init)
                server = receive(sock)
                assert one(server, 1) == 3, 'Expected UKEY2 SERVER_INIT'
                server_init = one(server, 2)
                assert one(server_init, 1) == 1 and one(server_init, 3) == 100
                assert len(one(server_init, 2)) == 32
                key = one(server_init, 4)
                assert one(key, 1) == 1
                point = one(key, 2)
                remote = ec.EllipticCurvePublicNumbers(int.from_bytes(one(point, 1), 'big'),
                                                     int.from_bytes(one(point, 2), 'big'), ec.SECP256R1()).public_key()
                secret = hashlib.sha256(private.exchange(ec.ECDH(), remote)).digest()
                transcript = init + server
                auth = hkdf(b'UKEY2 v1 auth', secret, transcript)
                following = hkdf(b'UKEY2 v1 next', secret, transcript)
                salt = bytes.fromhex('82AA55A0D397F88346CA1CEE8D3909B95F13FA7DEB1D4AB38376B8256DA85510')
                key_salt = bytes.fromhex('BF9D2A53C63616D75DB0A7165B91C1EF73E537F2427405FA23610A4BE657642E')
                server_secret = hkdf(salt, following, b'server')
                encryption = hkdf(key_salt, server_secret, b'ENC:2')
                signing = hkdf(key_salt, server_secret, b'SIG:1')
                if mode == 'bad-commitment':
                    altered = finish[:-1] + bytes([finish[-1] ^ 1])
                    send(sock, altered)
                    helper.event(lambda m: m.get('event') == 'transfer' and m.get('data', {}).get('phase') == 'interrupted')
                    assert not any(Path(root).iterdir()), 'Failed handshake created receive files'
                    print('PASS independent Python client:', mode)
                    return
                send(sock, finish)
                send(sock, frame(2, 3, integer(3, 1)))
                assert one(one(receive(sock), 2), 1) == 2
                # Decrypt and authenticate both setup chunks with independently derived server keys.
                for sequence in (1, 2):
                    secure = receive(sock)
                    body = one(secure, 1)
                    assert hmac.compare_digest(one(secure, 2), hmac.digest(signing, body, 'sha256')), 'Directional MAC mismatch'
                    header = one(body, 1)
                    assert one(header, 1) == 1 and one(header, 2) == 2
                    decrypt = Cipher(algorithms.AES(encryption), modes.CBC(one(header, 5))).decryptor()
                    padded = decrypt.update(one(body, 2)) + decrypt.finalize()
                    unpad = padding.PKCS7(128).unpadder()
                    plain = unpad.update(padded) + unpad.finalize()
                    assert one(plain, 2) == sequence, 'Encrypted sequence mismatch'
                    assert one(one(one(plain, 1), 2), 1) == 3, 'Expected setup payload'
                # Prove the opposite directional keys by sending an authenticated keepalive.
                client_secret = hkdf(salt, following, b'client')
                client_encryption = hkdf(key_salt, client_secret, b'ENC:2')
                client_signing = hkdf(key_salt, client_secret, b'SIG:1')
                sequence = 0
                def encrypted(offline):
                    nonlocal sequence
                    sequence += 1
                    plaintext = blob(1, offline) + integer(2, sequence)
                    pad = padding.PKCS7(128).padder()
                    padded = pad.update(plaintext) + pad.finalize()
                    iv = os.urandom(16)
                    encrypt = Cipher(algorithms.AES(client_encryption), modes.CBC(iv)).encryptor()
                    header_body = blob(1, integer(1, 1) + integer(2, 2) + blob(5, iv)) + blob(2, encrypt.update(padded) + encrypt.finalize())
                    return header_body
                def secure_send(offline):
                    hb = encrypted(offline)
                    send(sock, blob(1, hb) + blob(2, hmac.digest(client_signing, hb, 'sha256')))
                def setup(payload_id, content):
                    header = integer(1, payload_id) + integer(2, 1) + integer(3, len(content))
                    for offset, final, body in [(0, 0, content), (len(content), 1, b'')]:
                        chunk = integer(1, final) + integer(2, offset) + blob(3, body)
                        secure_send(frame(3, 4, integer(1, 1) + blob(2, header) + blob(3, chunk)))
                setup(1, frame(3, 4, b''))  # unauthenticated paired-key exchange
                setup(2, frame(4, 5, integer(1, 3)))  # Unable, never persistent trust
                manifest = blob(1, filename.encode()) + integer(3, 42) + integer(4, len(data))
                setup(3, frame(1, 2, blob(1, manifest)))
                event = helper.event(lambda m: m.get('event') == 'transfer' and m.get('data', {}).get('phase') == 'awaiting-acceptance')
                assert hmac.compare_digest(event['data']['pinCode'], code(auth)), 'Independent verification codes differ'
                transfer_id = event['data']['id']
                assert event['data']['files'] == [filename]
                assert not any(Path(root).iterdir()), 'Data created before consent'
                if mode in ('empty', 'binary'):
                    helper.request('respond', dict(transferId=transfer_id, accept=True))
                    helper.event(lambda m: m.get('event') == 'transfer' and m.get('data', {}).get('id') == transfer_id and m['data'].get('phase') == 'transferring')
                    header = integer(1, 42) + integer(2, 2) + integer(3, len(data))
                    for offset in range(0, len(data), 16384):
                        chunk = integer(1, 0) + integer(2, offset) + blob(3, data[offset:offset + 16384])
                        secure_send(frame(3, 4, integer(1, 1) + blob(2, header) + blob(3, chunk)))
                    final = integer(1, 1) + integer(2, len(data)) + blob(3, b'')
                    secure_send(frame(3, 4, integer(1, 1) + blob(2, header) + blob(3, final)))
                    result = helper.event(lambda m: m.get('event') == 'transfer' and m.get('data', {}).get('id') == transfer_id and m['data'].get('phase') == 'complete')['data']
                    assert result['total'] == len(data) and len(result['stagedPaths']) == 1
                    received = Path(result['stagedPaths'][0])
                    assert received.parent.parent == Path(root) and received.name == filename
                    assert hashlib.sha256(received.read_bytes()).digest() == hashlib.sha256(data).digest(), 'Independent file hash mismatch'
                elif mode == 'decline':
                    helper.request('respond', dict(transferId=transfer_id, accept=False))
                    helper.event(lambda m: m.get('event') == 'transfer' and m.get('data', {}).get('id') == transfer_id and m['data'].get('phase') == 'declined')
                    assert not any(Path(root).iterdir()), 'Declined payload created receive files'
                else:
                    if mode == 'replay':
                        header_body = encrypted(frame(5, 6, integer(1, 1)))
                        packet = blob(1, header_body) + blob(2, hmac.digest(client_signing, header_body, 'sha256'))
                        send(sock, packet)
                        send(sock, packet)
                    else:
                        secure_send(frame(5, 6, integer(1, 1)))
                        header_body = encrypted(frame(5, 6, integer(1, 1)))
                        # Invalid MAC must terminate this session without consent.
                        send(sock, blob(1, header_body) + blob(2, bytes(32)))
                    helper.event(lambda m: m.get('event') == 'transfer' and m.get('data', {}).get('id') == transfer_id and m['data'].get('phase') == 'interrupted')
                    assert not any(Path(root).iterdir()), 'Handshake fixture created receive files without consent'

        finally:
            helper.close()
    print('PASS independent Python client:', mode)


if __name__ == '__main__':
    for case in ('bad-commitment', 'bad-mac', 'replay', 'decline', 'empty', 'binary'):
        main(case)
