#!/usr/bin/env python3
"""AWDL device acceptance tool. Sends and verifies only its public test fixture."""
import argparse
import gzip
import hashlib
import http.client
import io
import ipaddress
import json
from pathlib import Path
import plistlib
import secrets
import socket
import ssl
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

NAME = "Linux-AirDrop-test.txt"
DATA = b"Linux AirDrop device test\n" * 2048
LIMIT = 1024 * 1024
SERVICE = "_airdrop._tcp.local."


def archive():
    def entry(name, data, inode):
        name = name.encode() + b"\0"
        header = "070707" + "".join(f"{n:06o}" for n in (0, inode, 0o100644, 0, 0, 1, 0))
        return (header + f"{0:011o}{len(name):06o}{len(data):011o}").encode() + name + data
    return gzip.compress(entry("./" + NAME, DATA, 1) + entry("TRAILER!!!", b"", 0))


def verify_archive(body):
    # libarchive handles Apple cpio variants. Never extract remote paths to disk.
    import libarchive
    if body.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as source:
            body = source.read(LIMIT + 1)
    if len(body) > LIMIT:
        raise ValueError("Açılmış arşiv boyut sınırı")
    matched = False
    with libarchive.memory_reader(body, format_name="cpio", filter_name="none") as entries:
        for index, item in enumerate(entries):
            if index >= 8:
                raise ValueError("Çok fazla arşiv girdisi")
            if item.isdir and item.pathname in (".", "./"):
                continue
            if matched or not item.isfile or item.pathname not in (NAME, "./" + NAME) or item.size != len(DATA):
                raise ValueError("Beklenmeyen dosya")
            digest = hashlib.sha256()
            for block in item.get_blocks():
                digest.update(block)
            matched = digest.digest() == hashlib.sha256(DATA).digest()
            if not matched:
                raise ValueError("Dosya özeti eşleşmedi")
    if not matched:
        raise ValueError("Test dosyası eksik")


def read_body(handler):
    if handler.headers.get("Transfer-Encoding", "").lower() == "chunked":
        body = bytearray()
        while True:
            line = handler.rfile.readline(64)
            if not line.endswith(b"\r\n"):
                raise ValueError("Eksik parça başlığı")
            size = int(line.strip(), 16)
            if not 0 <= size <= LIMIT - len(body):
                raise ValueError("Boyut sınırı")
            chunk = handler.rfile.read(size)
            if len(chunk) != size or handler.rfile.read(2) != b"\r\n":
                raise ValueError("Eksik parça")
            if not size:
                return bytes(body)
            body.extend(chunk)
    size = int(handler.headers.get("Content-Length", "-1"))
    if not 0 <= size <= LIMIT:
        raise ValueError("Geçersiz içerik boyutu")
    data = handler.rfile.read(size)
    if len(data) != size:
        raise ValueError("Eksik içerik")
    return data


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def reply(self, status, fields=None):
        data = plistlib.dumps(fields, fmt=plistlib.FMT_BINARY) if fields is not None else b""
        self.send_response(status)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        try:
            if self.path == "/Upload":
                # Approve, upload and verify on the same TLS connection.
                if not getattr(self, "approved", False):
                    self.close_connection = True
                    return self.reply(403)
                self.approved = False
                verify_archive(read_body(self))
                self.server.result["receivedSha256"] = hashlib.sha256(DATA).hexdigest()
                self.server.finished = self.close_connection = True
                return self.reply(200)
            fields = plistlib.loads(read_body(self))
            if not isinstance(fields, dict):
                raise ValueError("Geçersiz istek")
            response = {"ReceiverComputerName": "Linux AirDrop Test", "ReceiverModelName": "Linux"}
            if self.path == "/Discover":
                response["ReceiverMediaCapabilities"] = b'{"Version":1}'
            elif self.path == "/Ask":
                files = fields.get("Files")
                if not isinstance(files, list) or len(files) != 1 or files[0].get("FileName") != NAME or files[0].get("FileIsDirectory"):
                    return self.reply(403)
                self.approved = input(f"iPad üzerinde {NAME} gönderimini başlattın mı? [e/H] ").lower() == "e"
                if not self.approved:
                    return self.reply(403)
            else:
                return self.reply(404)
            return self.reply(200, response)
        except (ValueError, EOFError, OSError, TypeError, AttributeError, plistlib.InvalidFileException) as error:
            self.close_connection = True
            print("Alım tamamlanamadı:", type(error).__name__)
            self.reply(400)


def receive(zc, ip, interface, context, result):
    from zeroconf import ServiceInfo
    class Server(HTTPServer):
        address_family = socket.AF_INET6
        def get_request(self):
            raw, peer = self.socket.accept()
            raw.settimeout(20)
            try:
                return context.wrap_socket(raw, server_side=True), peer
            except BaseException:
                raw.close()
                raise
    with Server((str(ip), 0, 0, interface), Handler) as server:
        server.result = result
        server.finished = False
        server.timeout = 1
        ident = secrets.token_hex(6)
        info = ServiceInfo(SERVICE, ident + "." + SERVICE, addresses=[ip.packed],
                           port=server.server_port, properties={"flags": "136"}, server=ident + ".local.")
        zc.register_service(info)
        try:
            print("iPad Dosyalar'dan test dosyasını Linux AirDrop Test alıcısına gönder.")
            deadline = time.monotonic() + 120
            while not server.finished and time.monotonic() < deadline:
                server.handle_request()
            return server.finished
        finally:
            zc.unregister_service(info)


def send(zc, interface, context, result):
    from zeroconf import ServiceBrowser, ServiceListener
    names = set()
    class Listener(ServiceListener):
        def add_service(self, zc, kind, name):
            names.add(name)
        def remove_service(self, zc, kind, name):
            names.discard(name)
        def update_service(self, zc, kind, name):
            pass
    browser = ServiceBrowser(zc, SERVICE, Listener())
    try:
        print("iPad üzerinde AirDrop görünürlüğünü aç. 12 saniye taranıyor…", flush=True)
        time.sleep(12)
        peers = []
        for name in sorted(names.copy()):
            info = zc.get_service_info(SERVICE, name, timeout=1500)
            if not info:
                continue
            for raw in info.parsed_addresses():
                addr = ipaddress.ip_address(raw.split("%")[0])
                if addr.version == 6 and addr.is_link_local:
                    peers.append((name, str(addr), info.port))
                    break
    finally:
        browser.cancel()
    result["devicesFound"] = len(peers)
    if not peers:
        return False
    for idx, (name, _, _) in enumerate(peers, 1):
        print(idx, ascii(name))
    index = int(input("Test dosyasını göndermek için alıcı numarası: "))
    if not 1 <= index <= len(peers):
        return False
    _, addr, port = peers[index - 1]
    conn = http.client.HTTPSConnection(f"{addr}%{interface}", port, timeout=45, context=context)
    def post(path, data, mime, chunked=False):
        conn.request("POST", path, io.BytesIO(data) if chunked else data,
                     {"Content-Type": mime}, encode_chunked=chunked)
        reply = conn.getresponse()
        if len(reply.read(LIMIT + 1)) > LIMIT:
            raise ValueError("Yanıt boyut sınırı")
        result[path[1:]] = reply.status
        return reply.status == 200
    try:
        sender = {"SenderComputerName": "Linux AirDrop Test", "SenderID": secrets.token_hex(6), "SenderModelName": "Linux"}
        if not post("/Discover", plistlib.dumps(sender, fmt=plistlib.FMT_BINARY), "application/octet-stream"):
            return False
        sender.update(BundleID="com.apple.finder", ConvertMediaFormats=False)
        sender["Files"] = [{"FileName": NAME, "FileBomPath": "./"+NAME, "FileType": "public.plain-text", "FileIsDirectory": False, "ConvertMediaFormats": 0}]
        return post("/Ask", plistlib.dumps(sender, fmt=plistlib.FMT_BINARY), "application/octet-stream") and post("/Upload", archive(), "application/x-cpio", True)
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["send", "receive"])
    parser.add_argument("--interface", default="awdl0")
    args = parser.parse_args()
    result = {"mode": args.mode, "fixtureBytes": len(DATA), "fixtureSha256": hashlib.sha256(DATA).hexdigest(), "completed": False}
    output = Path(tempfile.mkdtemp(prefix="airdrop-ipad-", dir=Path.home()))
    try:
        interface = socket.if_nametoindex(args.interface)
        rows = json.loads(subprocess.check_output(["ip", "-j", "-6", "addr", "show", "dev", args.interface]))
        ip = next((ipaddress.IPv6Address(a["local"]) for r in rows for a in r["addr_info"] if a["scope"] == "link"), None)
        if not ip:
            raise ValueError("AWDL arayüzünde IPv6 link-local adresi yok")
        from zeroconf import IPVersion, Zeroconf
        if args.mode == "receive":
            import libarchive  # Verify the receive dependency before advertising.
            (output / NAME).write_bytes(DATA)
            print("Bu dosyayı iPad'e kopyalayıp geri gönderebilirsin:", output / NAME)
        with tempfile.TemporaryDirectory() as tmp:
            cert, key = [str(Path(tmp)/p) for p in ("cert", "key")]
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                            "-subj", "/CN=Linux AirDrop Test", "-keyout", key, "-out", cert], capture_output=True, check=True)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER if args.mode == "receive" else ssl.PROTOCOL_TLS_CLIENT)
            if args.mode == "send":
                # Everyone-mode test, synthetic payload only. No Apple identity is asserted.
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
            context.load_cert_chain(cert, key)
            zc = Zeroconf(interfaces=[interface], ip_version=IPVersion.V6Only)
            try:
                result["completed"] = (receive(zc, ip, interface, context, result) if args.mode == "receive"
                                       else send(zc, args.interface, context, result))
            finally:
                zc.close()
    except (Exception, KeyboardInterrupt) as error:
        result["error"] = type(error).__name__
        print("Test durdu:", error)
    finally:
        target = output / "report.json"
        target.write_text(json.dumps(result, indent=2) + "\n")
        print("Paylaşılacak rapor:", target)
    return 0 if result["completed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
