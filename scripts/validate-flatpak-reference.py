#!/usr/bin/env python3
"""Build/test the existing reference; never publish or infer policy approval.

Requires Flatpak user runtimes, npm dependencies and PyYAML already installed.
Each invocation requires a new output directory and preserves every exit code.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import socket
import subprocess
import sys
import yaml
from flatpak_reference_inputs import stage_manifest

ROOT = Path(__file__).resolve().parents[1]
APP = 'io.github.fluffydisk.airdrop-linux'
REQ = 'https://docs.flathub.org/docs/for-app-authors/requirements'
META = 'https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines'
PERMS = 'https://docs.flatpak.org/en/latest/sandbox-permissions.html'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT/'packaging/flathub-draft'/f'{APP}.yml', help='Independent manifest to validate; all declared local inputs are staged')
    parser.add_argument('--arch', required=True, choices=['x86_64', 'aarch64'])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--from-run', type=Path, help='Retest a matching previously built recipe; preserve original build evidence')
    parser.add_argument('--builder', choices=['sdk', 'native'], default='sdk')
    parser.add_argument('--state-dir', type=Path, help='Reusable checksum-verified source downloads; build cache is disabled')
    parser.add_argument('--linter', help='Official linter command, shell-quoted; parsed as argv, never executed by a shell')
    parser.add_argument('--wayland-socket', help='Existing real compositor socket name')
    parser.add_argument('--wayland-runtime', type=Path, help='Runtime directory containing that socket')
    args = parser.parse_args()
    if platform.machine() != args.arch:
        parser.error(f'Native execution required: worker is {platform.machine()}, requested {args.arch}')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    build = (args.from_run.resolve() if args.from_run else out)/'build'
    repo = (args.from_run.resolve() if args.from_run else out)/'repo'
    env = os.environ.copy()
    # This variable is applied only to sandbox launches, never to host unit tests.
    env['AIRDROP_TEST_HOME'] = '/var/data/airdrop-reference-'+out.name+'-'+str(os.getpid())
    rows = []
    manifest = out/'submission'/f'{APP}.yml'
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'arch': args.arch,
              'builder': args.builder, 'flathub_ready': False, 'checks': rows}
    installed = False

    def save():
        (out/'results.json').write_text(json.dumps(report, indent=2)+'\n')
        def cell(value):
            return str(value).replace('|', '\\|').replace('\n', '<br>')
        lines = ['# Reference validation evidence', '',
                 '| Requirement | Official source | Technical solution | Test command | Result | Evidence | Remaining blocker |',
                 '| --- | --- | --- | --- | --- | --- | --- |']
        for row in rows:
            lines.append('| '+' | '.join(cell(row[k]) for k in ['requirement', 'source', 'solution', 'command', 'status', 'log', 'blocker'])+' |')
        (out/'matrix.md').write_text('\n'.join(lines)+'\n')

    def note(name, status, source, solution, blocker):
        rows.append(dict(requirement=name, source=source, solution=solution, command='Not executed',
                         status=status, log='results.json', blocker=blocker))
        save()

    def run(name, command, source=REQ, solution='Execute against the staged reference', extra=None, timeout=1200, required=True):
        log = f'{len(rows):02d}-'+''.join(c if c.isalnum() else '-' for c in name.lower())+'.log'
        row = dict(requirement=name, source=source, solution=solution, command=shlex.join(map(str, command)),
                   status='BLOCKED', log=log, blocker='Command did not complete')
        rows.append(row)
        save()
        print(f'[{args.arch}] {name}', flush=True)
        with (out/log).open('w') as stream:
            try:
                result = subprocess.run(list(map(str, command)), cwd=ROOT, env={**env, **(extra or {})},
                                        stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
                row['exit_code'] = result.returncode
                row['status'] = 'VERIFIED' if result.returncode == 0 else 'BLOCKED'
                row['blocker'] = '' if result.returncode == 0 else f'Exit {result.returncode}; see log'
            except (OSError, subprocess.TimeoutExpired) as error:
                stream.write(str(error)+'\n')
                row['blocker'] = str(error)
        save()
        if required and row['status'] != 'VERIFIED':
            raise RuntimeError(name+' failed; evidence retained')
        return row['status'] == 'VERIFIED'

    try:
        data, inventory = stage_manifest(args.manifest, manifest.parent)
        if args.manifest.name != manifest.name or data.get('app-id') != APP:
            raise RuntimeError('Manifest filename/app-id must match '+APP)
        if inventory['only_arches'] and args.arch not in inventory['only_arches']:
            raise RuntimeError('Requested architecture is excluded by flathub.json')
        receipt = inventory['sha256']
        electron_versions = {match[1] for source in inventory['sources']
                             if (match := re.search(r'/electron/releases/download/v([0-9.]+)/', source.get('url','')))}
        if len(electron_versions) == 1:
            env['AIRDROP_TEST_ELECTRON_VERSION'] = electron_versions.pop()
        (out/'source-inventory.json').write_text(json.dumps(inventory, indent=2)+'\n')
        (out/'source-receipt.json').write_text(json.dumps({k:inventory[k] for k in ['manifest','expanded_sources','sha256','only_arches']}, indent=2)+'\n')
        rows.append(dict(requirement='Independent source paths', source=REQ+'#required-files',
                         solution='Copy directory; recursively resolve includes and patches inside copy',
                         command=shlex.join(sys.argv), status='VERIFIED', log='source-receipt.json', blocker=''))
        save()
        for port in [5000, 6001]:
            with socket.socket() as connection:
                if connection.connect_ex(('127.0.0.1', port)) == 0:
                    raise RuntimeError(f'Port {port} is occupied; existing service left untouched')
        if subprocess.run(['flatpak', 'info', '--user', APP], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            raise RuntimeError('Existing user application installation left untouched; use a disposable test account')
        note('Electron offline source build', 'BLOCKED', REQ+'#building-from-source',
             'Keep checksum-pinned binary reference; no source-build exception assumed',
             'Verified complete offline Electron build or explicit exception required; see technical review')
        note('Host-dependent inclusion', 'BLOCKED', REQ+'#host-dependent-applications',
             'Local operation independent; cross-device use requires host Tailscale/HTTPS/Serve', 'No inclusion decision or exception')
        note('Real second-device Tailscale', 'NOT TESTED', REQ+'#host-dependent-applications',
             'Separate real-device procedure; controlled transport tests do not count', 'Authenticated tailnet and second device unavailable')
        note('Interactive GNOME/KDE portals and Wayland clipboard', 'NOT TESTED', PERMS,
             'Fixture and headless startup reported separately', 'Physical desktop/input session unavailable')
        other = 'aarch64' if args.arch == 'x86_64' else 'x86_64'
        note(f'Native {other} build and execution', 'NOT TESTED', REQ,
             'Not advertised when excluded by flathub.json; run on native hardware before enabling', f'This invocation runs only on {args.arch}; only-arches={inventory["only_arches"]}')
        lint = shlex.split(args.linter) if args.linter else ['flatpak', 'run', '--user', '--command=flatpak-builder-lint', 'org.flatpak.Builder']
        if args.from_run:
            old = args.from_run.resolve()
            previous = json.loads((old/'results.json').read_text())
            assert previous['builder'] == args.builder, 'Use the original builder kind when reusing evidence'
            old_hashes = json.loads((old/'source-receipt.json').read_text())['sha256']
            docs = {'README.md', manifest.name}
            assert {k:v for k,v in receipt.items() if k not in docs} == {k:v for k,v in old_hashes.items() if k not in docs}, 'Source inputs changed; clean rebuild required'
            assert yaml.safe_load((old/'submission'/manifest.name).read_text()) == data, 'Build graph changed; clean rebuild required'
            assert previous['arch'] == args.arch and repo.is_dir() and build.is_dir()
            assert any(r['requirement'] == 'Clean offline build' and r['status'] == 'VERIFIED' for r in previous['checks'])
            for old_row in previous['checks']:
                if old_row['status'] == 'VERIFIED' and old_row['requirement'] not in ['Independent source paths', 'Uninstall test application keeping user data']:
                    if old_row['requirement'] == 'Repository lint':
                        break
                    reused = dict(old_row)
                    reused['log'] = str(old/old_row['log'])
                    reused['evidence_reused_from'] = str(old/'results.json')
                    rows.append(reused)
            report['build_evidence_reused_from'] = str(old/'results.json')
            save()
        else:
            run('Unit and controlled connection tests', ['npm', 'test'], solution='Real unit/integration suite plus explicitly controlled transport cases')
            unit = rows[-1]
            match = re.search(r'(?:ℹ|#) skipped (\d+)', (out/unit['log']).read_text())
            if match and int(match[1]):
                unit['status'] = 'NOT TESTED'
                unit['blocker'] = f'{match[1]} skipped tests; see suite log for missing prerequisites'
                save()
            run('Flatpak tool version', ['flatpak', '--version'])
            for arch in ['x86_64', 'aarch64']:
                for ref in ['org.freedesktop.Platform', 'org.freedesktop.Sdk', 'org.electronjs.Electron2.BaseApp',
                            'org.freedesktop.Sdk.Extension.node24', 'org.freedesktop.Sdk.Extension.rust-stable']:
                    run(f'{arch} ref {ref}', ['flatpak', 'remote-info', '--user', '--arch='+arch, '--show-metadata', 'flathub', ref+'//26.08'],
                        solution='Inspect signed remote metadata; availability is not execution proof')
            run('Manifest lint', lint+['manifest', manifest])
            state = (args.state_dir or out/'builder-state').resolve()
            common = ['--user', '--disable-rofiles-fuse', '--state-dir='+str(state)]
            if args.builder == 'sdk':
                builder = ['flatpak', 'run', '--user']
                for key in ['FLATPAK_USER_DIR', 'FLATPAK_SYSTEM_DIR', 'XDG_RUNTIME_DIR']:
                    if key in env:
                        builder.append('--env='+key+'='+env[key])
                builder += ['--command=flatpak-builder', 'org.flatpak.Builder']
            else:
                builder = ['flatpak-builder']
                # Old native composers need absolute media URLs for current repo lint.
                real = shutil.which('appstreamcli')
                if not real:
                    raise RuntimeError('Native AppStream composer required')
                wrappers = out/'tools'; wrappers.mkdir()
                wrapper = wrappers/'appstreamcli'
                wrapper.write_text('#!/bin/sh\nif [ "${1-}" = compose ]; then\n shift\n exec '+shlex.quote(real)+' compose --no-partial-urls "$@"\nfi\nexec '+shlex.quote(real)+' "$@"\n')
                wrapper.chmod(0o755)
                env['PATH'] = str(wrappers)+os.pathsep+env['PATH']
            run('Builder version', builder+['--version'])
            run('Fetch pinned sources', ['dbus-run-session', '--']+builder+common+['--download-only', out/'fetch-build', manifest])
            run('Clean offline build', ['dbus-run-session', '--']+builder+common+[
                '--sandbox', '--disable-download', '--disable-cache', '--force-clean', '--jobs=2', '--default-branch=stable',
                '--mirror-screenshots-url=https://dl.flathub.org/media', '--repo='+str(repo), build, manifest],
                source=REQ+'#no-network-access-during-build', timeout=2400)
            media = build/'files/share/app-info/media'
            if args.builder == 'native' and media.is_dir():
                run('Export generated screenshot media', ['ostree', '--repo='+str(repo), 'commit', '--branch=screenshots/'+args.arch,
                    '--subject=AppStream generated screenshot media', '--tree=dir='+str(media)], source=META,
                    solution='Export real composer output; no uploaded media or lint exceptions')
                run('Update repository indexes', ['flatpak', 'build-update-repo', repo], source=META)
        run('Package security and dependency inventory', [sys.executable, 'scripts/audit-flatpak-reference.py', manifest, '--build-dir', build, '--output', out/'package-audit.json'], source=PERMS)
        run('Repository lint', lint+['repo', repo])
        files = build/'files'
        run('AppStream lint', lint+['appstream', files/f'share/metainfo/{APP}.metainfo.xml'], source=META)
        run('AppStream validation', ['appstreamcli', 'validate', '--no-net', files/f'share/metainfo/{APP}.metainfo.xml'], source=META)
        run('Desktop entry validation', ['desktop-file-validate', files/f'share/applications/{APP}.desktop'], source=META)
        run('D-Bus background portal fixture', ['dbus-run-session', '--', 'node', 'scripts/test-background-portal.cjs', files/'bin/airdrop-background-portal'],
            source=PERMS, solution='Real D-Bus with controlled grant/denial/absence; no interactive consent claim')
        run('Install built reference', ['flatpak', 'install', '--user', '--noninteractive', repo, APP])
        installed = True
        run('Installed permissions', ['flatpak', 'info', '--user', '--show-permissions', APP], source=PERMS)
        run('Reinstall and persistent private workspace', ['dbus-run-session', '--', 'node', 'scripts/test-flatpak-persistence.cjs', repo], source=PERMS, solution='Actual uninstall/reinstall; compare exact private file bytes without --delete-data')
        run('Installed Node version', ['dbus-run-session', '--', 'flatpak', 'run', '--user', '--command=/app/lib/airdrop-linux/runtime/node', APP, '--version'])
        run('No sandbox Tailscale daemon', ['dbus-run-session', '--', 'flatpak', 'run', '--user', '--command=sh', APP,
            '-c', 'if command -v tailscale; then exit 1; fi; test ! -S /run/tailscale/tailscaled.sock'], source=PERMS)
        run('Backend transfers and isolation', ['dbus-run-session', '--', 'node', 'scripts/smoke-sandbox.js', 'flatpak'], source=PERMS)
        run('X11 clipboard sandbox and connection UI', ['xvfb-run', '-a', 'dbus-run-session', '--', 'node', 'scripts/smoke-sandbox-desktop.cjs', 'flatpak'],
            source=PERMS, extra={'AIRDROP_TEST_CONNECTION': '1', 'AIRDROP_TEST_SCREENSHOT': str(out/'desktop.png')})
        run('Icon screenshot integrity and actual metadata URL', [sys.executable, 'scripts/check-flatpak-images.py',
            '--metainfo', files/f'share/metainfo/{APP}.metainfo.xml', '--capture', out/'desktop.png',
            '--icon', files/f'share/icons/hicolor/512x512/apps/{APP}.png'], source=META)
        if args.wayland_socket and args.wayland_runtime:
            run('Native headless Wayland startup', ['dbus-run-session', '--', 'node', 'scripts/smoke-sandbox-desktop.cjs', 'flatpak'], source=PERMS,
                extra={'AIRDROP_TEST_WAYLAND': '1', 'WAYLAND_DISPLAY': args.wayland_socket, 'XDG_RUNTIME_DIR': str(args.wayland_runtime), 'AIRDROP_TEST_SCREENSHOT': ''})
        else:
            run('Native headless Wayland startup', ['bash', 'scripts/test-flatpak-wayland.sh'], source=PERMS)
        report['reference_working_on_native_arch'] = True
    except (RuntimeError, ValueError, OSError, AssertionError, yaml.YAMLError) as error:
        report['failure'] = str(error)
        print(str(error), file=sys.stderr)
    finally:
        if installed:
            run('Uninstall test application keeping user data', ['flatpak', 'uninstall', '--user', '--noninteractive', APP], source=PERMS, required=False)
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        save()
    print(out/'matrix.md', flush=True)
    return 0 if report.get('reference_working_on_native_arch') and rows[-1]['status'] == 'VERIFIED' else 1


if __name__ == '__main__':
    sys.exit(main())
