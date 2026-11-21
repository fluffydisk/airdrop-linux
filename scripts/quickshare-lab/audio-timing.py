#!/usr/bin/env python3
"""Bounded PipeWire timing metadata; never records audio or saves node names.

Requires PipeWire pw-profiler with JSON support. Graph timing does not establish
Bluetooth radio delivery or acoustic output. Existing xrun totals are not new
errors: compare within-run deltas, and reject comparisons across counter resets.
"""
import argparse
import datetime
import json
import math
import re
import subprocess
import time


def distribution(values):
    ordered = sorted(values)
    return {
        'maxMs': max(ordered, default=0),
        'p99Ms': ordered[max(0, math.ceil(len(ordered) * .99) - 1)] if ordered else 0,
        'atLeast40ms': sum(v >= 40 for v in ordered),
        'atLeast100ms': sum(v >= 100 for v in ordered),
    }


def summarize(rows, selected):
    active, period, groups = False, 0, {}
    for row in rows:
        if row.get('type') == 'clock':
            active = row.get('id') == selected
            rate = re.fullmatch(r'(\d+)/(\d+)', row.get('rate', ''))
            period = (row.get('duration', 0) * int(rate[1]) / int(rate[2]) * 1e9
                      if rate and int(rate[2]) else 0)
        if not active or row.get('type') not in ('driver', 'follower'):
            continue
        group = groups.setdefault(row['id'], {
            'role': row['type'], 'samples': 0, 'first': row.get('xrun_count'),
            'last': row.get('xrun_count'), 'counterResets': 0,
            'interval': [], 'wakeDelay': [], 'processing': [],
            'deadlineMissSamples': 0,
        })
        group['samples'] += 1
        current = row.get('xrun_count')
        if isinstance(current, int) and isinstance(group['last'], int) and current < group['last']:
            group['counterResets'] += 1
        group['last'] = current
        prev, signal, awake, finish = (row.get(k, 0) for k in ('prev', 'signal', 'awake', 'finish'))
        for field, earlier, later in [('interval', prev, signal),
                                      ('wakeDelay', signal, awake),
                                      ('processing', awake, finish)]:
            if later >= earlier > 0:
                group[field].append((later - earlier) / 1e6)
        if period and finish >= signal > 0 and finish - signal > period:
            group['deadlineMissSamples'] += 1
    if not any(g['role'] == 'driver' for g in groups.values()):
        raise ValueError('Selected Bluetooth driver had no profiler samples')
    result = []
    for group in groups.values():
        valid = (not group['counterResets'] and isinstance(group['first'], int)
                 and isinstance(group['last'], int))
        result.append({
            'role': group['role'], 'samples': group['samples'],
            'xrunStart': group['first'], 'xrunEnd': group['last'],
            'xrunDelta': group['last'] - group['first'] if valid else None,
            'counterResets': group['counterResets'],
            'deadlineMissSamples': group['deadlineMissSamples'],
            **{field: distribution(group[field]) for field in ('interval', 'wakeDelay', 'processing')},
        })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=2000, help='Driver cycles, bounded 1..4000')
    parser.add_argument('--phase', choices=['receiver-off', 'receiver-on', 'receiver-off-repeat'], required=True)
    args = parser.parse_args()
    if not 1 <= args.samples <= 4000:
        parser.error('samples must be between 1 and 4000')
    began = time.monotonic()
    started_mono_ns = time.monotonic_ns()
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    # Node names/addresses stay in RAM; raw pw-dump/profiler output is never saved.
    nodes = json.loads(subprocess.check_output(['pw-dump'], timeout=10))
    selected = [n['id'] for n in nodes if n.get('type') == 'PipeWire:Interface:Node'
                and str(n.get('info', {}).get('props', {}).get('node.name', '')).startswith('bluez_output')
                and n.get('info', {}).get('state') == 'running']
    if len(selected) != 1:
        raise ValueError('Exactly one active Bluetooth output required')
    captured = subprocess.run(['pw-profiler', '-J', '-n', str(args.samples)],
                              capture_output=True, text=True, timeout=65, check=True)
    summary = summarize(json.loads(captured.stdout), selected[0])
    print(json.dumps({'phase': args.phase, 'startedAt': started, 'clock': 'monotonic',
                      'startedMonoNs': started_mono_ns, 'finishedMonoNs': time.monotonic_ns(),
                      'durationSeconds': time.monotonic() - began,
                      'audioCaptured': False, 'nodes': summary,
                      'limitations': ['Host graph timing only; not radio delivery or acoustic output.']}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.SubprocessError, OSError):
        # Avoid echoing child stderr or JSON fields containing private node names.
        raise SystemExit('Audio timing measurement unavailable; no valid result produced.') from None
