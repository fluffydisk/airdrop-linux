#!/usr/bin/env python3
"""Prepare pinned sources online; compile only inside a network namespace.

This is application build tooling, not a Flatpak manifest or submission.
"""
import argparse
import configparser
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
LOCK_PATH = ROOT / 'packaging/source-runtimes.json'
LOCK = json.loads(LOCK_PATH.read_text())


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(path, expected):
    actual = digest(path)
    if actual != expected:
        raise ValueError(f'Source checksum mismatch: {Path(path).name}: {actual}')


def execute(args, cwd=None, capture=False, env=None):
    print('+', ' '.join(map(str, args)), flush=True)
    if capture:
        result = subprocess.run(list(map(str, args)), cwd=cwd, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        if result.stderr:
            print(result.stderr, file=sys.stderr, flush=True)
        if result.returncode:
            raise RuntimeError(f'Command failed ({result.returncode}): {args[0]}\n' + (result.stderr or result.stdout)[-1800:])
        return result.stdout
    tail = deque(maxlen=25)
    with subprocess.Popen(list(map(str, args)), cwd=cwd, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env) as process:
        for line in process.stdout:
            print(line, end='', flush=True)
            tail.append(line)
        status = process.wait()
    if status:
        raise RuntimeError(f'Command failed ({status}): {args[0]}\n' + ''.join(tail)[-1800:])


def require_offline():
    interfaces = [name for _, name in socket.if_nameindex()]
    if any(name != 'lo' for name in interfaces):
        raise RuntimeError('Compilation requires an isolated network namespace (loopback only)')
    return interfaces


def build_environment():
    info = Path('/.flatpak-info')
    if not info.exists():
        return {'type': 'host'}
    config = configparser.ConfigParser(interpolation=None)
    config.read(info)
    return {'type': 'flatpak-sdk',
            'runtime': config.get('Application', 'runtime', fallback=''),
            'sdk': config.get('Application', 'sdk', fallback=''),
            'runtimeCommit': config.get('Instance', 'runtime-commit', fallback='')}


def extract(archive, directory):
    # The data filter rejects absolute/traversal members and escaping links.
    with tarfile.open(archive) as source:
        source.extractall(directory, filter='data')
    entries = list(Path(directory).iterdir())
    if len(entries) != 1 or not entries[0].is_dir():
        raise ValueError('Expected exactly one source directory')
    return entries[0]


def fetch(url, target):
    with urllib.request.urlopen(url, timeout=120) as response, target.open('wb') as stream:
        shutil.copyfileobj(response, stream)


def prepare(component, directory, archive=None):
    if directory.exists():
        raise ValueError('Preparation directory must be new')
    pin = LOCK[component]
    directory.mkdir(parents=True)
    packed = directory / 'source.archive'
    if archive:
        shutil.copyfile(archive, packed)
    else:
        fetch(pin['url'], packed)
    verify(packed, pin['sha256'])
    unpacked = directory / 'unpacked'
    unpacked.mkdir()
    source = extract(packed, unpacked)
    source.rename(directory / 'source')
    unpacked.rmdir()
    source = directory / 'source'
    if component == 'dufs':
        verify(source / 'Cargo.lock', pin['cargoLockSha256'])
        env = {**os.environ, 'RUSTUP_TOOLCHAIN': pin['rustToolchain']}
        config = execute(['cargo', 'vendor', '--locked', '--versioned-dirs', 'vendor'],
                         cwd=source, capture=True, env=env)
        (source / '.cargo').mkdir(exist_ok=True)
        (source / '.cargo/config.toml').write_text(config)
    elif component == 'node':
        # Any ICU fetch/configuration happens online, before the isolated build.
        execute([source / 'configure', '--download=all'], cwd=source)
    (directory / 'prepared.json').write_text(json.dumps({
        'component': component, 'lockSha256': digest(LOCK_PATH),
        'version': pin['version'], 'sourceSha256': pin['sha256']
    }, indent=2) + '\n')


def build(component, prepared, output, jobs):
    interfaces = require_offline()
    context = build_environment()
    if output.exists():
        raise ValueError('Build output must be new')
    pin = LOCK[component]
    metadata = json.loads((prepared / 'prepared.json').read_text())
    if metadata['component'] != component or metadata['lockSha256'] != digest(LOCK_PATH):
        raise ValueError('Prepared sources do not match this source lock')
    verify(prepared / 'source.archive', pin['sha256'])
    source = prepared / 'source'
    if component == 'node':
        compiler = execute(['c++', '--version'], capture=True).splitlines()[0]
        execute([source / 'configure', '--prefix=' + str(output)], cwd=source)
        execute(['make', '-j' + str(jobs)], cwd=source)
        execute(['make', 'install'], cwd=source)
        expected = 'v' + pin['version']
    else:
        verify(source / 'Cargo.lock', pin['cargoLockSha256'])
        env = dict(os.environ)
        if context['type'] == 'flatpak-sdk':
            env.pop('RUSTUP_TOOLCHAIN', None)
        else:
            env['RUSTUP_TOOLCHAIN'] = pin['rustToolchain']
        compiler = execute(['rustc', '--version'], capture=True, env=env).strip()
        if context['type'] != 'flatpak-sdk' and not compiler.startswith('rustc ' + pin['rustToolchain'] + ' '):
            raise RuntimeError('Rust compiler does not match the pinned toolchain')
        execute(['cargo', 'build', '--release', '--locked', '--offline', '--bin', 'dufs', '-j', str(jobs)], cwd=source, env=env)
        (output / 'bin').mkdir(parents=True)
        shutil.copy2(source / 'target/release/dufs', output / 'bin/dufs')
        expected = 'dufs ' + pin['version']
    binary = output / 'bin' / component
    actual = execute([binary, '--version'], capture=True).strip()
    if actual != expected:
        raise ValueError(f'Built runtime version mismatch: {actual}')
    for name in ['LICENSE', 'LICENSE-MIT', 'LICENSE-APACHE']:
        if (source / name).exists():
            shutil.copy2(source / name, output / name)
    provenance = {
        **metadata, 'architecture': platform.machine(),
        'applicationCommit': os.environ.get('GITHUB_SHA'),
        'networkInterfacesDuringBuild': interfaces,
        'binarySha256': digest(binary), 'rustToolchain': pin.get('rustToolchain'),
        'compilerVersion': compiler, 'buildJobs': jobs, 'buildEnvironment': context
    }
    (output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(f'{digest(binary)}  bin/{component}\n')
    print(json.dumps(provenance), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'build'])
    parser.add_argument('component', choices=['node', 'dufs'])
    parser.add_argument('directory', type=lambda p: Path(p).resolve())
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--output', type=lambda p: Path(p).resolve())
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 64:
        parser.error('jobs must be between 1 and 64')
    if args.phase == 'prepare':
        prepare(args.component, args.directory, args.archive)
    else:
        if not args.output:
            parser.error('--output is required for build')
        build(args.component, args.directory, args.output, args.jobs)


if __name__ == '__main__':
    main()
