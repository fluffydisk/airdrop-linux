#!/usr/bin/env python3
"""Fetch the pinned Electron source graph online, then build offline locally."""
import argparse
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import zipfile

from source_runtime import ROOT, LOCK, LOCK_PATH, digest, execute, require_offline

PIN = LOCK['electron']
ARGS = ('import("//electron/build/args/release.gn") '
        'use_remoteexec=false use_siso=false symbol_level=0 '
        'blink_symbol_level=0 v8_symbol_level=0 use_thin_lto=false '
        'chrome_pgo_phase=0 v8_builtins_profiling_log_file=""')


def capacity(directory):
    disk = shutil.disk_usage(directory).free / 1024**3
    memory = next(int(line.split()[1]) / 1024**2 for line in
                  Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:'))
    report = {'availableDiskGiB': round(disk, 1), 'memoryGiB': round(memory, 1),
              'minimumDiskGiB': PIN['minimumFreeDiskGiB'], 'minimumMemoryGiB': PIN['minimumMemoryGiB']}
    print(json.dumps(report), flush=True)
    if disk < PIN['minimumFreeDiskGiB'] or memory < PIN['minimumMemoryGiB']:
        raise RuntimeError('Electron source build blocked by runner capacity; no prebuilt fallback is allowed')
    return report


def environment(directory):
    return {**os.environ, 'DEPOT_TOOLS_UPDATE': '0',
            'CHROMIUM_BUILDTOOLS_PATH': str(directory / 'src/buildtools'),
            'PATH': str(directory / 'depot_tools') + os.pathsep + os.environ['PATH']}


def prepare(directory):
    if directory.exists():
        raise ValueError('Electron preparation directory must be new')
    directory.parent.mkdir(parents=True, exist_ok=True)
    report = capacity(directory.parent)
    directory.mkdir()
    depot = directory / 'depot_tools'
    execute(['git', 'init', depot])
    execute(['git', '-C', depot, 'remote', 'add', 'origin', 'https://chromium.googlesource.com/chromium/tools/depot_tools.git'])
    execute(['git', '-C', depot, 'fetch', '--depth=1', 'origin', PIN['depotToolsRevision']])
    execute(['git', '-C', depot, 'checkout', '--detach', 'FETCH_HEAD'])
    env = environment(directory)
    execute(['gclient', 'config', '--name', 'src/electron', '--unmanaged', 'https://github.com/electron/electron'], cwd=directory, env=env)
    execute(['gclient', 'sync', '--no-history', '--nohooks',
             '--revision', 'src/electron@' + PIN['revision'],
             '--revision', 'src@' + PIN['chromiumRevision'],
             '--revision', 'src/third_party/electron_node@' + PIN['embeddedNodeRevision']], cwd=directory, env=env)
    for relative, expected in [('src/electron', PIN['revision']),
                               ('src', PIN['chromiumRevision']),
                               ('src/third_party/electron_node', PIN['embeddedNodeRevision'])]:
        actual = execute(['git', '-C', directory / relative, 'rev-parse', 'HEAD'], capture=True).strip()
        if actual != expected:
            raise RuntimeError(f'Unexpected Electron dependency revision: {relative}')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        raise RuntimeError('Automatic system dependency installation requires an ephemeral GitHub-hosted runner')
    execute(['sudo', directory / 'src/build/install-build-deps.sh', '--no-prompt', '--no-chromeos-fonts'], cwd=directory, env=env)
    execute(['gclient', 'runhooks'], cwd=directory, env=env)
    # Prime build-tool Python/CIPD caches while fetching is still allowed. No
    # application C++ compilation happens until the isolated build phase.
    execute(['gn', 'gen', 'out/Source', '--args=' + ARGS, '--fail-on-unused-args'], cwd=directory / 'src', env=env)
    execute(['ninja', '--version'], cwd=directory / 'src', env=env)
    graph = execute(['gclient', 'revinfo', '-a'], cwd=directory, env=env, capture=True)
    (directory / 'source-graph.txt').write_text(graph)
    (directory / 'prepared.json').write_text(json.dumps({
        'component': 'electron', 'version': PIN['version'], 'lockSha256': digest(LOCK_PATH),
        'sourceGraphSha256': digest(directory / 'source-graph.txt'),
        'revision': PIN['revision'], 'gnArgs': ARGS, 'capacityBeforeFetch': report
    }, indent=2) + '\n')


def unpack_distribution(archive, destination):
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            relative = Path(member.filename)
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe Electron distribution path')
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError('Unexpected symlink in Electron distribution')
            package.extract(member, destination)
            target = destination / relative
            if not member.is_dir():
                target.chmod(mode & 0o777 or 0o644)


def build(directory, output, jobs):
    interfaces = require_offline()
    if output.exists():
        raise ValueError('Electron output must be new')
    metadata = json.loads((directory / 'prepared.json').read_text())
    if metadata['lockSha256'] != digest(LOCK_PATH) or metadata['revision'] != PIN['revision']:
        raise ValueError('Electron sources do not match this lock')
    env = environment(directory)
    env['SISO_REAPI_INSTANCE'] = ''
    execute(['gn', 'gen', 'out/Source', '--args=' + ARGS, '--fail-on-unused-args'], cwd=directory / 'src', env=env)
    execute(['ninja', '-C', 'out/Source', '-j', str(jobs), 'electron:electron_dist_zip'], cwd=directory / 'src', env=env)
    distribution = directory / 'src/out/Source/dist.zip'
    output.mkdir(parents=True)
    unpack_distribution(distribution, output)
    version = execute([output / 'electron', '-p', 'process.versions.electron'], capture=True,
                      env={**env, 'ELECTRON_RUN_AS_NODE': '1'}).strip()
    if version != PIN['version']:
        raise ValueError(f'Unexpected built Electron version: {version}')
    shutil.copy2(directory / 'source-graph.txt', output / 'source-graph.txt')
    provenance = {**metadata, 'networkInterfacesDuringBuild': interfaces,
                  'binarySha256': digest(output / 'electron'), 'distributionSha256': digest(distribution)}
    (output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(f'{digest(output / "electron")}  electron\n')
    print(json.dumps(provenance), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['capacity', 'prepare', 'build'])
    parser.add_argument('directory', type=lambda p: Path(p).resolve())
    parser.add_argument('--output', type=lambda p: Path(p).resolve())
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 64:
        parser.error('jobs must be between 1 and 64')
    if args.phase == 'capacity':
        capacity(args.directory)
    elif args.phase == 'prepare':
        prepare(args.directory)
    else:
        if not args.output:
            parser.error('--output is required')
        build(args.directory, args.output, args.jobs)


if __name__ == '__main__':
    main()
