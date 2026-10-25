#!/usr/bin/env python3
"""Real HTTPS exchange test, to run on a second authorized tailnet device.

Use a disposable Airdrop workspace. Clipboard is temporarily changed and restored
only if no other client changed it. This does not install/configure Tailscale.
"""
import argparse
import io
import json
from pathlib import Path
import platform
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Redirect rejected; supply the actual workspace HTTPS origin')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists() or not args.output.parent.is_dir():
        parser.error('Output must be a new file in an existing directory')
    url = urllib.parse.urlsplit(args.url)
    if url.scheme != 'https' or not url.hostname or not url.hostname.endswith('.ts.net') or url.username or url.password or url.port not in [None, 443]:
        parser.error('Expected Tailscale HTTPS origin without credentials or a nonstandard port')
    origin = urllib.parse.urlunsplit(('https', url.netloc, '', '', ''))
    opener = urllib.request.build_opener(NoRedirect())  # Default verified TLS and environment proxy handling.
    def request(path, method='GET', data=None, content_type=None):
        headers = {'Content-Type': content_type} if content_type else {}
        with opener.open(urllib.request.Request(origin+path, data=data, method=method, headers=headers), timeout=15) as response:
            return response.status, response.read()
    report = {'client': platform.node(), 'arch': platform.machine(), 'origin': origin,
              'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'BLOCKED',
              'device_topology': 'Record host and client identities separately; this script cannot prove they are different physical devices'}
    name = 'airdrop-reference-'+uuid.uuid4().hex+'.txt'
    payload = ('Reference file/clipboard transfer: İstanbul 👋 '+name).encode()
    previous = None
    clipboard_changed = False
    cleanup_errors = []
    upload_attempted = False
    try:
        health = json.loads(request('/push/health')[1])
        assert health['push'] is True and health['share'] is True
        upload_attempted = True
        assert request('/push/files/'+name, 'PUT', payload)[0] == 201
        assert request('/'+name)[1] == payload
        archive = request('/push/archive', 'POST', json.dumps({'files': [name]}).encode(), 'application/json')[1]
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            assert bundle.read(name) == payload
        try:
            previous = request('/.clipboard.txt')[1]
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        request('/.clipboard.txt', 'PUT', payload)
        clipboard_changed = True
        assert request('/.clipboard.txt')[1] == payload
        report['status'] = 'VERIFIED'
        report['verified'] = ['HTTPS health', 'file upload/download bytes', 'ZIP bytes', 'shared clipboard bytes']
    except Exception as error:
        report['failure'] = str(error)
    finally:
        if clipboard_changed:
            try:
                if request('/.clipboard.txt')[1] == payload:
                    request('/.clipboard.txt', 'DELETE' if previous is None else 'PUT', previous)
                else:
                    cleanup_errors.append('Clipboard changed concurrently; newer contents left untouched')
            except Exception as error:
                cleanup_errors.append('Clipboard restore: '+str(error))
        if upload_attempted:
            try:
                request('/'+name, 'DELETE')
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    cleanup_errors.append('Fixture removal: '+str(error))
            except Exception as error:
                cleanup_errors.append('Fixture removal: '+str(error))
        if cleanup_errors:
            report['cleanup_errors'] = cleanup_errors
            report['status'] = 'BLOCKED'
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        with args.output.open('x') as output:
            json.dump(report, output, indent=2)
            output.write('\n')
    print(args.output)
    return 0 if report['status'] == 'VERIFIED' else 1


if __name__ == '__main__':
    sys.exit(main())
