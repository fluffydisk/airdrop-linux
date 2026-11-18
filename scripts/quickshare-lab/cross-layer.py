#!/usr/bin/env python3
"""T30 bounded metadata-only collector/reducer. No Bluetooth commands or audio capture."""
import argparse
import json
import os
from pathlib import Path
import re
import select
import socket
import stat
import subprocess
import time

APP_STAGES = set('trace-start radio-stage gatt-read gatt-write gatt-notify state frame-header frame-body-read frame-write-enter frame-write-return offline-decoded payload-header file-body-written consent-received consent-response-enter consent-response-written rfcomm-arrived read-enter read-return write-enter write-return flush-return shutdown-enter shutdown-return transport-drop session-cancel session-end owner-stop'.split())
KERNEL = {
 'trace_start': 'clock seconds', 'trace_end': '',
 'hci': 'driver13 raw13 dispatch13 handlers reported reported_acl reported_le reported_unknown ncp_unparsed acl_queue acl_complete le_queue le_complete acl_credit le_credit rx_queue_ns ncp_runtime_ns',
 'audio': 'calls returns errors queue complete sent last_queue_ns last_complete_ns queue_gap_ns complete_gap_ns send_runtime_ns',
 'usb': 'intr intr_bytes intr_errors bulk_rx bulk_errors tx tx_errors submits submit_errors completed_urb_ns',
 'pending': 'max_urb_age_ns bulk_out_age_ns bulk_in_age_ns rx_runtime_ns tx_runtime_ns acl_credit_delta le_credit_delta',
 'disconnect': 'link role reason acl le sent',
 'disconnect_raw': 'status reason', 'le_connect': 'status role',
 'classic_connect': 'status link', 'classic_request': 'link',
 'progress_gap': 'kind gap_ns', 'interrupt_pending': 'count age_ns submits submit_errors',
 'le_update': 'status interval latency timeout',
 'command_status': 'opcode status', 'command_send': 'opcode command_credit', 'command_complete': 'opcode status',
 'command_return': 'opcode result',
}

def numeric(x):
    return isinstance(x, int) and not isinstance(x, bool) and -(2**63) < x < 2**63


def diagnostic_flags(directory):
    """bpftrace compiler warnings may use stdout, unlike attach diagnostics.

    Keep diagnostic text out of the report; warnings and capture loss are
    separate facts, neither is inferred from rejected numeric records.
    """
    warnings = loss = errors = False
    for name in ('kernel.log', 'kernel-errors.log'):
        path = directory / name
        if path.is_symlink():
            raise ValueError('diagnostic log replaced')
        if not path.exists():
            continue
        with path.open() as stream:
            for line in stream:
                warnings |= bool(re.search(r'\bwarning\b', line, re.I))
                loss |= bool(re.search(r'\blost\s+[1-9]\d*\b|\bdropped\b', line, re.I))
                errors |= bool(re.search(r'\berror\b|\bERROR:', line, re.I))
    return dict(kernelCompilerWarnings=warnings, kernelReportedLoss=loss,
                kernelDiagnosticErrors=errors,
                kernelWarningsOrLoss=warnings or loss or errors)


def app_record(data):
    x = json.loads(data)
    if set(x) != {'v', 'source', 'clock', 'monoNs', 'stage', 'a', 'b', 'lost'}:
        raise ValueError('unexpected schema')
    if type(x['v']) is not int or x['v'] != 1 or x['source'] != 'app' or x['clock'] != 'monotonic' or x['stage'] not in APP_STAGES:
        raise ValueError('unexpected schema')
    if not all(numeric(x[k]) for k in ['monoNs', 'a', 'b', 'lost']) or x['monoNs'] <= 0 or x['a'] < 0 or x['lost'] < 0:
        raise ValueError('invalid scalar')
    return x


def kernel_record(line):
    m = re.fullmatch(r'ns=(\d+) event=([a-z_]+)((?: [a-z0-9_]+=-?\d+)*)', line.strip())
    if not m or m[2] not in KERNEL:
        raise ValueError('not a numeric kernel record')
    pairs = re.findall(r'([a-z0-9_]+)=(-?\d+)', m[3])
    fields = {k: int(v) for k, v in pairs}
    if len(pairs) != len(fields) or set(fields) != set(KERNEL[m[2]].split()) or not all(numeric(v) for v in fields.values()):
        raise ValueError('unexpected fields')
    ns = int(m[1])
    if not 0 < ns < 2**63:
        raise ValueError('invalid clock')
    return {'v': 1, 'source': 'kernel', 'clock': 'monotonic', 'monoNs': ns, 'stage': m[2], **fields}


def analyze(records):
    """Conservative boundary signatures. No firmware causality or hardware success verdict."""
    hci = sorted((r for r in records if r.get('source') == 'kernel' and r.get('stage') == 'hci'), key=lambda r: r['monoNs'])
    samples = {(r['stage'], r['monoNs']): r for r in records if r.get('source') == 'kernel'}
    result = []
    for prev, cur in zip(hci, hci[1:]):
        keys = ['driver13', 'raw13', 'dispatch13', 'handlers', 'acl_queue', 'acl_complete']
        delta = {k: cur[k] - prev[k] for k in keys}
        if any(n < 0 for n in delta.values()):
            result.append({'atMonoNs': cur['monoNs'], 'classification': 'counter-reset-coverage-invalid'})
            continue
        if cur['monoNs'] - prev['monoNs'] > 2_500_000_000:
            result.append({'atMonoNs': cur['monoNs'], 'classification': 'sample-gap-coverage-invalid'})
            continue
        if delta['acl_complete']:
            continue
        if delta['driver13'] and not delta['raw13']:
            boundary = 'driver-reassembled-to-hci-ingress-no-progress'
        elif delta['raw13'] and not delta['dispatch13']:
            boundary = 'hci-ingress-to-dispatch-no-progress'
        elif delta['dispatch13'] and not delta['handlers']:
            boundary = 'dispatch-to-ncp-handler-no-progress'
        elif delta['handlers']:
            boundary = 'ncp-handler-without-acl-dequeue-not-necessarily-error'
        elif not delta['raw13']:
            boundary = 'no-ncp-at-hci-ingress-origin-unresolved'
        else:
            continue
        signature = {'fromMonoNs': prev['monoNs'], 'toMonoNs': cur['monoNs'], 'classification': boundary, 'aclCredit': cur['acl_credit'], 'deltas': delta}
        first = samples.get(('interrupt_pending', prev['monoNs']))
        last = samples.get(('interrupt_pending', cur['monoNs']))
        if first and last and first['submits'] > 0 and last['submits'] >= first['submits']:
            signature['interruptContext'] = {
                'trackedAtStart': first['count'], 'trackedAtEnd': last['count'],
                'ageAtEndNs': last['age_ns'],
                'submissionDelta': last['submits'] - first['submits'],
                'submissionErrorDelta': last['submit_errors'] - first['submit_errors'],
                'interpretation': 'pending-at-both-samples-origin-unresolved' if first['count'] and last['count'] else 'not-pending-at-both-samples-not-proof-of-resubmit-defect',
            }
        result.append(signature)
    return {'schema': 1, 'clock': 'monotonic', 'signatures': result,
            'limitations': ['NCP may concern LE or other connections; handler without ACL dequeue is not proof of an accounting defect.',
                            'No raw NCP at host ingress does not exclude selective USB/reassembly loss or prove firmware fault.',
                            'Pending USB interrupt requests do not prove controller event generation or bus delivery. Sparse zero counts do not prove a resubmit defect.',
                            'Independent aggregate samples are not atomic transactions. No acoustic or phone success is inferred.']}


def system_record():
    """Read-only scoped context. Addresses/SSID/device paths never leave RAM."""
    began = time.monotonic_ns()
    values = dict(aclCentral=0, aclPeripheral=0, leCentral=0, lePeripheral=0,
                  inventoryValid=0, pmRuntime=255, pmControl=255,
                  autosuspendMs=-1, wifiMHz=0)
    try:
        links = json.loads(subprocess.check_output(['python', str(Path(__file__).with_name('connected-links.py'))], timeout=2))
        if links.get('querySucceeded'):
            values['inventoryValid'] = 1
            for c in links.get('connections', []):
                key = ('acl' if c.get('linkType') == 'BR/EDR' else 'le' if c.get('linkType') == 'LE' else '')
                role = {'central': 'Central', 'peripheral': 'Peripheral'}.get(c.get('role'), '')
                if key and role:
                    values[key + role] += 1
        matches = []
        for dev in Path('/sys/bus/usb/devices').iterdir():
            try:
                if (dev / 'idVendor').read_text().strip() == '0bda' and (dev / 'idProduct').read_text().strip() == 'b00a':
                    matches.append(dev)
            except OSError:
                continue
        if len(matches) == 1:
            power = matches[0] / 'power'
            values['pmRuntime'] = {'active': 0, 'suspended': 1, 'resuming': 2, 'suspending': 3}.get((power / 'runtime_status').read_text().strip(), 255)
            values['pmControl'] = {'auto': 0, 'on': 1}.get((power / 'control').read_text().strip(), 255)
            values['autosuspendMs'] = int((power / 'autosuspend_delay_ms').read_text())
        names = re.findall(r'^\s*Interface (\S+)', subprocess.check_output(['iw', 'dev'], text=True, timeout=2), re.M)
        freq = []
        for name in names:
            text = subprocess.check_output(['iw', 'dev', name, 'link'], text=True, timeout=2)
            m = re.search(r'freq:\s*(\d+)', text)
            if m:
                freq.append(int(m[1]))
        if len(freq) == 1:
            values['wifiMHz'] = freq[0]
    except (OSError, ValueError, subprocess.SubprocessError):
        pass  # Unknown remains explicit; never change PM/network configuration.
    return dict(v=1, source='system', clock='monotonic', monoNs=began,
                stage='context', sampleEndMonoNs=time.monotonic_ns(), **values)


def collect(directory, seconds):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    st = directory.lstat()
    if not stat.S_ISDIR(st.st_mode) or directory.is_symlink() or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise ValueError('private owned directory required')
    sock_path = directory / 'app.sock'
    kernel_path = directory / 'kernel.log'
    if kernel_path.is_symlink():
        raise ValueError('symlink forbidden')
    timeline = directory / 'timeline.jsonl'
    status = {'schema': 1, 'status': 'collecting', 'clock': 'monotonic', 'records': 0, 'rejected': 0, 'audioCaptured': False}
    started = time.monotonic_ns()
    status['startedMonoNs'] = started
    stream = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    stream.bind(str(sock_path))
    sock_path.chmod(0o600)
    inode = sock_path.lstat().st_ino
    stream.setblocking(False)
    records = []
    position, pending = 0, ''
    next_context = 0
    try:
        with timeline.open('x') as out:
            (directory / 'collector-ready.json').write_text(json.dumps(status))
            while time.monotonic_ns() - started < seconds * 1_000_000_000 and len(records) < 12_000:
                raw = []
                if time.monotonic_ns() >= next_context:
                    raw.append(system_record())
                    next_context = time.monotonic_ns() + 5_000_000_000
                if select.select([stream], [], [], .1)[0]:
                    for _ in range(64):
                        try:
                            data = stream.recv(1024)
                        except BlockingIOError:
                            break
                        try:
                            raw.append(app_record(data))
                        except (ValueError, TypeError, KeyError):
                            status['rejected'] += 1
                if kernel_path.exists():
                    if kernel_path.is_symlink():
                        raise ValueError('kernel log replaced')
                    with kernel_path.open() as f:
                        f.seek(position); chunk = f.read(32768); position = f.tell()
                    pending += chunk
                    if len(pending) > 65536:
                        raise ValueError('kernel line buffer limit')
                    while '\n' in pending:
                        line, pending = pending.split('\n', 1)
                        if not line.strip():
                            continue
                        try:
                            raw.append(kernel_record(line))
                        except ValueError:
                            # Compiler/source warnings stay out of the sanitized timeline.
                            status['rejected'] += 1
                for record in raw:
                    record['receivedMonoNs'] = time.monotonic_ns()
                    records.append(record);out.write(json.dumps(record, separators=(',', ':')) + '\n')
                out.flush()
                if (directory / 'collector-stop').exists():
                    break
        status.update(status='stopped', records=len(records), endedMonoNs=time.monotonic_ns(), boundedLimitReached=len(records) >= 12_000)
        status['traceStarted'] = any(r['stage'] == 'trace_start' for r in records)
        status['traceEnded'] = any(r['stage'] == 'trace_end' for r in records)
        status.update(diagnostic_flags(directory))
        status['appTraceStarted'] = any(r['source'] == 'app' and r['stage'] == 'trace-start' for r in records)
        status['appOwnerStopComplete'] = any(r['source'] == 'app' and r['stage'] == 'owner-stop' and r['a'] == 1 for r in records)
        status['appLostMax'] = max((r.get('lost', 0) for r in records), default=0)
        (directory / 'report.json').write_text(json.dumps(analyze(records), indent=2) + '\n')
    finally:
        stream.close()
        if sock_path.exists() and sock_path.lstat().st_ino == inode:
            sock_path.unlink()
        (directory / 'collector-status.json').write_text(json.dumps(status, indent=2) + '\n')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, required=True)
    p.add_argument('--seconds', type=int, default=180)
    p.add_argument('--report', action='store_true')
    args = p.parse_args()
    if not 1 <= args.seconds <= 240:
        p.error('seconds must be 1..240')
    try:
        if args.report:
            rows = [json.loads(line) for line in (args.directory / 'timeline.jsonl').read_text().splitlines()]
            print(json.dumps(analyze(rows), indent=2))
        else:
            collect(args.directory.resolve(), args.seconds)
    except (ValueError, OSError, TypeError, KeyError):
        raise SystemExit('Cross-layer collection unavailable; no success verdict.') from None
